import { api } from "@news-app/backend/convex/_generated/api";
import type { Id } from "@news-app/backend/convex/_generated/dataModel";
import type { FunctionReturnType } from "convex/server";
import { useRouter } from "expo-router";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";

import {
  formatRelativeTimestamp,
  getPluralizedCountLabel,
} from "@news-app/i18n";

import { BiasDistributionBar } from "@/components/bias-distribution-bar";
import { Image } from "@/components/ui/image";
import { PressableScale } from "@/components/ui/pressable-scale";
import { useLocale, useT } from "@/contexts/locale-context";
import { getBiasBucket } from "@/lib/bias";
import { cn } from "@/lib/cn";

export type FeedEvent = FunctionReturnType<
  typeof api.events.getPublishedEvents
>["page"][number];

/**
 * Structural row shape (mirrors the web EventCard props) so both feed
 * events and bookmarked events can be rendered by the same row.
 */
export type EventRowEvent = {
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

type EventRowProps = {
  event: EventRowEvent;
  topicNamesById: Record<string, string>;
  /** Lead story: larger headline, full-width 3:2 image, one-line summary. */
  variant?: "default" | "lead";
};

const THUMB_SIZE = 80;
const LEAD_IMAGE_ASPECT = 3 / 2;

/**
 * Editorial feed row: kicker → title → distribution bar → meta, with an
 * optional right-aligned thumbnail. Rows separate by hairline, never by
 * card chrome — the feed is a newspaper page, not a pile of tiles.
 */
export function EventRow({
  event,
  topicNamesById,
  variant = "default",
}: EventRowProps) {
  const router = useRouter();
  const locale = useLocale();
  const t = useT();
  const isLead = variant === "lead";
  const [barLabelsVisible, setBarLabelsVisible] = useState(false);

  const primaryTopic =
    (event.topicIds ?? [])
      .map((id) => topicNamesById[id])
      .find((name): name is string => Boolean(name)) ?? t("event.general");

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
  const showBar =
    totalSources > 0 &&
    biasCounts.left + biasCounts.center + biasCounts.right > 0;

  const lastUpdatedAt = event.lastUpdatedAt ?? event.firstPublishedAt;
  const meta = `${getPluralizedCountLabel(locale, "event.sourceCount", totalSources)} · ${formatRelativeTimestamp(lastUpdatedAt, locale)}`;
  const summaryPreview = isLead
    ? (event.perspectiveSummaries?.center ?? event.globalImpact)
    : undefined;

  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={t("native.event.openLabel").replace(
        "{title}",
        event.title,
      )}
      onPress={() => router.push(`/event/${event.slug}`)}
      scaleTo={0.98}
      contentClassName={cn("gap-2.5", isLead ? "py-5" : "py-4")}
    >
      <View className="flex-row gap-4">
        <View className="min-w-0 flex-1 gap-1.5">
          <Text className="text-[11px] font-semibold uppercase tracking-[1.6px] text-muted-foreground">
            {primaryTopic}
          </Text>
          <Text
            numberOfLines={3}
            className={cn(
              "font-semibold leading-snug tracking-tight text-foreground",
              isLead ? "text-2xl" : "text-base",
            )}
          >
            {event.title}
          </Text>
        </View>
        {!isLead && event.imageUrl ? (
          <View
            className="shrink-0 self-start overflow-hidden rounded-lg bg-muted"
            style={{ width: THUMB_SIZE, height: THUMB_SIZE }}
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
      </View>

      {isLead && event.imageUrl ? (
        <View
          className="w-full overflow-hidden rounded-lg bg-muted"
          style={{ aspectRatio: LEAD_IMAGE_ASPECT }}
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

      {summaryPreview ? (
        <Text
          numberOfLines={2}
          className="max-w-[455px] text-base leading-relaxed text-muted-foreground"
        >
          {summaryPreview}
        </Text>
      ) : null}

      {showBar ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("event.biasDistribution")
            .replace("{left}", String(biasCounts.left))
            .replace("{center}", String(biasCounts.center))
            .replace("{right}", String(biasCounts.right))}
          accessibilityState={{ expanded: barLabelsVisible }}
          onPress={() => setBarLabelsVisible((value) => !value)}
          hitSlop={10}
        >
          <BiasDistributionBar
            counts={biasCounts}
            withLabels={barLabelsVisible}
          />
        </Pressable>
      ) : null}

      <Text className="text-xs text-muted-foreground">{meta}</Text>
    </PressableScale>
  );
}
