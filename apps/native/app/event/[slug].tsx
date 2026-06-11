import { api } from "@news-app/backend/convex/_generated/api";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Pressable,
  ScrollView,
  Text,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";

import { BookmarkButton } from "@/components/bookmark-button";
import { ArticlesList } from "@/components/event/articles-list";
import { EventClaimComparison } from "@/components/event/event-claim-comparison";
import { PerspectiveSummaries } from "@/components/event/perspective-summaries";
import { SourceCoverageSummary } from "@/components/event/source-coverage-summary";
import { Screen } from "@/components/screen";
import { ShareEventButton } from "@/components/share-event-button";
import { SourceAvatarStack } from "@/components/source-avatar";
import { Icon } from "@/components/ui/icon";
import { Image } from "@/components/ui/image";
import {
  formatRelativeTimestamp,
  getPluralizedCountLabel,
} from "@news-app/i18n";

import { QueryBoundary } from "@/components/ui/query-boundary";
import { SectionCard } from "@/components/ui/section-card";
import { Skeleton } from "@/components/ui/skeleton";
import { useLocale, useT } from "@/contexts/locale-context";
import { cn } from "@/lib/cn";
import { uniqueEventSources, type EventDetail } from "@/lib/event-types";
import {
  buildInteractionContextFromSources,
  NATIVE_DEVICE_TYPE,
} from "@/lib/interactions";

const HERO_IMAGE_ASPECT = 16 / 9;

function isNumberArray(value: unknown): value is number[] {
  return (
    Array.isArray(value) &&
    value.every((item) => typeof item === "number" && Number.isFinite(item))
  );
}

export default function EventDetailScreen() {
  const t = useT();

  return (
    <Screen>
      <QueryBoundary
        title={t("native.event.errorTitle")}
        body={t("native.event.errorBody")}
      >
        <EventDetailContent />
      </QueryBoundary>
    </Screen>
  );
}

function BackToFeedButton() {
  const router = useRouter();
  const t = useT();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t("event.backToFeed")}
      onPress={() => {
        if (router.canGoBack()) {
          router.back();
        } else {
          router.replace("/");
        }
      }}
      hitSlop={8}
      className="min-h-11 flex-row items-center gap-1 self-start active:opacity-70"
    >
      <Icon
        name="arrow-back-outline"
        size={16}
        className="text-muted-foreground"
      />
      <Text className="text-base font-medium text-muted-foreground">
        {t("event.backToFeed")}
      </Text>
    </Pressable>
  );
}

function EventDetailSkeleton() {
  return (
    <View className="gap-5 px-3 py-4">
      <Skeleton className="h-5 w-28" />
      <View className="overflow-hidden rounded-[1.15rem] border border-border/80 bg-card/95">
        <Skeleton
          className="w-full rounded-none"
          style={{ aspectRatio: HERO_IMAGE_ASPECT }}
        />
        <View className="gap-4 px-4 py-5">
          <View className="flex-row items-center justify-between">
            <Skeleton className="h-3 w-24" />
            <View className="flex-row gap-2">
              <Skeleton className="size-9 rounded-full" />
              <Skeleton className="size-9 rounded-full" />
            </View>
          </View>
          <Skeleton className="h-7 w-full" />
          <Skeleton className="h-7 w-2/3" />
          <View className="flex-row gap-3 border-t border-border/70 pt-4">
            <Skeleton className="h-8 w-32 rounded-full" />
            <Skeleton className="h-8 flex-1 rounded-full" />
          </View>
        </View>
      </View>
      <Skeleton className="h-11 w-full rounded-full" />
      <Skeleton className="h-48 w-full rounded-xl" />
    </View>
  );
}

function EventNotFound() {
  const router = useRouter();
  const t = useT();

  return (
    <View className="flex-1 items-center justify-center gap-3 px-6">
      <Text className="text-3xl font-semibold tracking-tight text-foreground">
        {t("event.notFound")}
      </Text>
      <Text className="max-w-[252px] text-center text-base leading-relaxed text-muted-foreground">
        {t("event.notFoundBody")}
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t("event.backToFeed")}
        onPress={() => router.replace("/")}
        className="mt-2 min-h-11 items-center justify-center rounded-full bg-primary px-6 active:opacity-80"
      >
        <Text className="text-base font-medium text-primary-foreground">
          {t("event.backToFeed")}
        </Text>
      </Pressable>
    </View>
  );
}

function EventDetailContent() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const eventData = useQuery(api.events.getEventBySlug, { slug: slug ?? "" });

  if (eventData === undefined) {
    return <EventDetailSkeleton />;
  }

  if (eventData === null) {
    return <EventNotFound />;
  }

  return <EventDetailBody eventData={eventData} />;
}

function EventDetailBody({ eventData }: { eventData: EventDetail }) {
  const { event, articles } = eventData;
  const t = useT();
  const locale = useLocale();
  const { isAuthenticated } = useConvexAuth();
  const logInteraction = useMutation(api.interactions.logInteraction);
  const [activeTab, setActiveTab] = useState<"perspectives" | "claims">(
    "perspectives",
  );

  const thresholdsConfig = useQuery(api.config.get, { key: "bias_thresholds" });
  const thresholdsValue = thresholdsConfig?.value;
  const biasThresholds = isNumberArray(thresholdsValue)
    ? thresholdsValue
    : undefined;

  const sources = useMemo(() => uniqueEventSources(articles), [articles]);
  const interactionContext = useMemo(
    () => buildInteractionContextFromSources(sources),
    [sources],
  );

  // View tracking mirrors the web event page: log once on leave with time
  // spent and max scroll depth. Refs keep the cleanup callback stable.
  const maxScrollDepthRef = useRef(0);
  const logInteractionRef = useRef(logInteraction);
  logInteractionRef.current = logInteraction;
  const interactionContextRef = useRef(interactionContext);
  interactionContextRef.current = interactionContext;

  useEffect(() => {
    if (!isAuthenticated) return;
    const startedAt = Date.now();

    return () => {
      logInteractionRef
        .current({
          eventId: event._id,
          type: "view",
          context: interactionContextRef.current,
          metadata: {
            deviceType: NATIVE_DEVICE_TYPE,
            scrollDepthPercentage: maxScrollDepthRef.current,
            timeSpentSeconds: Math.max(
              1,
              Math.round((Date.now() - startedAt) / 1000),
            ),
          },
        })
        .catch(() => {
          // View analytics are best-effort.
        });
    };
  }, [event._id, isAuthenticated]);

  const handleScroll = (
    nativeEvent: NativeSyntheticEvent<NativeScrollEvent>,
  ) => {
    const { contentOffset, contentSize, layoutMeasurement } =
      nativeEvent.nativeEvent;
    const scrollable = contentSize.height - layoutMeasurement.height;
    const depth =
      scrollable <= 0
        ? 1
        : Math.min(1, Math.max(0, contentOffset.y / scrollable));
    if (depth > maxScrollDepthRef.current) {
      maxScrollDepthRef.current = depth;
    }
  };

  const lastUpdatedAt = event.lastUpdatedAt ?? event.firstPublishedAt;
  const sourceCount = sources.length;

  return (
    <ScrollView
      className="flex-1"
      contentContainerClassName="gap-5 px-3 py-4 pb-10"
      onScroll={handleScroll}
      scrollEventThrottle={64}
    >
      <BackToFeedButton />

      <View className="overflow-hidden rounded-[1.15rem] border border-border/80 bg-card/95">
        <View
          className="overflow-hidden border-b border-border/70 bg-muted/40"
          style={{ aspectRatio: HERO_IMAGE_ASPECT }}
        >
          {event.imageUrl ? (
            <Image
              source={{ uri: event.imageUrl }}
              contentFit="cover"
              transition={150}
              className="size-full"
              accessibilityLabel={event.imageAlt ?? event.title}
            />
          ) : (
            <View className="size-full items-center justify-center bg-muted">
              <View className="rounded-full border border-border/80 bg-background/85 px-3 py-1">
                <Text className="text-sm font-medium text-muted-foreground">
                  {t("event.cardLabel")}
                </Text>
              </View>
            </View>
          )}
        </View>

        <View className="gap-5 px-4 py-5">
          <View className="gap-4">
            <View className="flex-row items-center justify-between gap-3">
              <Text className="text-sm font-semibold uppercase tracking-[2.4px] text-muted-foreground">
                {t("event.overview")}
              </Text>
              <View className="flex-row items-center gap-2">
                <BookmarkButton
                  eventId={event._id}
                  interactionContext={interactionContext}
                  size="sm"
                />
                <ShareEventButton
                  eventId={event._id}
                  slug={event.slug}
                  title={event.title}
                  interactionContext={interactionContext}
                  size="sm"
                />
              </View>
            </View>
            <Text className="text-3xl font-bold leading-snug tracking-tight text-foreground">
              {event.title}
            </Text>
          </View>

          <View className="gap-3 border-t border-border/70 pt-4">
            <View className="self-start rounded-full border border-border/80 bg-background/70 px-3 py-1.5">
              <Text className="text-sm font-medium text-muted-foreground">
                {t("event.updated").replace(
                  "{time}",
                  formatRelativeTimestamp(lastUpdatedAt, locale),
                )}
              </Text>
            </View>
            <View className="flex-row items-center justify-between gap-3 rounded-2xl border border-border/70 bg-background/45 px-3 py-3">
              <SourceAvatarStack sources={sources} max={5} />
              <View className="shrink flex-row flex-wrap items-center justify-end gap-1">
                <Text className="text-base font-medium text-card-foreground">
                  {getPluralizedCountLabel(
                    locale,
                    "event.articles",
                    articles.length,
                  )}
                </Text>
                <Text className="text-base text-muted-foreground"> · </Text>
                <Text className="text-base text-muted-foreground">
                  {getPluralizedCountLabel(
                    locale,
                    "event.sourceCount",
                    sourceCount,
                  )}
                </Text>
              </View>
            </View>
          </View>
        </View>
      </View>

      <View className="h-11 flex-row rounded-full bg-muted/70 p-1">
        {(
          [
            { key: "perspectives", label: t("event.perspectives") },
            { key: "claims", label: t("event.claimBreakdown") },
          ] as const
        ).map(({ key, label }) => {
          const isActive = activeTab === key;
          return (
            <Pressable
              key={key}
              accessibilityRole="tab"
              accessibilityLabel={label}
              accessibilityState={{ selected: isActive }}
              onPress={() => setActiveTab(key)}
              className={cn(
                "flex-1 items-center justify-center rounded-full",
                isActive && "bg-background",
              )}
            >
              <Text
                className={cn(
                  "text-base font-medium",
                  isActive ? "text-foreground" : "text-muted-foreground",
                )}
              >
                {label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {activeTab === "perspectives" ? (
        <View className="gap-5">
          <PerspectiveSummaries
            perspectiveSummaries={event.perspectiveSummaries}
          />

          {event.globalImpact ? (
            <SectionCard title={t("event.meaning")}>
              <Text className="max-w-[455px] text-base leading-relaxed text-card-foreground">
                {event.globalImpact}
              </Text>
            </SectionCard>
          ) : null}

          <SourceCoverageSummary
            articles={articles}
            biasThresholds={biasThresholds}
          />
        </View>
      ) : (
        <EventClaimComparison eventId={event._id} articles={articles} />
      )}

      <ArticlesList
        eventId={event._id}
        articles={articles}
        biasThresholds={biasThresholds}
      />
    </ScrollView>
  );
}
