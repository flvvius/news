import { api } from "@news-app/backend/convex/_generated/api";
import type { FunctionReturnType } from "convex/server";
import { useConvexAuth, useQuery } from "convex/react";
import { useRouter } from "expo-router";
import { Pressable, ScrollView, Text, View } from "react-native";
import { formatRelativeTimestamp } from "@news-app/i18n";

import { BiasBalanceMeter } from "@/components/activity/bias-balance-meter";
import { StreakActivityCalendar } from "@/components/activity/streak-activity-calendar";
import { Screen } from "@/components/screen";
import { Icon, type IconName } from "@/components/ui/icon";
import { Image } from "@/components/ui/image";
import { PressableScale } from "@/components/ui/pressable-scale";
import { QueryBoundary } from "@/components/ui/query-boundary";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/state-views";
import { useLocale, useT } from "@/contexts/locale-context";
import { cn } from "@/lib/cn";

type DashboardOverview = NonNullable<
  FunctionReturnType<typeof api.interactions.getDashboardOverview>
>;
type HistoryEntry = DashboardOverview["recentHistory"][number];
type BookmarkEntry = DashboardOverview["recentBookmarks"][number];
type CurrentUser = NonNullable<
  FunctionReturnType<typeof api.user.getCurrentUser>
>;

const STREAK_MILESTONES = [7, 30, 100, 365];

function getStreakMilestones(streak: number) {
  const next =
    STREAK_MILESTONES.find((milestone) => milestone > streak) ?? null;
  const previousIndex = next ? STREAK_MILESTONES.indexOf(next) - 1 : -1;
  const previous = previousIndex >= 0 ? STREAK_MILESTONES[previousIndex] : 0;
  return { previous, next };
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
    <View className="flex-1 gap-6 px-5 pt-6">
      <View className="gap-2">
        <Skeleton className="h-4 w-28" />
        <Skeleton className="h-8 w-40" />
      </View>
      <Skeleton className="h-36 rounded-lg" />
      <Skeleton className="h-16 rounded-xl" />
      <Skeleton className="h-44 rounded-xl" />
      <Skeleton className="h-32 rounded-xl" />
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

/** Uppercase kicker + optional trailing action — sections divide by type, not boxes. */
function SectionHeader({
  title,
  meta,
  actionLabel,
  onAction,
}: {
  title: string;
  meta?: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <View className="flex-row items-baseline justify-between gap-3">
      <Text className="text-base font-semibold tracking-tight text-foreground">
        {title}
      </Text>
      {actionLabel && onAction ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={actionLabel}
          onPress={onAction}
          hitSlop={10}
          className="flex-row items-center gap-0.5 active:opacity-70"
        >
          <Text className="text-sm font-medium text-primary">
            {actionLabel}
          </Text>
          <Icon name="chevron-forward" size={13} className="text-primary" />
        </Pressable>
      ) : meta ? (
        <Text className="text-xs text-muted-foreground">{meta}</Text>
      ) : null}
    </View>
  );
}

function StreakHero({
  streak,
  longestStreak,
}: {
  streak: number;
  longestStreak: number;
}) {
  const t = useT();
  const { previous, next } = getStreakMilestones(streak);
  const progress = next
    ? Math.min(1, Math.max(0, (streak - previous) / (next - previous)))
    : 1;

  return (
    <View className="gap-4 rounded-lg border border-border bg-card p-5">
      <View className="flex-row items-center gap-4">
        <Icon name="flame" size={34} className="text-primary" />
        <View className="min-w-0 flex-1">
          <View className="flex-row items-baseline gap-2">
            <Text className="text-4xl font-bold tabular-nums tracking-tight text-card-foreground">
              {streak}
            </Text>
            <Text className="text-sm text-muted-foreground">
              {t("activity.dayStreak")}
            </Text>
          </View>
        </View>
        <View className="items-end">
          <Text className="text-base font-semibold tabular-nums text-card-foreground">
            {longestStreak}
          </Text>
          <Text className="text-[12px] uppercase tracking-wide text-muted-foreground">
            {t("activity.best")}
          </Text>
        </View>
      </View>

      {next ? (
        <View className="gap-1.5">
          <View className="h-1.5 overflow-hidden rounded-full bg-muted">
            <View
              className="h-full rounded-full bg-primary"
              style={{ width: `${Math.max(progress * 100, 2)}%` }}
            />
          </View>
          <Text className="text-xs text-muted-foreground">
            {t("activity.daysToGoal")
              .replace("{count}", String(next - streak))
              .replace("{milestone}", String(next))}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

function StatColumn({ value, label }: { value: number; label: string }) {
  return (
    <View className="flex-1 items-center gap-0.5">
      <Text className="text-xl font-semibold tabular-nums text-foreground">
        {value}
      </Text>
      <Text
        numberOfLines={1}
        className="text-[12px] uppercase tracking-wide text-muted-foreground"
      >
        {label}
      </Text>
    </View>
  );
}

function EventRow({
  event,
  meta,
  fallbackIcon,
  isLast,
}: {
  event: HistoryEntry["event"];
  meta: string;
  fallbackIcon: IconName;
  isLast: boolean;
}) {
  const router = useRouter();

  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={event.title}
      onPress={() => router.push(`/event/${event.slug}`)}
      scaleTo={0.98}
      className={cn(!isLast && "border-b border-border/60")}
      contentClassName="flex-row items-center gap-3 py-3"
    >
      <View className="size-12 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-muted">
        {event.imageUrl ? (
          <Image
            source={{ uri: event.imageUrl }}
            contentFit="cover"
            className="size-full"
          />
        ) : (
          <Icon
            name={fallbackIcon}
            size={18}
            className="text-muted-foreground"
          />
        )}
      </View>
      <View className="min-w-0 flex-1">
        <Text
          numberOfLines={2}
          className="text-[16px] font-medium leading-snug text-foreground"
        >
          {event.title}
        </Text>
        <Text className="mt-1 text-xs text-muted-foreground" numberOfLines={1}>
          {meta}
        </Text>
      </View>
      <Icon
        name="chevron-forward"
        size={14}
        className="text-muted-foreground/60"
      />
    </PressableScale>
  );
}

function ListEmptyNote({ text }: { text: string }) {
  // Typographic empty note — no dashed-border costume.
  return (
    <Text className="py-4 text-sm leading-relaxed text-muted-foreground">
      {text}
    </Text>
  );
}

function ActivityDashboard({ currentUser }: { currentUser: CurrentUser }) {
  const router = useRouter();
  const locale = useLocale();
  const t = useT();
  const dashboardOverview = useQuery(api.interactions.getDashboardOverview);

  if (dashboardOverview === undefined) {
    return <ActivitySkeleton />;
  }

  const userName =
    currentUser.profile?.name ||
    currentUser.email ||
    t("activity.userFallback");
  const readingStreak =
    dashboardOverview?.stats.currentStreak ??
    currentUser.stats.currentStreak ??
    0;
  const longestStreak =
    dashboardOverview?.stats.longestStreak ??
    currentUser.stats.longestStreak ??
    0;
  const articlesRead =
    dashboardOverview?.stats.articlesRead ??
    currentUser.stats.articlesRead ??
    0;
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
      contentContainerClassName="gap-7 px-5 pb-8 pt-6"
    >
      {/* Header — typographic, no avatar chrome */}
      <View>
        <Text className="text-sm text-muted-foreground">
          {t("activity.welcomeBack")}
        </Text>
        <Text
          numberOfLines={1}
          className="text-3xl font-semibold tracking-tight text-foreground"
        >
          {userName.split(" ")[0]}
        </Text>
      </View>

      {/* The one hero element on this screen */}
      <StreakHero streak={readingStreak} longestStreak={longestStreak} />

      {/* KPI strip — plain figures with hairline dividers, no icon boxes */}
      <View className="flex-row items-center">
        <StatColumn value={articlesRead} label={t("activity.articlesRead")} />
        <View className="h-8 w-px bg-border/70" />
        <StatColumn
          value={eventsExplored}
          label={t("activity.eventsExplored")}
        />
        <View className="h-8 w-px bg-border/70" />
        <StatColumn value={bookmarkCount} label={t("activity.bookmarked")} />
      </View>

      {/* Reading consistency */}
      <View className="gap-4">
        <SectionHeader
          title={t("activity.last12Weeks")}
          meta={`${activeDays} ${t("activity.active").toLowerCase()}`}
        />
        <StreakActivityCalendar days={streakDays} />
      </View>

      {/* Perspective balance */}
      <View className="gap-4">
        <SectionHeader title={t("activity.biasBalance")} />
        <BiasBalanceMeter value={biasBalance} />
        {weeklyBiasReads > 0 ? (
          <Text className="text-xs leading-relaxed text-muted-foreground">
            {getBiasSnapshotLabel(weeklyBiasBalance, t)}{" "}
            {t("activity.biasReads").replace(
              "{count}",
              String(weeklyBiasReads),
            )}
          </Text>
        ) : null}
      </View>

      {/* Recent reading */}
      <View className="gap-1">
        <SectionHeader
          title={t("activity.recentReading")}
          actionLabel={t("tabs.feed")}
          onAction={() => router.push("/")}
        />
        {recentHistory.length === 0 ? (
          <View className="pt-2">
            <ListEmptyNote text={t("activity.readingHistoryEmpty")} />
          </View>
        ) : (
          <View>
            {recentHistory.slice(0, 4).map((entry, index, list) => (
              <EventRow
                key={entry.event._id}
                event={entry.event}
                meta={historyMeta(entry)}
                fallbackIcon="newspaper-outline"
                isLast={index === list.length - 1}
              />
            ))}
          </View>
        )}
      </View>

      {/* Saved */}
      <View className="gap-1">
        <SectionHeader
          title={t("activity.savedLabel")}
          actionLabel={t("activity.savedAll")}
          onAction={() => router.push("/saved")}
        />
        {recentBookmarks.length === 0 ? (
          <View className="pt-2">
            <ListEmptyNote text={t("activity.savedEmpty")} />
          </View>
        ) : (
          <View>
            {recentBookmarks.slice(0, 4).map((entry, index, list) => (
              <EventRow
                key={entry.event._id}
                event={entry.event}
                meta={bookmarkMeta(entry)}
                fallbackIcon="bookmark-outline"
                isLast={index === list.length - 1}
              />
            ))}
          </View>
        )}
      </View>
    </ScrollView>
  );
}
