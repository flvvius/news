import { api } from "@news-app/backend/convex/_generated/api";
import type { Id } from "@news-app/backend/convex/_generated/dataModel";
import { useConvexAuth, useMutation } from "convex/react";
import * as WebBrowser from "expo-web-browser";
import { useCallback } from "react";
import { Pressable, Text, View } from "react-native";

import { formatDate } from "@news-app/i18n";

import { BiasIndicator } from "@/components/bias-indicator";
import { SourceAvatar } from "@/components/source-avatar";
import { Icon } from "@/components/ui/icon";
import { Image } from "@/components/ui/image";
import { SectionCard } from "@/components/ui/section-card";
import { useLocale, useT } from "@/contexts/locale-context";
import type { EventArticle } from "@/lib/event-types";
import { NATIVE_DEVICE_TYPE } from "@/lib/interactions";

type ArticlesListProps = {
  eventId: Id<"events">;
  articles: EventArticle[];
  biasThresholds?: number[];
};

export function ArticlesList({
  eventId,
  articles,
  biasThresholds,
}: ArticlesListProps) {
  const t = useT();
  const locale = useLocale();
  const { isAuthenticated } = useConvexAuth();
  const logInteraction = useMutation(api.interactions.logInteraction);

  const openArticle = useCallback(
    (article: EventArticle) => {
      if (isAuthenticated) {
        logInteraction({
          eventId,
          articleId: article._id,
          type: "click_source",
          context: {
            biasRating: article.source?.baseBias ?? 0,
            sourceReliability: article.source?.reliabilityScore ?? 0,
          },
          metadata: { deviceType: NATIVE_DEVICE_TYPE },
        }).catch(() => {
          // Analytics logging must never block reading the article.
        });
      }
      WebBrowser.openBrowserAsync(article.canonicalUrl).catch(() => {
        // Browser unavailable — nothing actionable for the user here.
      });
    },
    [isAuthenticated, logInteraction, eventId],
  );

  return (
    <SectionCard title={`${t("articles.originalReporting")} (${articles.length})`}>
      <View className="gap-4">
        {articles.map((article) => (
          <View
            key={article._id}
            className="overflow-hidden rounded-2xl border border-border/70 bg-card"
          >
            <View
              className="overflow-hidden border-b border-border/70 bg-muted/40"
              style={{ aspectRatio: 4 / 3 }}
            >
              {article.imageUrl ? (
                <Image
                  source={{ uri: article.imageUrl }}
                  recyclingKey={article._id}
                  contentFit="cover"
                  transition={150}
                  className="size-full"
                  accessibilityLabel={article.imageAlt ?? article.title}
                />
              ) : (
                <View className="size-full items-center justify-center bg-muted">
                  <Text className="text-xs font-medium uppercase tracking-[1.8px] text-muted-foreground">
                    {article.source?.name ?? t("articles.source")}
                  </Text>
                </View>
              )}
            </View>

            <View className="gap-4 p-5">
              <View className="flex-row flex-wrap items-center gap-3">
                {article.source ? (
                  <>
                    <SourceAvatar
                      name={article.source.name}
                      logoUrl={article.source.logoUrl}
                      recyclingKey={article.source._id}
                    />
                    <View className="min-w-0 shrink gap-1">
                      <Text className="text-sm font-medium text-card-foreground">
                        {article.source.name}
                      </Text>
                      <BiasIndicator
                        bias={article.source.baseBias}
                        size="sm"
                        thresholds={biasThresholds}
                      />
                    </View>
                  </>
                ) : null}
                <Text className="ml-auto text-xs text-muted-foreground">
                  {formatDate(article.publishedAt, locale)}
                </Text>
              </View>

              <View className="gap-2">
                <Text className="text-lg font-semibold leading-snug tracking-tight text-card-foreground">
                  {article.title}
                </Text>
                {article.summary || article.rssSnippet ? (
                  <Text
                    numberOfLines={4}
                    className="max-w-[455px] text-sm leading-relaxed text-muted-foreground"
                  >
                    {article.summary ?? article.rssSnippet}
                  </Text>
                ) : null}
              </View>

              <Pressable
                accessibilityRole="link"
                accessibilityLabel={t("articles.readOriginalAria")}
                onPress={() => openArticle(article)}
                hitSlop={8}
                className="min-h-11 flex-row items-center gap-1 self-start active:opacity-70"
              >
                <Text className="text-sm font-medium text-primary">
                  {t("articles.readOriginal")}
                </Text>
                <Icon name="open-outline" size={13} className="text-primary" />
              </Pressable>
            </View>
          </View>
        ))}
      </View>
    </SectionCard>
  );
}
