import { api } from "@news-app/backend/convex/_generated/api";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { useLocalSearchParams, useRouter } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Pressable,
  Text,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";
import Animated, {
  interpolate,
  useAnimatedStyle,
  useSharedValue,
} from "react-native-reanimated";

import { BookmarkButton } from "@/components/bookmark-button";
import { EventClaimComparison } from "@/components/event/event-claim-comparison";
import { EventSources } from "@/components/event/event-sources";
import { PerspectiveSummaries } from "@/components/event/perspective-summaries";
import { BiasDistributionBar } from "@/components/bias-distribution-bar";
import { Screen } from "@/components/screen";
import { ShareEventButton } from "@/components/share-event-button";
import { Icon } from "@/components/ui/icon";
import { Image } from "@/components/ui/image";
import {
  formatRelativeTimestamp,
  getPluralizedCountLabel,
} from "@news-app/i18n";

import { PressableScale } from "@/components/ui/pressable-scale";
import { QueryBoundary } from "@/components/ui/query-boundary";
import { Skeleton } from "@/components/ui/skeleton";
import { useGuestActivity } from "@/contexts/guest-activity-context";
import { useLocale, useT } from "@/contexts/locale-context";
import { useNotificationPrimer } from "@/contexts/notification-primer-context";
import { getBiasBucket } from "@/lib/bias";
import {
  QUALIFIED_READ_MIN_SCROLL,
  QUALIFIED_READ_MIN_SECONDS,
} from "@/lib/guest-activity-queue";
import { uniqueEventSources, type EventDetail } from "@/lib/event-types";
import { createVisitTracker } from "@/lib/visit-tracker";
import {
  buildInteractionContextFromSources,
  NATIVE_DEVICE_TYPE,
} from "@/lib/interactions";
import { ABOUT_PAGES, aboutPageUrl } from "@/lib/site";

const HEADER_HEIGHT = 48;

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

function EventDetailSkeleton() {
  // Mirrors the final layout: kicker, title, meta, bar, 3:2 photo, summary.
  return (
    <View className="gap-5 px-5" style={{ paddingTop: HEADER_HEIGHT + 16 }}>
      <Skeleton className="h-3.5 w-24" />
      <View className="gap-2.5">
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-8 w-3/4" />
      </View>
      <Skeleton className="h-3.5 w-48" />
      <Skeleton className="h-1 w-full rounded-full" />
      <Skeleton className="w-full rounded-lg" style={{ aspectRatio: 3 / 2 }} />
      <View className="gap-2 pt-1">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-2/3" />
      </View>
    </View>
  );
}

function EventNotFound() {
  const router = useRouter();
  const t = useT();

  return (
    <View className="flex-1 items-center justify-center gap-3 px-6">
      <Text className="text-2xl font-semibold tracking-tight text-foreground">
        {t("event.notFound")}
      </Text>
      <Text className="max-w-[252px] text-center text-base leading-relaxed text-muted-foreground">
        {t("event.notFoundBody")}
      </Text>
      <PressableScale
        accessibilityRole="button"
        accessibilityLabel={t("event.backToFeed")}
        onPress={() => router.replace("/")}
        className="mt-2"
        contentClassName="min-h-11 items-center justify-center rounded-lg bg-primary px-6"
      >
        <Text className="text-base font-medium text-primary-foreground">
          {t("event.backToFeed")}
        </Text>
      </PressableScale>
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

/** Quiet uppercase section label used by the impact zones. */
function SectionKicker({ text }: { text: string }) {
  return (
    <Text className="text-sm font-semibold uppercase tracking-[1.2px] text-muted-foreground">
      {text}
    </Text>
  );
}

function EventDetailBody({ eventData }: { eventData: EventDetail }) {
  const { event, articles } = eventData;
  const router = useRouter();
  const t = useT();
  const locale = useLocale();
  const { isAuthenticated } = useConvexAuth();
  const logInteraction = useMutation(api.interactions.logInteraction);
  const { recordRead } = useGuestActivity();
  const { maybeShowPrimer } = useNotificationPrimer();
  const [barLabelsVisible, setBarLabelsVisible] = useState(false);

  const thresholdsConfig = useQuery(api.config.get, { key: "bias_thresholds" });
  const thresholdsValue = thresholdsConfig?.value;
  const biasThresholds = isNumberArray(thresholdsValue)
    ? thresholdsValue
    : undefined;

  const topics = useQuery(api.topics.getTopics);
  const insight = useQuery(
    api.insights.getMyEventInsight,
    isAuthenticated ? { eventId: event._id } : "skip",
  );

  const sources = useMemo(() => uniqueEventSources(articles), [articles]);
  const interactionContext = useMemo(
    () => buildInteractionContextFromSources(sources),
    [sources],
  );
  const biasCounts = useMemo(() => {
    const counts = { left: 0, center: 0, right: 0 };
    for (const source of sources) {
      counts[getBiasBucket(source)]++;
    }
    return counts;
  }, [sources]);

  const kicker = useMemo(() => {
    const firstTopicId = event.topicIds[0];
    const name = topics?.find(
      (topic) => topic._id === firstTopicId,
    )?.displayName;
    return name ?? t("event.general");
  }, [topics, event.topicIds, t]);

  // Scroll-linked header title: fades in once the title block scrolls away.
  const scrollY = useSharedValue(0);
  const [titleFadePoint, setTitleFadePoint] = useState(160);
  const headerTitleStyle = useAnimatedStyle(() => ({
    opacity: interpolate(
      scrollY.value,
      [titleFadePoint - 48, titleFadePoint],
      [0, 1],
      "clamp",
    ),
  }));
  const headerHairlineStyle = useAnimatedStyle(() => ({
    opacity: interpolate(scrollY.value, [8, 48], [0, 1], "clamp"),
  }));

  // View tracking mirrors the web event page: log EXACTLY once on leave with
  // final time + max scroll (Ticket 8). A per-visit tracker guarantees a single
  // append regardless of scroll/time churn; refs keep the commit stable so the
  // effect mounts once per visit (auth state is read at commit time, not a dep).
  const logInteractionRef = useRef(logInteraction);
  logInteractionRef.current = logInteraction;
  const recordReadRef = useRef(recordRead);
  recordReadRef.current = recordRead;
  const interactionContextRef = useRef(interactionContext);
  interactionContextRef.current = interactionContext;
  const isAuthenticatedRef = useRef(isAuthenticated);
  isAuthenticatedRef.current = isAuthenticated;
  const visitTrackerRef = useRef<ReturnType<typeof createVisitTracker> | null>(
    null,
  );

  useEffect(() => {
    const tracker = createVisitTracker({
      startedAt: Date.now(),
      now: () => Date.now(),
      onCommit: ({ timeSpentSeconds, scrollDepthPercentage }) => {
        const context = interactionContextRef.current;
        if (isAuthenticatedRef.current) {
          logInteractionRef
            .current({
              eventId: event._id,
              type: "view",
              context,
              metadata: {
                deviceType: NATIVE_DEVICE_TYPE,
                scrollDepthPercentage,
                timeSpentSeconds,
              },
            })
            .catch(() => {
              // View analytics are best-effort.
            });
          return;
        }
        // Guest reads accrue locally (no server write) and replay into the
        // account at merge — this is what makes guest streaks possible.
        recordReadRef
          .current({
            eventId: event._id,
            slug: event.slug,
            timestamp: Date.now(),
            timeSpentSeconds,
            scrollDepthPercentage,
            biasRating: context?.biasRating,
            sourceReliability: context?.sourceReliability,
          })
          .catch(() => {
            // Local queue write is best-effort.
          });
      },
    });
    visitTrackerRef.current = tracker;

    return () => {
      // Single commit per visit (idempotent if cleanup runs twice).
      tracker.commit();
    };
  }, [event._id, event.slug]);

  // Notification primer fires on the first *qualified* read (decision 6):
  // 30s dwell OR ≥60% scroll, whichever first, once per visit. The primer
  // itself self-gates on cooldown / lifetime cap / OS state.
  const primerTriggeredRef = useRef(false);
  const triggerPrimer = useCallback(() => {
    if (primerTriggeredRef.current) return;
    primerTriggeredRef.current = true;
    maybeShowPrimer();
  }, [maybeShowPrimer]);

  useEffect(() => {
    const id = setTimeout(triggerPrimer, QUALIFIED_READ_MIN_SECONDS * 1000);
    return () => clearTimeout(id);
  }, [triggerPrimer]);

  const handleScroll = (
    nativeEvent: NativeSyntheticEvent<NativeScrollEvent>,
  ) => {
    const { contentOffset, contentSize, layoutMeasurement } =
      nativeEvent.nativeEvent;
    scrollY.value = contentOffset.y;
    const scrollable = contentSize.height - layoutMeasurement.height;
    const depth =
      scrollable <= 0
        ? 1
        : Math.min(1, Math.max(0, contentOffset.y / scrollable));
    // Feeds the per-visit tracker; the single read is committed on leave.
    visitTrackerRef.current?.recordScroll(depth);
    if (depth >= QUALIFIED_READ_MIN_SCROLL) {
      triggerPrimer();
    }
  };

  const openReportProblem = () => {
    const contactPage =
      ABOUT_PAGES.find((page) => page.slug === "contact") ?? ABOUT_PAGES[0];
    WebBrowser.openBrowserAsync(aboutPageUrl(contactPage)).catch(() => {
      // Browser unavailable — nothing actionable for the user here.
    });
  };

  const lastUpdatedAt = event.lastUpdatedAt ?? event.firstPublishedAt;
  const summary = event.perspectiveSummaries?.center;

  return (
    <View className="flex-1">
      {/* Zone 1 — minimal header: back, scroll-revealed title, actions */}
      <View
        className="absolute left-0 right-0 top-0 z-10 bg-background"
        style={{ height: HEADER_HEIGHT }}
      >
        <View className="h-full flex-row items-center gap-2 px-2">
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
            className="size-11 items-center justify-center active:opacity-70"
          >
            <Icon name="chevron-back" size={22} className="text-foreground" />
          </Pressable>
          <Animated.View
            style={headerTitleStyle}
            className="min-w-0 flex-1"
            pointerEvents="none"
          >
            <Text
              numberOfLines={1}
              className="text-lg font-semibold tracking-tight text-foreground"
            >
              {event.title}
            </Text>
          </Animated.View>
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
        <Animated.View style={headerHairlineStyle} className="h-px bg-border" />
      </View>

      <Animated.ScrollView
        className="flex-1"
        contentContainerClassName="px-5 pb-16"
        contentContainerStyle={{ paddingTop: HEADER_HEIGHT + 16 }}
        onScroll={handleScroll}
        scrollEventThrottle={16}
      >
        {/* Zone 2 — title block */}
        <View
          className="gap-3"
          onLayout={(layoutEvent) =>
            setTitleFadePoint(
              Math.max(
                64,
                layoutEvent.nativeEvent.layout.y +
                  layoutEvent.nativeEvent.layout.height -
                  HEADER_HEIGHT,
              ),
            )
          }
        >
          <SectionKicker text={kicker} />
          <Text className="text-3xl font-semibold leading-tight tracking-tight text-foreground">
            {event.title}
          </Text>
          <Text className="text-sm text-muted-foreground">
            {getPluralizedCountLabel(locale, "event.articles", articles.length)}
            {" · "}
            {getPluralizedCountLabel(
              locale,
              "event.sourceCount",
              sources.length,
            )}
            {" · "}
            {t("event.updated").replace(
              "{time}",
              formatRelativeTimestamp(lastUpdatedAt, locale),
            )}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("event.biasDistribution")
              .replace("{left}", String(biasCounts.left))
              .replace("{center}", String(biasCounts.center))
              .replace("{right}", String(biasCounts.right))}
            accessibilityState={{ expanded: barLabelsVisible }}
            onPress={() => setBarLabelsVisible((value) => !value)}
            hitSlop={10}
            className="pt-1"
          >
            <BiasDistributionBar
              counts={biasCounts}
              withLabels={barLabelsVisible}
            />
          </Pressable>
        </View>

        {/* Event photo — flat, hairline border, the one image on the screen */}
        {event.imageUrl ? (
          <View
            // bg-muted shows as the loading placeholder; the fixed aspect
            // ratio reserves the exact height up front — zero layout shift.
            className="mt-6 w-full overflow-hidden rounded-lg border border-border bg-muted"
            style={{ aspectRatio: 3 / 2 }}
          >
            <Image
              source={{ uri: event.imageUrl }}
              recyclingKey={event._id}
              contentFit="cover"
              transition={150}
              className="size-full"
              accessibilityLabel={event.imageAlt ?? event.title}
            />
          </View>
        ) : null}

        {/* Zone 3 — neutral summary, reading layer one */}
        {summary ? (
          <View className="gap-2 pt-6">
            <Text className="max-w-[455px] text-base leading-relaxed text-foreground">
              {summary}
            </Text>
            <Text className="text-sm text-muted-foreground">
              {t("native.event.autoSummaryNote").replace(
                "{count}",
                String(sources.length),
              )}
            </Text>
          </View>
        ) : null}

        {/* Global impact — context while the summary is fresh */}
        {event.globalImpact ? (
          <View className="mt-8 gap-3 border-t border-border pt-6">
            <SectionKicker text={t("event.meaning")} />
            <Text className="max-w-[455px] text-base leading-relaxed text-foreground">
              {event.globalImpact}
            </Text>
          </View>
        ) : null}

        {/* Zone 4 — perspectives */}
        <View className="mt-8 border-t border-border pt-6">
          <PerspectiveSummaries
            perspectiveSummaries={event.perspectiveSummaries}
          />
        </View>

        {/* Zone 5 — claims */}
        <View className="mt-8 border-t border-border pt-6">
          <EventClaimComparison eventId={event._id} articles={articles} />
        </View>

        {/* Zone 6 — sources */}
        <View className="mt-8 border-t border-border pt-6">
          <EventSources
            eventId={event._id}
            articles={articles}
            biasThresholds={biasThresholds}
          />
        </View>

        {/* Zone 7 — personalized "So what?" */}
        {insight ? (
          <View className="mt-8 gap-3 border-t border-border pt-6">
            <SectionKicker text={t("native.event.sowhatTitle")} />
            <Text className="max-w-[455px] text-base leading-relaxed text-foreground">
              {insight.personalImpact}
            </Text>
            {insight.actionableTip ? (
              <Text className="max-w-[455px] text-base leading-relaxed text-muted-foreground">
                {insight.actionableTip}
              </Text>
            ) : null}
          </View>
        ) : null}

        {/* Zone 8 — quiet footer actions */}
        <View className="mt-8 flex-row items-center gap-6 border-t border-border pt-4">
          <ShareEventButton
            eventId={event._id}
            slug={event.slug}
            title={event.title}
            interactionContext={interactionContext}
            label={t("share.label")}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("native.event.reportProblem")}
            onPress={openReportProblem}
            hitSlop={8}
            className="min-h-11 flex-row items-center gap-1.5 active:opacity-70"
          >
            <Icon
              name="flag-outline"
              size={14}
              className="text-muted-foreground"
            />
            <Text className="text-base font-medium text-muted-foreground">
              {t("native.event.reportProblem")}
            </Text>
          </Pressable>
        </View>
      </Animated.ScrollView>
    </View>
  );
}
