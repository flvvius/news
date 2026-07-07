import { api } from "@news-app/backend/convex/_generated/api";
import type { Id } from "@news-app/backend/convex/_generated/dataModel";
import { FlashList } from "@shopify/flash-list";
import type { FunctionReturnType } from "convex/server";
import { useQuery } from "convex/react";
import { useLocalSearchParams, useRouter } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { Pressable, Text, View } from "react-native";
import { formatRelativeTimestamp } from "@news-app/i18n";

import { BiasIndicator } from "@/components/bias-indicator";
import { Screen } from "@/components/screen";
import { SourceAvatar } from "@/components/source-avatar";
import { Icon } from "@/components/ui/icon";
import { Image } from "@/components/ui/image";
import { QueryBoundary } from "@/components/ui/query-boundary";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/state-views";
import { useLocale, useT } from "@/contexts/locale-context";
import { cn } from "@/lib/cn";

type SourceProfile = NonNullable<
  FunctionReturnType<typeof api.sources.getSourceProfile>
>;
type SourceArticle = SourceProfile["articles"][number];

function parseSourceId(value: string | undefined): Id<"sources"> | null {
  const trimmed = value?.trim() ?? "";
  if (!/^[a-z0-9]{16,64}$/i.test(trimmed)) return null;
  return trimmed as Id<"sources">;
}

function isNumberArray(value: unknown): value is number[] {
  return (
    Array.isArray(value) &&
    value.every((item) => typeof item === "number" && Number.isFinite(item))
  );
}

function formatBiasLabel(label: string) {
  return label
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("-");
}

function formatOptional(value: string | undefined, fallback: string) {
  if (!value) return fallback;
  return value
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function openExternal(url: string) {
  WebBrowser.openBrowserAsync(url).catch(() => {
    // Browser unavailable — nothing actionable for the user here.
  });
}

export default function SourceProfileScreen() {
  const t = useT();

  return (
    <Screen>
      <QueryBoundary title={t("source.notFound")} body={t("native.error.body")}>
        <SourceProfileContent />
      </QueryBoundary>
    </Screen>
  );
}

function BackToFeedRow() {
  const router = useRouter();
  const t = useT();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t("source.backToFeed")}
      onPress={() => {
        if (router.canGoBack()) {
          router.back();
        } else {
          router.replace("/");
        }
      }}
      hitSlop={8}
      className="min-h-11 flex-row items-center gap-1.5 self-start active:opacity-70"
    >
      <Icon name="chevron-back" size={18} className="text-muted-foreground" />
      <Text className="text-sm font-medium text-muted-foreground">
        {t("source.backToFeed")}
      </Text>
    </Pressable>
  );
}

function SourceSkeleton() {
  return (
    <View className="flex-1 gap-6 px-5 pt-2">
      <Skeleton className="h-6 w-32" />
      <View className="flex-row items-center gap-4">
        <Skeleton className="size-16 rounded-lg" />
        <View className="flex-1 gap-2">
          <Skeleton className="h-7 w-44" />
          <Skeleton className="h-4 w-28" />
        </View>
      </View>
      <Skeleton className="h-14 rounded-lg" />
      <Skeleton className="h-40 rounded-lg" />
      <Skeleton className="h-32 rounded-lg" />
    </View>
  );
}

function SourceProfileContent() {
  const router = useRouter();
  const t = useT();
  const { sourceId } = useLocalSearchParams<{ sourceId: string }>();
  const parsedSourceId = parseSourceId(sourceId);

  const data = useQuery(
    api.sources.getSourceProfile,
    parsedSourceId ? { sourceId: parsedSourceId, limit: 60 } : "skip",
  );

  if (!parsedSourceId) {
    return (
      <View className="flex-1 px-4 pt-6">
        <EmptyState
          icon="cloud-offline-outline"
          title={t("source.notFound")}
          body={t("source.invalidBody")}
          actionLabel={t("source.backToFeed")}
          onAction={() => router.replace("/")}
        />
      </View>
    );
  }

  if (data === undefined) {
    return <SourceSkeleton />;
  }

  if (data === null) {
    return (
      <View className="flex-1 px-4 pt-6">
        <EmptyState
          icon="cloud-offline-outline"
          title={t("source.notFound")}
          body={t("source.notFoundBody")}
          actionLabel={t("source.backToFeed")}
          onAction={() => router.replace("/")}
        />
      </View>
    );
  }

  return <SourceProfileView data={data} />;
}

function StatColumn({ value, label }: { value: string; label: string }) {
  return (
    <View className="flex-1 items-center gap-0.5 px-1">
      <Text className="text-lg font-semibold tabular-nums text-foreground">
        {value}
      </Text>
      <Text
        numberOfLines={1}
        className="text-[11px] uppercase tracking-wide text-muted-foreground"
      >
        {label}
      </Text>
    </View>
  );
}

function CredibilityRow({
  label,
  value,
  detail,
  isFirst = false,
}: {
  label: string;
  value: string;
  detail?: string;
  isFirst?: boolean;
}) {
  return (
    <View
      className={cn("gap-0.5 py-3", !isFirst && "border-t border-border/60")}
    >
      <Text className="text-xs text-muted-foreground">{label}</Text>
      <Text className="text-[16px] font-medium text-foreground">{value}</Text>
      {detail ? (
        <Text className="text-sm text-muted-foreground">{detail}</Text>
      ) : null}
    </View>
  );
}

function ArticleRow({
  article,
  isLast,
}: {
  article: SourceArticle;
  isLast: boolean;
}) {
  const router = useRouter();
  const locale = useLocale();
  const t = useT();
  const shownText = article.summary ?? article.rssSnippet;
  const isOutlier = article.biasOutlierFlag || article.sourceBiasOutlierFlag;

  return (
    <View
      className={cn("gap-2.5 py-4", !isLast && "border-b border-border/60")}
    >
      <View className="flex-row flex-wrap items-center gap-2">
        <Text className="text-xs text-muted-foreground">
          {formatRelativeTimestamp(article.publishedAt, locale)}
        </Text>
        {typeof article.aiBiasScore === "number" ? (
          <Text className="text-xs text-muted-foreground">
            ·{" "}
            {t("source.aiBias").replace(
              "{count}",
              article.aiBiasScore.toFixed(1),
            )}
          </Text>
        ) : null}
        {isOutlier ? (
          <Text className="text-xs font-medium text-warning">
            · {t("source.outlier")}
          </Text>
        ) : null}
      </View>

      <View className="flex-row gap-3">
        <View className="min-w-0 flex-1 gap-1.5">
          <Text className="text-[16px] font-semibold leading-snug tracking-tight text-foreground">
            {article.title}
          </Text>
          {shownText ? (
            <Text
              numberOfLines={2}
              className="text-sm leading-relaxed text-muted-foreground"
            >
              {shownText}
            </Text>
          ) : null}
        </View>
        {article.imageUrl ? (
          <View className="size-16 shrink-0 overflow-hidden rounded-lg bg-muted">
            <Image
              source={{ uri: article.imageUrl }}
              recyclingKey={article._id}
              contentFit="cover"
              transition={120}
              className="size-full"
              accessibilityLabel={article.imageAlt ?? article.title}
            />
          </View>
        ) : null}
      </View>

      <View className="flex-row flex-wrap items-center gap-x-4 gap-y-1">
        {article.event ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("source.relatedEvent")}
            onPress={() => router.push(`/event/${article.event!.slug}`)}
            hitSlop={6}
            className="min-h-9 max-w-full flex-row items-center gap-1 active:opacity-70"
          >
            <Icon name="albums-outline" size={13} className="text-primary" />
            <Text
              numberOfLines={1}
              className="shrink text-sm font-medium text-primary"
            >
              {t("source.relatedEvent")}
            </Text>
          </Pressable>
        ) : (
          <Text className="text-xs text-muted-foreground">
            {t("source.notClustered")}
          </Text>
        )}
        <Pressable
          accessibilityRole="link"
          accessibilityLabel={t("articles.readOriginal")}
          onPress={() => openExternal(article.canonicalUrl)}
          hitSlop={6}
          className="min-h-9 flex-row items-center gap-1 active:opacity-70"
        >
          <Text className="text-sm font-medium text-primary">
            {t("articles.readOriginal")}
          </Text>
          <Icon name="open-outline" size={12} className="text-primary" />
        </Pressable>
      </View>
    </View>
  );
}

function SourceProfileView({ data }: { data: SourceProfile }) {
  const t = useT();
  const thresholdsConfig = useQuery(api.config.get, { key: "bias_thresholds" });
  const thresholdsValue = thresholdsConfig?.value;
  const thresholds = isNumberArray(thresholdsValue)
    ? thresholdsValue
    : undefined;

  const { source, stats, articles } = data;
  const averageAiBias = stats.averageAiBias;

  const header = (
    <View className="gap-6 pb-6">
      <BackToFeedRow />

      {/* Identity — typographic, single composition */}
      <View className="flex-row items-center gap-4">
        <SourceAvatar
          name={source.name}
          logoUrl={source.logoUrl}
          sizeClassName="size-16"
          sizePx={64}
          className="rounded-lg"
        />
        <View className="min-w-0 flex-1 gap-1">
          <Text className="text-2xl font-semibold tracking-tight text-foreground">
            {source.name}
          </Text>
          <Pressable
            accessibilityRole="link"
            accessibilityLabel={source.domain}
            onPress={() => openExternal(`https://${source.domain}`)}
            hitSlop={6}
            className="flex-row items-center gap-1 self-start active:opacity-70"
          >
            <Text className="text-sm font-medium text-primary">
              {source.domain}
            </Text>
            <Icon name="open-outline" size={12} className="text-primary" />
          </Pressable>
        </View>
      </View>

      {/* Metadata reads as a plain meta line — chips would shout. */}
      <View className="flex-row flex-wrap items-center gap-x-2.5 gap-y-1.5">
        <BiasIndicator
          bias={source.baseBias}
          size="md"
          thresholds={thresholds}
        />
        <Text className="text-xs font-medium text-muted-foreground">
          {formatBiasLabel(source.biasLabel)}
          {" · "}
          {t("source.reliability").replace(
            "{score}",
            String(source.reliabilityScore),
          )}
        </Text>
      </View>

      {/* KPI strip */}
      <View className="flex-row items-center">
        <StatColumn
          value={String(stats.totalArticles)}
          label={t("source.recentArticles")}
        />
        <View className="h-8 w-px bg-border/70" />
        <StatColumn
          value={String(stats.eventCount)}
          label={t("source.events")}
        />
        <View className="h-8 w-px bg-border/70" />
        <StatColumn
          value={
            averageAiBias === null
              ? t("source.notRated")
              : averageAiBias.toFixed(1)
          }
          label={t("source.aiBiasAvg")}
        />
        <View className="h-8 w-px bg-border/70" />
        <StatColumn
          value={String(stats.biasOutlierCount + stats.sourceBiasOutlierCount)}
          label={t("source.outliers")}
        />
      </View>

      {/* Credibility */}
      <View className="gap-1">
        <Text className="text-base font-semibold tracking-tight text-foreground">
          {t("source.credibilityTitle")}
        </Text>
        <View>
          <CredibilityRow
            label={t("source.mbfcCategory")}
            value={formatOptional(source.mbfcCategory, t("source.notRated"))}
            isFirst
          />
          <CredibilityRow
            label={t("source.factualRating")}
            value={formatOptional(source.mbfcFactual, t("source.notRated"))}
          />
          <CredibilityRow
            label={t("source.credibilityLabel")}
            value={formatOptional(source.mbfcCredibility, t("source.notRated"))}
          />
          <CredibilityRow
            label={t("source.rollingSample")}
            value={t("source.rollingArticles").replace(
              "{count}",
              String(source.rollingBiasSampleSize ?? 0),
            )}
            detail={
              typeof source.rollingBiasMean === "number"
                ? `${t("source.mean").replace(
                    "{value}",
                    source.rollingBiasMean.toFixed(1),
                  )}${
                    typeof source.rollingBiasStddev === "number"
                      ? ` · ${t("source.stddev").replace(
                          "{value}",
                          source.rollingBiasStddev.toFixed(1),
                        )}`
                      : ""
                  }`
                : undefined
            }
          />
        </View>
      </View>

      <Text className="text-base font-semibold tracking-tight text-foreground">
        {t("source.recentReporting")}
      </Text>
    </View>
  );

  return (
    <FlashList
      data={articles}
      keyExtractor={(article: SourceArticle) => article._id}
      getItemType={() => "article-row"}
      contentContainerStyle={{
        paddingHorizontal: 20,
        paddingBottom: 40,
        paddingTop: 8,
      }}
      ListHeaderComponent={header}
      renderItem={({ item, index }: { item: SourceArticle; index: number }) => (
        <ArticleRow article={item} isLast={index === articles.length - 1} />
      )}
    />
  );
}
