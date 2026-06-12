import { api } from "@news-app/backend/convex/_generated/api";
import type { Id } from "@news-app/backend/convex/_generated/dataModel";
import { useConvexAuth, useMutation } from "convex/react";
import { useRouter } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";

import { SourceAvatar } from "@/components/source-avatar";
import { Icon } from "@/components/ui/icon";
import { useT } from "@/contexts/locale-context";
import {
  getBiasBucket,
  getBiasLabelKey,
  validateBiasThresholds,
  DEFAULT_BIAS_THRESHOLDS,
  type BiasBucket,
} from "@/lib/bias";
import { cn } from "@/lib/cn";
import {
  uniqueEventSources,
  type EventArticle,
  type EventSource,
} from "@/lib/event-types";
import { NATIVE_DEVICE_TYPE } from "@/lib/interactions";

const COLLAPSED_COUNT = 5;

const BUCKET_TEXT: Record<BiasBucket, string> = {
  left: "text-bias-left",
  center: "text-bias-center",
  right: "text-bias-right",
};

type EventSourcesProps = {
  eventId: Id<"events">;
  articles: EventArticle[];
  biasThresholds?: number[];
};

/**
 * Compact source rows: outlet → its profile, trailing action → the outlet's
 * original article in the in-app browser. Collapsed to five by default.
 */
export function EventSources({
  eventId,
  articles,
  biasThresholds,
}: EventSourcesProps) {
  const router = useRouter();
  const t = useT();
  const { isAuthenticated } = useConvexAuth();
  const logInteraction = useMutation(api.interactions.logInteraction);
  const [showAll, setShowAll] = useState(false);

  const thresholds = validateBiasThresholds(
    biasThresholds ?? DEFAULT_BIAS_THRESHOLDS,
  );
  const sources = useMemo(() => uniqueEventSources(articles), [articles]);

  // Each source links to its most recent article on this event.
  const latestArticleBySource = useMemo(() => {
    const map = new Map<string, EventArticle>();
    for (const article of articles) {
      if (!article.source) continue;
      const key = String(article.source._id);
      const current = map.get(key);
      if (!current || article.publishedAt > current.publishedAt) {
        map.set(key, article);
      }
    }
    return map;
  }, [articles]);

  const openArticle = (source: EventSource, article: EventArticle) => {
    if (isAuthenticated) {
      logInteraction({
        eventId,
        articleId: article._id,
        type: "click_source",
        context: {
          biasRating: source.baseBias ?? 0,
          sourceReliability: source.reliabilityScore ?? 0,
        },
        metadata: { deviceType: NATIVE_DEVICE_TYPE },
      }).catch(() => {
        // Analytics logging must never block reading the article.
      });
    }
    WebBrowser.openBrowserAsync(article.canonicalUrl).catch(() => {
      // Browser unavailable — nothing actionable for the user here.
    });
  };

  if (sources.length === 0) return null;

  const visibleSources = showAll ? sources : sources.slice(0, COLLAPSED_COUNT);
  const hiddenCount = sources.length - COLLAPSED_COUNT;

  return (
    <View className="gap-1">
      <Text className="text-2xl font-semibold tracking-tight text-foreground">
        {t("native.event.sourcesTitle")}
      </Text>

      <View>
        {visibleSources.map((source, index) => {
          const article = latestArticleBySource.get(String(source._id));
          const bucket = getBiasBucket(source);
          return (
            <View
              key={source._id}
              className={cn(
                "flex-row items-center gap-3 py-3",
                index < visibleSources.length - 1 &&
                  "border-b border-border/70",
              )}
            >
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={source.name}
                onPress={() => router.push(`/source/${source._id}`)}
                hitSlop={6}
                className="min-w-0 flex-1 flex-row items-center gap-3 active:opacity-70"
              >
                <SourceAvatar
                  name={source.name}
                  logoUrl={source.logoUrl}
                  recyclingKey={source._id}
                  sizeClassName="size-9"
                  sizePx={36}
                  className="shrink-0"
                />
                <View className="min-w-0 flex-1">
                  <Text
                    numberOfLines={1}
                    className="text-lg font-medium text-foreground"
                  >
                    {source.name}
                  </Text>
                  <View className="flex-row items-baseline gap-2">
                    <Text
                      className={cn("text-sm font-medium", BUCKET_TEXT[bucket])}
                    >
                      {t(getBiasLabelKey(source.baseBias, thresholds))}
                    </Text>
                    <Text className="text-sm text-muted-foreground">
                      {t("source.reliability").replace(
                        "{score}",
                        String(source.reliabilityScore),
                      )}
                    </Text>
                  </View>
                </View>
              </Pressable>

              {article ? (
                <Pressable
                  accessibilityRole="link"
                  accessibilityLabel={t("articles.readOriginal")}
                  onPress={() => openArticle(source, article)}
                  hitSlop={10}
                  className="size-11 items-center justify-center active:opacity-70"
                >
                  <Icon
                    name="open-outline"
                    size={17}
                    className="text-muted-foreground"
                  />
                </Pressable>
              ) : null}
            </View>
          );
        })}
      </View>

      {hiddenCount > 0 ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={
            showAll
              ? t("native.event.showFewerSources")
              : t("native.event.showAllSources").replace(
                  "{count}",
                  String(sources.length),
                )
          }
          accessibilityState={{ expanded: showAll }}
          onPress={() => setShowAll((value) => !value)}
          className="min-h-11 flex-row items-center gap-1 self-start active:opacity-70"
        >
          <Text className="text-base font-medium text-primary">
            {showAll
              ? t("native.event.showFewerSources")
              : t("native.event.showAllSources").replace(
                  "{count}",
                  String(sources.length),
                )}
          </Text>
          <Icon
            name={showAll ? "chevron-up" : "chevron-down"}
            size={13}
            className="text-primary"
          />
        </Pressable>
      ) : null}
    </View>
  );
}
