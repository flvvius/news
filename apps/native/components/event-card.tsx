import { api } from "@news-app/backend/convex/_generated/api";
import type { Id } from "@news-app/backend/convex/_generated/dataModel";
import type { FunctionReturnType } from "convex/server";
import { useRouter } from "expo-router";
import { Pressable, Text, View } from "react-native";

import {
  formatRelativeTimestamp,
  getPluralizedCountLabel,
} from "@news-app/i18n";

import { BiasDistributionBar } from "@/components/bias-distribution-bar";
import { BookmarkButton } from "@/components/bookmark-button";
import { ShareEventButton } from "@/components/share-event-button";
import { SourceAvatarStack } from "@/components/source-avatar";
import { Image } from "@/components/ui/image";
import { useLocale, useT } from "@/contexts/locale-context";
import { getBiasBucket } from "@/lib/bias";
import { cn } from "@/lib/cn";
import { buildInteractionContextFromSources } from "@/lib/interactions";

export type FeedEvent = FunctionReturnType<
  typeof api.events.getPublishedEvents
>["page"][number];

/**
 * Structural card shape (mirrors the web EventCard props) so both feed
 * events and bookmarked events can be rendered by the same card.
 */
export type EventCardEvent = {
  _id: Id<"events">;
  slug: string;
  title: string;
  imageUrl?: string;
  imageAlt?: string;
  perspectiveSummaries?: { center?: string };
  globalImpact?: string;
  firstPublishedAt: number;
  lastUpdatedAt?: number;
  topicIds?: Id<"topics">[];
  articleCount?: number;
  sourceCount?: number;
  sourceBiasCounts?: { left: number; center: number; right: number };
  sources?: Array<{
    _id: Id<"sources">;
    name: string;
    logoUrl?: string;
    baseBias: number;
    reliabilityScore: number;
    mbfcCategory?: string;
  }>;
};

type EventCardProps = {
  event: EventCardEvent;
  topicNamesById: Record<string, string>;
  maxSources?: number;
  variant?: "default" | "feature";
};

const CARD_IMAGE_ASPECT = 16 / 10;

export function EventCard({
  event,
  topicNamesById,
  maxSources = 5,
  variant = "default",
}: EventCardProps) {
  const router = useRouter();
  const locale = useLocale();
  const t = useT();
  const isFeature = variant === "feature";

  const topics = (event.topicIds ?? [])
    .map((id) => topicNamesById[id])
    .filter((name): name is string => Boolean(name));
  const primaryTopic = topics[0] ?? t("event.general");
  const summaryPreview =
    event.perspectiveSummaries?.center ??
    event.globalImpact ??
    t("event.coveragePreview");
  const lastUpdatedAt = event.lastUpdatedAt ?? event.firstPublishedAt;
  const interactionContext = buildInteractionContextFromSources(
    event.sources ?? [],
  );

  const fallbackCounts = (event.sources ?? []).reduce(
    (counts, source) => {
      counts[getBiasBucket(source)]++;
      return counts;
    },
    { left: 0, center: 0, right: 0 },
  );
  const biasCounts = event.sourceBiasCounts ?? fallbackCounts;
  const totalSources = Math.max(
    0,
    event.sourceCount ?? event.sources?.length ?? 0,
  );
  const distributionTotal =
    biasCounts.left + biasCounts.center + biasCounts.right;
  const showBiasDistribution = totalSources > 0 && distributionTotal > 0;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t("native.event.openLabel").replace(
        "{title}",
        event.title,
      )}
      onPress={() => router.push(`/event/${event.slug}`)}
      className={cn(
        "overflow-hidden border border-border/80 bg-card/95 active:opacity-90",
        isFeature ? "rounded-[1.4rem]" : "rounded-[1.2rem]",
      )}
    >
      <View
        className="relative overflow-hidden bg-muted/40"
        style={{ aspectRatio: CARD_IMAGE_ASPECT }}
      >
        <View className="absolute left-4 top-4 z-10 flex-row flex-wrap items-center gap-2">
          {(topics.length > 0 ? topics : [t("event.general")])
            .slice(0, isFeature ? 3 : 2)
            .map((topic) => (
              <View
                key={topic}
                className="h-7 justify-center rounded-full border border-overlay-border bg-overlay px-3"
              >
                <Text className="text-xs font-medium text-overlay-foreground">
                  {topic}
                </Text>
              </View>
            ))}
        </View>
        {event.imageUrl ? (
          <Image
            source={{ uri: event.imageUrl }}
            recyclingKey={event._id}
            contentFit="cover"
            transition={150}
            className="size-full"
            accessibilityLabel={event.imageAlt ?? event.title}
          />
        ) : (
          <View className="size-full items-center justify-center bg-muted">
            <View className="rounded-full border border-border/80 bg-background/85 px-3 py-1">
              <Text className="text-xs font-medium text-muted-foreground">
                {primaryTopic}
              </Text>
            </View>
          </View>
        )}
      </View>

      <View
        className={cn("gap-4 px-5 pb-6 pt-5", isFeature && "pb-7 pt-6")}
      >
        <View className="gap-4">
          <View className="flex-row items-center justify-between gap-3">
            <Text className="text-[11px] font-medium uppercase tracking-[1.6px] text-muted-foreground">
              {t("event.updated").replace(
                "{time}",
                formatRelativeTimestamp(lastUpdatedAt, locale),
              )}
            </Text>
            <View className="flex-row items-center gap-2">
              <ShareEventButton
                eventId={event._id}
                slug={event.slug}
                title={event.title}
                interactionContext={interactionContext}
                size="sm"
              />
              <BookmarkButton
                eventId={event._id}
                interactionContext={interactionContext}
                size="sm"
              />
            </View>
          </View>
          <Text
            className={cn(
              "font-semibold leading-tight tracking-tight text-card-foreground",
              isFeature ? "text-2xl" : "text-xl",
            )}
          >
            {event.title}
          </Text>
        </View>

        <Text
          numberOfLines={3}
          className={cn(
            "text-sm leading-relaxed text-muted-foreground",
            isFeature && "text-base",
          )}
        >
          {summaryPreview}
        </Text>

        <View className="gap-3 border-t border-border/70 pt-4">
          <View className="flex-row items-center gap-3">
            {event.sources && event.sources.length > 0 ? (
              <SourceAvatarStack sources={event.sources} max={maxSources} />
            ) : null}
            <View className="min-w-0 flex-1">
              <Text className="text-sm font-medium text-card-foreground">
                {t("event.sources").replace("{count}", String(totalSources))}
              </Text>
              <Text className="text-xs text-muted-foreground">
                {event.articleCount !== undefined
                  ? getPluralizedCountLabel(
                      locale,
                      "event.articles",
                      event.articleCount,
                    )
                  : t("event.follow")}
              </Text>
            </View>
          </View>

          {showBiasDistribution ? (
            <BiasDistributionBar counts={biasCounts} />
          ) : null}
        </View>
      </View>
    </Pressable>
  );
}
