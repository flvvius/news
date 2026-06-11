import { api } from "@news-app/backend/convex/_generated/api";
import type { FunctionReturnType } from "convex/server";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { useRouter } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { useEffect, useMemo, useState } from "react";
import { Alert, Pressable, ScrollView, Text, View } from "react-native";
import { formatRelativeTimestamp } from "@news-app/i18n";

import { BiasBalanceMeter } from "@/components/activity/bias-balance-meter";
import { StreakActivityCalendar } from "@/components/activity/streak-activity-calendar";
import { AuthField } from "@/components/auth/auth-field";
import { Screen } from "@/components/screen";
import { Icon, type IconName } from "@/components/ui/icon";
import { Image } from "@/components/ui/image";
import { QueryBoundary } from "@/components/ui/query-boundary";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/state-views";
import { useLocale, useT } from "@/contexts/locale-context";
import { cn } from "@/lib/cn";
import { SITE_URL } from "@/lib/site";

type DashboardOverview = NonNullable<
  FunctionReturnType<typeof api.interactions.getDashboardOverview>
>;
type HistoryEntry = DashboardOverview["recentHistory"][number];
type BookmarkEntry = DashboardOverview["recentBookmarks"][number];
type CurrentUser = NonNullable<
  FunctionReturnType<typeof api.user.getCurrentUser>
>;

const TOPIC_INFERENCE_DEFAULTS = {
  minScore: 4.5,
  confidenceRatio: 0.55,
  maxTopics: 3,
} as const;

function getNumericConfigValue(
  row: { value: unknown } | null | undefined,
  fallback: number,
) {
  return typeof row?.value === "number" && Number.isFinite(row.value)
    ? row.value
    : fallback;
}

function formatReadDuration(t: ReturnType<typeof useT>, seconds?: number) {
  if (!seconds || seconds <= 0) return null;
  if (seconds < 60) {
    return t("read.duration.seconds").replace("{count}", String(seconds));
  }
  const minutes = Math.round(seconds / 60);
  return t("read.duration.minutes").replace("{count}", String(minutes));
}

function formatScrollDepth(t: ReturnType<typeof useT>, percentage?: number) {
  if (percentage === undefined) return null;
  return t("scroll.depth").replace(
    "{count}",
    String(Math.round(percentage * 100)),
  );
}

function getBiasSnapshotLabel(balance: number, t: ReturnType<typeof useT>) {
  const absolute = Math.abs(balance);
  if (absolute < 15) return t("activity.biasSnapshot.balanced");
  if (balance < 0) {
    return absolute >= 60
      ? t("activity.biasSnapshot.leftStrong")
      : t("activity.biasSnapshot.left");
  }
  return absolute >= 60
    ? t("activity.biasSnapshot.rightStrong")
    : t("activity.biasSnapshot.right");
}

function getNextStreakMilestone(streak: number) {
  const milestones = [7, 30, 100, 365];
  return milestones.find((milestone) => milestone > streak) ?? null;
}

export default function ActivityScreen() {
  const t = useT();

  return (
    <Screen>
      <QueryBoundary
        title={t("activity.loading.title")}
        body={t("native.error.body")}
      >
        <ActivityContent />
      </QueryBoundary>
    </Screen>
  );
}

function ActivitySkeleton() {
  return (
    <View className="flex-1 gap-5 px-4 pt-5">
      <View className="flex-row items-center gap-4">
        <Skeleton className="size-14 rounded-full" />
        <View className="gap-2">
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-6 w-36" />
        </View>
      </View>
      <View className="flex-row gap-3">
        <Skeleton className="h-24 flex-1 rounded-xl" />
        <Skeleton className="h-24 flex-1 rounded-xl" />
      </View>
      <View className="flex-row gap-3">
        <Skeleton className="h-24 flex-1 rounded-xl" />
        <Skeleton className="h-24 flex-1 rounded-xl" />
      </View>
      <Skeleton className="h-56 rounded-xl" />
      <Skeleton className="h-44 rounded-xl" />
    </View>
  );
}

function ActivityContent() {
  const router = useRouter();
  const t = useT();
  const { isAuthenticated, isLoading } = useConvexAuth();
  const currentUser = useQuery(
    api.user.getCurrentUser,
    isAuthenticated ? {} : "skip",
  );

  if (isLoading || (isAuthenticated && currentUser === undefined)) {
    return <ActivitySkeleton />;
  }

  if (!currentUser) {
    return (
      <View className="flex-1 px-4 pt-6">
        <EmptyState
          icon="flame-outline"
          title={t("activity.empty.title")}
          body={t("activity.empty.body")}
          actionLabel={t("auth.signIn")}
          onAction={() => router.push("/auth")}
        />
      </View>
    );
  }

  return <ActivityDashboard currentUser={currentUser} />;
}

function StatTile({
  icon,
  value,
  label,
  prominent = false,
  hint,
}: {
  icon: IconName;
  value: number;
  label: string;
  prominent?: boolean;
  hint?: string;
}) {
  return (
    <View className="flex-1 rounded-xl border border-border/80 bg-card p-4">
      <View className="flex-row items-center gap-3">
        <View
          className={cn(
            "size-10 items-center justify-center rounded-lg",
            prominent ? "bg-primary/10" : "bg-muted",
          )}
        >
          <Icon
            name={icon}
            size={20}
            className={prominent ? "text-primary" : "text-muted-foreground"}
          />
        </View>
        <View className="min-w-0 flex-1">
          <Text className="text-2xl font-bold tabular-nums text-foreground">
            {value}
          </Text>
          <Text className="text-xs text-muted-foreground" numberOfLines={1}>
            {label}
          </Text>
        </View>
      </View>
      {hint ? (
        <Text className="mt-3 text-xs text-muted-foreground">{hint}</Text>
      ) : null}
    </View>
  );
}

function CardHeaderLink({
  title,
  subtitle,
  linkLabel,
  onPress,
}: {
  title: string;
  subtitle: string;
  linkLabel: string;
  onPress: () => void;
}) {
  return (
    <View className="flex-row items-center justify-between gap-4 border-b border-border/70 px-5 py-4">
      <View className="min-w-0 flex-1">
        <Text className="font-semibold text-card-foreground">{title}</Text>
        <Text className="text-sm text-muted-foreground">{subtitle}</Text>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={linkLabel}
        onPress={onPress}
        className="min-h-11 flex-row items-center gap-1 rounded-lg px-2 active:bg-muted/50"
      >
        <Text className="text-sm font-medium text-foreground">{linkLabel}</Text>
        <Icon
          name="chevron-forward"
          size={16}
          className="text-muted-foreground"
        />
      </Pressable>
    </View>
  );
}

function ListEmptyNote({ text }: { text: string }) {
  return (
    <View className="rounded-lg border border-dashed border-border bg-muted/30 px-4 py-8">
      <Text className="text-center text-sm text-muted-foreground">{text}</Text>
    </View>
  );
}

function EventRow({
  event,
  meta,
  fallbackIcon,
}: {
  event: HistoryEntry["event"];
  meta: string;
  fallbackIcon: IconName;
}) {
  const router = useRouter();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={event.title}
      onPress={() => router.push(`/event/${event.slug}`)}
      className="flex-row gap-3 rounded-lg py-1.5 active:bg-muted/50"
    >
      <View className="size-14 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-muted">
        {event.imageUrl ? (
          <Image
            source={{ uri: event.imageUrl }}
            contentFit="cover"
            className="size-full"
          />
        ) : (
          <Icon name={fallbackIcon} size={20} className="text-muted-foreground" />
        )}
      </View>
      <View className="min-w-0 flex-1">
        <Text
          numberOfLines={2}
          className="text-sm font-medium leading-snug text-foreground"
        >
          {event.title}
        </Text>
        <Text className="mt-1 text-xs text-muted-foreground" numberOfLines={1}>
          {meta}
        </Text>
      </View>
    </Pressable>
  );
}

function QuickActionCard({
  icon,
  title,
  body,
  onPress,
}: {
  icon: IconName;
  title: string;
  body: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      onPress={onPress}
      className="flex-row items-center gap-4 rounded-xl border border-border/80 bg-card p-5 active:border-primary/50 active:bg-primary/5"
    >
      <View className="size-12 items-center justify-center rounded-xl bg-primary/10">
        <Icon name={icon} size={24} className="text-primary" />
      </View>
      <View className="min-w-0 flex-1">
        <Text className="font-semibold text-card-foreground">{title}</Text>
        <Text className="text-sm text-muted-foreground">{body}</Text>
      </View>
    </Pressable>
  );
}

function ActivityDashboard({ currentUser }: { currentUser: CurrentUser }) {
  const router = useRouter();
  const locale = useLocale();
  const t = useT();
  const dashboardOverview = useQuery(api.interactions.getDashboardOverview);
  const isAdmin = useQuery(api.user.isCurrentUserAdmin);

  const openQuiz = () => {
    WebBrowser.openBrowserAsync(`${SITE_URL}/quiz`).catch(() => {
      Alert.alert(
        t("native.about.browserErrorTitle"),
        t("native.about.browserErrorBody"),
      );
    });
  };

  if (dashboardOverview === undefined || isAdmin === undefined) {
    return <ActivitySkeleton />;
  }

  const userName =
    currentUser.profile?.name || currentUser.email || t("activity.userFallback");
  const readingStreak =
    dashboardOverview?.stats.currentStreak ??
    currentUser.stats.currentStreak ??
    0;
  const longestStreak =
    dashboardOverview?.stats.longestStreak ??
    currentUser.stats.longestStreak ??
    0;
  const articlesRead =
    dashboardOverview?.stats.articlesRead ?? currentUser.stats.articlesRead ?? 0;
  const biasBalance =
    dashboardOverview?.stats.biasBalance ?? currentUser.stats.biasBalance ?? 0;
  const bookmarkCount = dashboardOverview?.stats.bookmarkCount ?? 0;
  const eventsExplored = dashboardOverview?.stats.eventsExplored ?? 0;
  const recentHistory = dashboardOverview?.recentHistory ?? [];
  const recentBookmarks = dashboardOverview?.recentBookmarks ?? [];
  const streakDays = dashboardOverview?.streakCalendar.days ?? [];
  const activeDays = dashboardOverview?.streakCalendar.activeDays ?? 0;
  const weeklyBiasReads = dashboardOverview?.weeklyBiasSummary.reads ?? 0;
  const weeklyBiasBalance = dashboardOverview?.weeklyBiasSummary.balance ?? 0;
  const nextStreakMilestone = getNextStreakMilestone(readingStreak);

  const historyMeta = (entry: HistoryEntry) => {
    const detailBits = [
      formatRelativeTimestamp(entry.lastViewedAt, locale),
      formatReadDuration(t, entry.metadata.timeSpentSeconds),
      formatScrollDepth(t, entry.metadata.scrollDepthPercentage),
    ].filter(Boolean);
    return detailBits.join(" · ");
  };

  const bookmarkMeta = (entry: BookmarkEntry) => {
    const sourcesLabel =
      (entry.event.sourceCount ?? 0) === 1
        ? t("activity.sourcesOne")
        : t("activity.sourcesMany").replace(
            "{count}",
            String(entry.event.sourceCount ?? 0),
          );
    return `${formatRelativeTimestamp(entry.bookmarkedAt, locale)} · ${sourcesLabel}`;
  };

  return (
    <ScrollView
      className="flex-1"
      contentContainerClassName="gap-6 px-4 pb-10 pt-5"
    >
      {/* Header */}
      <View className="flex-row items-center gap-4">
        <View className="size-14 items-center justify-center rounded-full bg-primary/10">
          <Text className="text-2xl font-bold text-primary">
            {userName.charAt(0).toUpperCase()}
          </Text>
        </View>
        <View className="min-w-0 flex-1">
          <Text className="text-sm text-muted-foreground">
            {t("activity.welcomeBack")}
          </Text>
          <Text
            numberOfLines={1}
            className="text-2xl font-bold tracking-tight text-foreground"
          >
            {userName.split(" ")[0]}
          </Text>
        </View>
      </View>

      {/* Stats grid */}
      <View className="gap-3">
        <View className="flex-row gap-3">
          <StatTile
            icon="flame-outline"
            value={readingStreak}
            label={t("activity.dayStreak")}
            prominent
            hint={
              nextStreakMilestone && readingStreak > 0
                ? t("activity.daysToGoal")
                    .replace(
                      "{count}",
                      String(nextStreakMilestone - readingStreak),
                    )
                    .replace("{milestone}", String(nextStreakMilestone))
                : undefined
            }
          />
          <StatTile
            icon="newspaper-outline"
            value={articlesRead}
            label={t("activity.articlesRead")}
          />
        </View>
        <View className="flex-row gap-3">
          <StatTile
            icon="sparkles-outline"
            value={eventsExplored}
            label={t("activity.eventsExplored")}
          />
          <StatTile
            icon="bookmark-outline"
            value={bookmarkCount}
            label={t("activity.bookmarked")}
          />
        </View>
      </View>

      {/* Quiz CTA */}
      <View className="gap-4 rounded-xl border border-border/80 bg-card p-4">
        <View className="flex-row items-start gap-3">
          <View className="size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10">
            <Icon name="bulb-outline" size={20} className="text-primary" />
          </View>
          <View className="min-w-0 flex-1">
            <Text className="font-semibold text-card-foreground">
              {t("quiz.cta.activityTitle")}
            </Text>
            <Text className="text-sm text-muted-foreground">
              {t("quiz.cta.activityBody")}
            </Text>
          </View>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("quiz.cta.action")}
          onPress={openQuiz}
          className="min-h-11 items-center justify-center self-start rounded-full bg-primary px-6 active:opacity-80"
        >
          <Text className="text-sm font-medium text-primary-foreground">
            {t("quiz.cta.action")}
          </Text>
        </Pressable>
      </View>

      {/* Activity calendar */}
      <View className="gap-5 rounded-xl border border-border/80 bg-card p-5">
        <View className="flex-row items-end justify-between gap-4">
          <View className="min-w-0 flex-1">
            <Text className="font-semibold text-card-foreground">
              {t("activity.section")}
            </Text>
            <Text className="text-sm text-muted-foreground">
              {t("activity.last12Weeks")}
            </Text>
          </View>
          <View className="flex-row gap-5">
            {[
              { value: readingStreak, label: t("activity.current") },
              { value: longestStreak, label: t("activity.best") },
              { value: activeDays, label: t("activity.active") },
            ].map(({ value, label }) => (
              <View key={label} className="items-center">
                <Text className="text-lg font-bold tabular-nums text-foreground">
                  {value}
                </Text>
                <Text className="text-[11px] uppercase tracking-wide text-muted-foreground">
                  {label}
                </Text>
              </View>
            ))}
          </View>
        </View>
        <StreakActivityCalendar days={streakDays} />
      </View>

      {/* Bias balance */}
      <View className="gap-5 rounded-xl border border-border/80 bg-card p-5">
        <View>
          <Text className="font-semibold text-card-foreground">
            {t("activity.biasBalance")}
          </Text>
          <Text className="text-sm text-muted-foreground">
            {t("activity.biasMix")}
          </Text>
        </View>
        <BiasBalanceMeter value={biasBalance} />
        {weeklyBiasReads > 0 ? (
          <Text className="text-xs text-muted-foreground">
            {getBiasSnapshotLabel(weeklyBiasBalance, t)}{" "}
            {t("activity.biasReads").replace(
              "{count}",
              String(weeklyBiasReads),
            )}
          </Text>
        ) : null}
      </View>

      {/* Recent reading */}
      <View className="overflow-hidden rounded-xl border border-border/80 bg-card">
        <CardHeaderLink
          title={t("activity.recentReading")}
          subtitle={t("activity.recentReadingBody")}
          linkLabel={t("tabs.feed")}
          onPress={() => router.push("/")}
        />
        <View className="gap-3 px-5 py-5">
          {recentHistory.length === 0 ? (
            <ListEmptyNote text={t("activity.readingHistoryEmpty")} />
          ) : (
            recentHistory
              .slice(0, 4)
              .map((entry) => (
                <EventRow
                  key={entry.event._id}
                  event={entry.event}
                  meta={historyMeta(entry)}
                  fallbackIcon="newspaper-outline"
                />
              ))
          )}
        </View>
      </View>

      {/* Saved */}
      <View className="overflow-hidden rounded-xl border border-border/80 bg-card">
        <CardHeaderLink
          title={t("activity.savedLabel")}
          subtitle={t("activity.savedSub")}
          linkLabel={t("activity.savedAll")}
          onPress={() => router.push("/saved")}
        />
        <View className="gap-3 px-5 py-5">
          {recentBookmarks.length === 0 ? (
            <ListEmptyNote text={t("activity.savedEmpty")} />
          ) : (
            recentBookmarks
              .slice(0, 4)
              .map((entry) => (
                <EventRow
                  key={entry.event._id}
                  event={entry.event}
                  meta={bookmarkMeta(entry)}
                  fallbackIcon="bookmark-outline"
                />
              ))
          )}
        </View>
      </View>

      {/* Quick actions */}
      <View className="gap-3">
        <QuickActionCard
          icon="newspaper-outline"
          title={t("activity.feedCard")}
          body={t("activity.feedCardBody")}
          onPress={() => router.push("/")}
        />
        <QuickActionCard
          icon="bookmark-outline"
          title={t("activity.savedCard")}
          body={
            bookmarkCount === 1
              ? t("activity.savedOne")
              : t("activity.savedMany").replace(
                  "{count}",
                  String(bookmarkCount),
                )
          }
          onPress={() => router.push("/saved")}
        />
      </View>

      {isAdmin ? <AdminTopicDiagnostics /> : null}
    </ScrollView>
  );
}

// ---------------------------------------------------------------------------
// Admin: topic inference diagnostics + config (mirrors the web activity page)
// ---------------------------------------------------------------------------

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-1 rounded-lg border border-border/80 bg-background p-3">
      <Text
        numberOfLines={1}
        className="text-xs uppercase tracking-wide text-muted-foreground"
      >
        {label}
      </Text>
      <Text className="mt-1 text-lg font-semibold tabular-nums text-foreground">
        {value}
      </Text>
    </View>
  );
}

function TopicChipList({ label, topics }: { label: string; topics: string[] }) {
  const t = useT();

  return (
    <View className="flex-row flex-wrap items-center gap-1.5">
      <Text className="text-xs text-muted-foreground">{label}:</Text>
      {topics.length > 0 ? (
        topics.map((topic) => (
          <View
            key={`${label}-${topic}`}
            className="rounded-full bg-muted px-2 py-0.5"
          >
            <Text className="text-xs text-foreground">{topic}</Text>
          </View>
        ))
      ) : (
        <Text className="text-xs text-muted-foreground">
          {t("activity.none")}
        </Text>
      )}
    </View>
  );
}

function AdminTopicDiagnostics() {
  const t = useT();
  const topicDiagnostics = useQuery(
    api.clustering.getRecentTopicInferenceDiagnosticsForAdmin,
    { limit: 10 },
  );
  const minScoreConfig = useQuery(api.config.get, {
    key: "topic_inference_min_score",
  });
  const confidenceRatioConfig = useQuery(api.config.get, {
    key: "topic_inference_confidence_ratio",
  });
  const maxTopicsConfig = useQuery(api.config.get, {
    key: "topic_inference_max_topics",
  });
  const topicInferenceBounds = useQuery(api.config.getTopicInferenceBounds);
  const setTopicInferenceSettings = useMutation(
    api.config.setTopicInferenceSettings,
  );
  const [minScoreInput, setMinScoreInput] = useState("");
  const [confidenceRatioInput, setConfidenceRatioInput] = useState("");
  const [maxTopicsInput, setMaxTopicsInput] = useState("");
  const [configMessage, setConfigMessage] = useState("");
  const [isSavingConfig, setIsSavingConfig] = useState(false);
  const currentSettings = useMemo(
    () => ({
      minScore: getNumericConfigValue(
        minScoreConfig,
        TOPIC_INFERENCE_DEFAULTS.minScore,
      ),
      confidenceRatio: getNumericConfigValue(
        confidenceRatioConfig,
        TOPIC_INFERENCE_DEFAULTS.confidenceRatio,
      ),
      maxTopics: getNumericConfigValue(
        maxTopicsConfig,
        TOPIC_INFERENCE_DEFAULTS.maxTopics,
      ),
    }),
    [minScoreConfig, confidenceRatioConfig, maxTopicsConfig],
  );

  useEffect(() => {
    setMinScoreInput(String(currentSettings.minScore));
    setConfidenceRatioInput(String(currentSettings.confidenceRatio));
    setMaxTopicsInput(String(currentSettings.maxTopics));
  }, [
    currentSettings.minScore,
    currentSettings.confidenceRatio,
    currentSettings.maxTopics,
  ]);

  const hasConfigChanges =
    minScoreInput !== String(currentSettings.minScore) ||
    confidenceRatioInput !== String(currentSettings.confidenceRatio) ||
    maxTopicsInput !== String(currentSettings.maxTopics);

  const handleResetConfig = () => {
    setMinScoreInput(String(currentSettings.minScore));
    setConfidenceRatioInput(String(currentSettings.confidenceRatio));
    setMaxTopicsInput(String(currentSettings.maxTopics));
    setConfigMessage("");
  };

  const handleSaveConfig = async () => {
    if (isSavingConfig) return;

    const minScore = Number(minScoreInput);
    const confidenceRatio = Number(confidenceRatioInput);
    const maxTopics = Number(maxTopicsInput);

    if (!topicInferenceBounds) return;

    if (
      !Number.isFinite(minScore) ||
      minScore < topicInferenceBounds.minScore.min ||
      minScore > topicInferenceBounds.minScore.max
    ) {
      setConfigMessage(t("activity.admin.minScoreError"));
      return;
    }
    if (
      !Number.isFinite(confidenceRatio) ||
      confidenceRatio < topicInferenceBounds.confidenceRatio.min ||
      confidenceRatio > topicInferenceBounds.confidenceRatio.max
    ) {
      setConfigMessage(t("activity.admin.confidenceError"));
      return;
    }
    if (
      !Number.isInteger(maxTopics) ||
      maxTopics < topicInferenceBounds.maxTopics.min ||
      maxTopics > topicInferenceBounds.maxTopics.max
    ) {
      setConfigMessage(t("activity.admin.maxTopicsError"));
      return;
    }

    setIsSavingConfig(true);
    setConfigMessage("");

    try {
      await setTopicInferenceSettings({ minScore, confidenceRatio, maxTopics });
      setConfigMessage(t("activity.admin.saved"));
    } catch (error) {
      console.error("Failed to save topic inference settings:", error);
      setConfigMessage(t("activity.admin.saveError"));
    } finally {
      setIsSavingConfig(false);
    }
  };

  return (
    <View className="gap-4 rounded-xl border border-border/80 bg-card p-5">
      <View>
        <Text className="text-lg font-semibold text-card-foreground">
          {t("activity.adminTitle")}
        </Text>
        <Text className="text-sm text-muted-foreground">
          {t("activity.adminBody")}
        </Text>
      </View>

      <View className="flex-row gap-3">
        <MetricCard
          label={t("activity.admin.minScore")}
          value={String(currentSettings.minScore)}
        />
        <MetricCard
          label={t("activity.admin.confidence")}
          value={String(currentSettings.confidenceRatio)}
        />
        <MetricCard
          label={t("activity.admin.maxTopics")}
          value={String(currentSettings.maxTopics)}
        />
      </View>

      <View className="gap-3">
        <AuthField
          label={t("activity.admin.minScore")}
          value={minScoreInput}
          onChangeText={setMinScoreInput}
          keyboardType="decimal-pad"
          editable={!isSavingConfig}
        />
        <AuthField
          label={t("activity.admin.confidence")}
          value={confidenceRatioInput}
          onChangeText={setConfidenceRatioInput}
          keyboardType="decimal-pad"
          editable={!isSavingConfig}
        />
        <AuthField
          label={t("activity.admin.maxTopics")}
          value={maxTopicsInput}
          onChangeText={setMaxTopicsInput}
          keyboardType="number-pad"
          editable={!isSavingConfig}
        />
      </View>

      <View className="flex-row flex-wrap items-center gap-3">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("activity.admin.save")}
          onPress={() => void handleSaveConfig()}
          disabled={isSavingConfig || !hasConfigChanges || !topicInferenceBounds}
          className={cn(
            "min-h-11 items-center justify-center rounded-full bg-primary px-6 active:opacity-80",
            (isSavingConfig || !hasConfigChanges || !topicInferenceBounds) &&
              "opacity-50",
          )}
        >
          <Text className="text-sm font-medium text-primary-foreground">
            {isSavingConfig
              ? t("activity.admin.saving")
              : t("activity.admin.save")}
          </Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("activity.admin.reset")}
          onPress={handleResetConfig}
          disabled={isSavingConfig || !hasConfigChanges}
          className={cn(
            "min-h-11 items-center justify-center rounded-full border border-border px-6 active:bg-muted/50",
            (isSavingConfig || !hasConfigChanges) && "opacity-50",
          )}
        >
          <Text className="text-sm font-medium text-foreground">
            {t("activity.admin.reset")}
          </Text>
        </Pressable>
      </View>
      {configMessage ? (
        <Text accessibilityLiveRegion="polite" className="text-sm text-muted-foreground">
          {configMessage}
        </Text>
      ) : null}

      <View className="gap-3">
        {(topicDiagnostics ?? []).map((event) => (
          <View
            key={event.eventId}
            className="gap-4 rounded-lg border border-border/80 bg-background p-4"
          >
            <View className="gap-2">
              <View>
                <Text className="font-medium text-foreground">
                  {event.eventTitle}
                </Text>
                <Text className="text-sm text-muted-foreground">
                  {event.articleCount === 1
                    ? t("activity.admin.articles.one")
                    : t("activity.admin.articles.many").replace(
                        "{count}",
                        String(event.articleCount),
                      )}
                </Text>
              </View>
              <TopicChipList
                label={t("activity.admin.attached")}
                topics={event.attachedTopics.map(
                  (topic) => topic.displayName,
                )}
              />
              <TopicChipList
                label={t("activity.admin.inferred")}
                topics={event.inferredTopics.map(
                  (topic) => topic.displayName,
                )}
              />
            </View>

            <View>
              <Text className="text-xs font-medium text-muted-foreground">
                {t("activity.admin.input")}
              </Text>
              <View className="mt-2 gap-1">
                <Text className="text-sm text-muted-foreground">
                  {event.inferenceInput.title}
                </Text>
                {event.inferenceInput.summary ? (
                  <Text className="text-sm text-muted-foreground">
                    {event.inferenceInput.summary}
                  </Text>
                ) : null}
              </View>
            </View>

            {event.inferenceInput.atomicFacts.length > 0 ? (
              <View>
                <Text className="text-xs font-medium text-muted-foreground">
                  {t("activity.admin.facts")}
                </Text>
                <View className="mt-2 flex-row flex-wrap gap-1">
                  {event.inferenceInput.atomicFacts.map((fact) => (
                    <View
                      key={fact}
                      className="rounded-full bg-muted px-2 py-0.5"
                    >
                      <Text className="text-xs text-foreground">{fact}</Text>
                    </View>
                  ))}
                </View>
              </View>
            ) : null}

            <View>
              <Text className="text-xs font-medium text-muted-foreground">
                {t("activity.admin.candidates")}
              </Text>
              <View className="mt-2 gap-2">
                {event.topCandidates.map((candidate) => (
                  <View
                    key={candidate.slug}
                    className="flex-row items-center justify-between gap-3 rounded-lg border border-border/80 p-2"
                  >
                    <View className="min-w-0 flex-1">
                      <Text className="text-sm font-medium text-foreground">
                        {candidate.displayName}
                      </Text>
                      <Text className="text-xs text-muted-foreground">
                        {t("activity.admin.signals").replace(
                          "{count}",
                          String(candidate.signalCount),
                        )}
                      </Text>
                    </View>
                    <Text className="text-sm font-semibold tabular-nums text-foreground">
                      {candidate.score}
                    </Text>
                  </View>
                ))}
              </View>
            </View>
          </View>
        ))}
      </View>
    </View>
  );
}
