import { SignInPrompt } from "@/components/SignInPrompt";
import UserMenu from "@/components/user-menu";
import BiasBalanceMeter from "@/components/bias-balance-meter";
import StreakActivityCalendar from "@/components/streak-activity-calendar";
import { Button } from "@/components/ui/button";
import { PageLoadingState } from "@/components/ui/page-loading-state";
import { getLocaleFromMatches } from "@/lib/i18n/getLocaleFromMatches";
import { useLocale, useT } from "@/lib/i18n/LocaleContext";
import { getString } from "@/lib/i18n/strings";
import { api } from "@news-app/backend/convex/_generated/api";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useConvexAuth, useQuery } from "convex/react";
import { formatRelativeTimestamp } from "@/lib/dates";
import {
  Bookmark,
  ChevronRight,
  Flame,
  Newspaper,
  Sparkles,
} from "lucide-react";
import { QuizCta } from "@/components/quiz-cta";

function formatReadDuration(
  t: ReturnType<typeof useT>,
  seconds?: number,
) {
  if (!seconds || seconds <= 0) return null;
  if (seconds < 60) {
    return t("read.duration.seconds").replace("{count}", String(seconds));
  }
  const minutes = Math.round(seconds / 60);
  return t("read.duration.minutes").replace("{count}", String(minutes));
}

function formatScrollDepth(
  t: ReturnType<typeof useT>,
  percentage?: number,
) {
  if (percentage === undefined) return null;
  return t("scroll.depth").replace(
    "{count}",
    String(Math.round(percentage * 100)),
  );
}

function getBiasSnapshotLabel(
  balance: number,
  t: ReturnType<typeof useT>,
) {
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

export const Route = createFileRoute("/activitate")({
  head: ({ matches }) => {
    const locale = getLocaleFromMatches(matches);

    return {
      meta: [
        { title: getString(locale, "activity.metaTitle") },
        { name: "robots", content: "noindex, nofollow" },
      ],
    };
  },
  component: RouteComponent,
});

function RouteComponent() {
  const t = useT();
  const { isAuthenticated, isLoading } = useConvexAuth();
  const currentUser = useQuery(
    api.user.getCurrentUser,
    isAuthenticated ? {} : "skip",
  );

  if (isLoading || (isAuthenticated && currentUser === undefined)) {
    return (
      <PageLoadingState
        title={t("activity.checking.title")}
        description={t("activity.checking.body")}
        cardCount={2}
      />
    );
  }

  if (!currentUser) {
    return (
      <SignInPrompt
        title={t("activity.empty.title")}
        description={t("activity.empty.body")}
        redirectTo="/activitate"
      />
    );
  }

  return (
    <AuthorizedDashboard currentUser={currentUser} />
  );
}

function AuthorizedDashboard({
  currentUser,
}: {
  currentUser: NonNullable<ReturnType<typeof useQuery<typeof api.user.getCurrentUser>>>;
}) {
  const locale = useLocale();
  const t = useT();
  const dashboardOverview = useQuery(api.interactions.getDashboardOverview);

  if (dashboardOverview === undefined) {
    return (
      <PageLoadingState
        title={t("activity.loading.title")}
        description={t("activity.loading.body")}
        cardCount={3}
      />
    );
  }

  const userName =
    currentUser?.profile?.name || currentUser?.email || t("activity.userFallback");
  const readingStreak =
    dashboardOverview?.stats.currentStreak ??
    currentUser?.stats.currentStreak ??
    0;
  const longestStreak =
    dashboardOverview?.stats.longestStreak ??
    currentUser?.stats.longestStreak ??
    0;
  const articlesRead =
    dashboardOverview?.stats.articlesRead ??
    currentUser?.stats.articlesRead ??
    0;
  const biasBalance =
    dashboardOverview?.stats.biasBalance ?? currentUser?.stats.biasBalance ?? 0;
  const bookmarkCount = dashboardOverview?.stats.bookmarkCount ?? 0;
  const eventsExplored = dashboardOverview?.stats.eventsExplored ?? 0;
  const recentHistory = dashboardOverview?.recentHistory ?? [];
  const recentBookmarks = dashboardOverview?.recentBookmarks ?? [];
  const streakDays = dashboardOverview?.streakCalendar.days ?? [];
  const activeDays = dashboardOverview?.streakCalendar.activeDays ?? 0;
  const weeklyBiasReads = dashboardOverview?.weeklyBiasSummary.reads ?? 0;
  const weeklyBiasBalance = dashboardOverview?.weeklyBiasSummary.balance ?? 0;
  const nextStreakMilestone = getNextStreakMilestone(readingStreak);

  return (
    <div className="min-h-[calc(100vh-4rem)] bg-background">
      <div className="container mx-auto max-w-5xl px-4 py-8 sm:py-12">
        <div className="flex flex-col gap-8">
          {/* Header - Clean and minimal */}
          <header className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className="flex size-14 items-center justify-center rounded-full bg-primary/10 text-2xl font-bold text-primary">
                {userName.charAt(0).toUpperCase()}
              </div>
              <div>
                <p className="text-sm text-muted-foreground">
                  {t("activity.welcomeBack")}
                </p>
                <h1 className="text-2xl font-bold tracking-tight">
                  {userName.split(" ")[0]}
                </h1>
              </div>
            </div>
            <UserMenu />
          </header>

          {/* Bento Grid - Main Stats */}
          <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
            {/* Streak - Prominent */}
            <div className="rounded-xl border border-border bg-card p-4 sm:p-5">
              <div className="flex items-center gap-3">
                <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10">
                  <Flame className="size-5 text-primary" />
                </div>
                <div>
                  <p className="text-2xl font-bold tabular-nums">
                    {readingStreak}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {t("activity.dayStreak")}
                  </p>
                </div>
              </div>
              {nextStreakMilestone && readingStreak > 0 && (
                <p className="mt-3 text-xs text-muted-foreground">
                  {t("activity.daysToGoal")
                    .replace(
                      "{count}",
                      String(nextStreakMilestone - readingStreak),
                    )
                    .replace("{milestone}", String(nextStreakMilestone))}
                </p>
              )}
            </div>

            {/* Articles Read */}
            <div className="rounded-xl border border-border bg-card p-4 sm:p-5">
              <div className="flex items-center gap-3">
                <div className="flex size-10 items-center justify-center rounded-lg bg-muted">
                  <Newspaper className="size-5 text-muted-foreground" />
                </div>
                <div>
                  <p className="text-2xl font-bold tabular-nums">
                    {articlesRead}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {t("activity.articlesRead")}
                  </p>
                </div>
              </div>
            </div>

            {/* Events Explored */}
            <div className="rounded-xl border border-border bg-card p-4 sm:p-5">
              <div className="flex items-center gap-3">
                <div className="flex size-10 items-center justify-center rounded-lg bg-muted">
                  <Sparkles className="size-5 text-muted-foreground" />
                </div>
                <div>
                  <p className="text-2xl font-bold tabular-nums">
                    {eventsExplored}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {t("activity.eventsExplored")}
                  </p>
                </div>
              </div>
            </div>

            {/* Bookmarks */}
            <div className="rounded-xl border border-border bg-card p-4 sm:p-5">
              <div className="flex items-center gap-3">
                <div className="flex size-10 items-center justify-center rounded-lg bg-muted">
                  <Bookmark className="size-5 text-muted-foreground" />
                </div>
                <div>
                  <p className="text-2xl font-bold tabular-nums">
                    {bookmarkCount}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {t("activity.bookmarked")}
                  </p>
                </div>
              </div>
            </div>
          </div>

          <QuizCta variant="activity" />

          {/* Activity + Bias Row */}
          <div className="grid gap-4 lg:grid-cols-[1.3fr_0.7fr]">
            {/* Activity Calendar */}
            <div className="rounded-xl border border-border bg-card p-6">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <h2 className="font-semibold">{t("activity.section")}</h2>
                  <p className="text-sm text-muted-foreground">
                    {t("activity.last12Weeks")}
                  </p>
                </div>
                <div className="flex gap-6 text-center">
                  <div>
                    <p className="text-lg font-bold tabular-nums">
                      {readingStreak}
                    </p>
                    <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                      {t("activity.current")}
                    </p>
                  </div>
                  <div>
                    <p className="text-lg font-bold tabular-nums">
                      {longestStreak}
                    </p>
                    <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                      {t("activity.best")}
                    </p>
                  </div>
                  <div>
                    <p className="text-lg font-bold tabular-nums">
                      {activeDays}
                    </p>
                    <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                      {t("activity.active")}
                    </p>
                  </div>
                </div>
              </div>
              <div className="mt-5">
                <StreakActivityCalendar days={streakDays} />
              </div>
            </div>

            {/* Bias Balance */}
            <div className="rounded-xl border border-border bg-card p-6">
              <h2 className="font-semibold">{t("activity.biasBalance")}</h2>
              <p className="text-sm text-muted-foreground">
                {t("activity.biasMix")}
              </p>
              <div className="mt-5">
                <BiasBalanceMeter value={biasBalance} />
              </div>
              {weeklyBiasReads > 0 && (
                <p className="mt-4 text-xs text-muted-foreground">
                  {getBiasSnapshotLabel(weeklyBiasBalance, t)}{" "}
                  {t("activity.biasReads").replace(
                    "{count}",
                    String(weeklyBiasReads),
                  )}
                </p>
              )}
            </div>
          </div>

          {/* Recent Activity */}
          <div className="grid gap-4 lg:grid-cols-2">
            {/* Reading History */}
            <div className="rounded-xl border border-border bg-card">
              <div className="flex items-center justify-between gap-4 border-b border-border px-5 py-4">
                <div>
                  <h2 className="font-semibold">{t("activity.recentReading")}</h2>
                  <p className="text-sm text-muted-foreground">
                    {t("activity.recentReadingBody")}
                  </p>
                </div>
                <Button asChild variant="ghost" size="sm">
                  <Link to="/feed" className="gap-1">
                    {t("tabs.feed")}
                    <ChevronRight className="size-4" />
                  </Link>
                </Button>
              </div>
              <div className="p-5">
                {recentHistory.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-border bg-muted/30 px-4 py-8 text-center text-sm text-muted-foreground">
                    {t("activity.readingHistoryEmpty")}
                  </div>
                ) : (
                  <div className="space-y-3">
                    {recentHistory.slice(0, 4).map((entry) => {
                      const durationLabel = formatReadDuration(
                        t,
                        entry.metadata.timeSpentSeconds,
                      );
                      const scrollLabel = formatScrollDepth(
                        t,
                        entry.metadata.scrollDepthPercentage,
                      );
                      const detailBits = [durationLabel, scrollLabel].filter(
                        Boolean,
                      );

                      return (
                        <Link
                          key={entry.event._id}
                          to="/event/$slug"
                          params={{ slug: entry.event.slug }}
                          className="group flex gap-3 rounded-lg p-2 -mx-2 transition-colors hover:bg-muted/50"
                        >
                          <div className="size-14 shrink-0 overflow-hidden rounded-lg bg-muted">
                            {entry.event.imageUrl ? (
                              <img
                                src={entry.event.imageUrl}
                                alt=""
                                className="size-full object-cover"
                                loading="lazy"
                              />
                            ) : (
                              <div className="flex size-full items-center justify-center text-xs text-muted-foreground">
                                <Newspaper className="size-5" />
                              </div>
                            )}
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="line-clamp-2 text-sm font-medium leading-snug group-hover:text-primary">
                              {entry.event.title}
                            </p>
                            <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                              <span>
                                {formatRelativeTimestamp(
                                  entry.lastViewedAt,
                                  locale,
                                )}
                              </span>
                              {detailBits.length > 0 && (
                                <>
                                  <span>·</span>
                                  <span>{detailBits.join(" · ")}</span>
                                </>
                              )}
                            </div>
                          </div>
                        </Link>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            {/* Salvate */}
            <div className="rounded-xl border border-border bg-card">
              <div className="flex items-center justify-between gap-4 border-b border-border px-5 py-4">
                <div>
                  <h2 className="font-semibold">{t("activity.savedLabel")}</h2>
                  <p className="text-sm text-muted-foreground">
                    {t("activity.savedSub")}
                  </p>
                </div>
                <Button asChild variant="ghost" size="sm">
                  <Link to="/salvate" className="gap-1">
                    {t("activity.savedAll")}
                    <ChevronRight className="size-4" />
                  </Link>
                </Button>
              </div>
              <div className="p-5">
                {recentBookmarks.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-border bg-muted/30 px-4 py-8 text-center text-sm text-muted-foreground">
                    {t("activity.savedEmpty")}
                  </div>
                ) : (
                  <div className="space-y-3">
                    {recentBookmarks.slice(0, 4).map((entry) => (
                      <Link
                        key={entry.event._id}
                        to="/event/$slug"
                        params={{ slug: entry.event.slug }}
                        className="group flex gap-3 rounded-lg p-2 -mx-2 transition-colors hover:bg-muted/50"
                      >
                        <div className="size-14 shrink-0 overflow-hidden rounded-lg bg-muted">
                          {entry.event.imageUrl ? (
                            <img
                              src={entry.event.imageUrl}
                              alt=""
                              className="size-full object-cover"
                              loading="lazy"
                            />
                          ) : (
                            <div className="flex size-full items-center justify-center text-xs text-muted-foreground">
                              <Bookmark className="size-5" />
                            </div>
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="line-clamp-2 text-sm font-medium leading-snug group-hover:text-primary">
                            {entry.event.title}
                          </p>
                          <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                            <span>
                              {formatRelativeTimestamp(
                                entry.bookmarkedAt,
                                locale,
                              )}
                            </span>
                            <span>·</span>
                            <span>
                              {(entry.event.sourceCount ?? 0) === 1
                                ? t("activity.sourcesOne")
                                : t("activity.sourcesMany").replace(
                                    "{count}",
                                    String(entry.event.sourceCount ?? 0),
                                  )}
                            </span>
                          </div>
                        </div>
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Quick Actions */}
          <div className="grid gap-3 sm:grid-cols-2">
            <Link
              to="/feed"
              className="group flex items-center gap-4 rounded-xl border border-border bg-card p-5 transition-colors hover:border-primary/50 hover:bg-primary/5"
            >
              <div className="flex size-12 items-center justify-center rounded-xl bg-primary/10 text-primary transition-colors group-hover:bg-primary group-hover:text-primary-foreground">
                <Newspaper className="size-6" />
              </div>
              <div>
                <h3 className="font-semibold">{t("activity.feedCard")}</h3>
                <p className="text-sm text-muted-foreground">
                  {t("activity.feedCardBody")}
                </p>
              </div>
            </Link>

            <Link
              to="/salvate"
              className="group flex items-center gap-4 rounded-xl border border-border bg-card p-5 transition-colors hover:border-primary/50 hover:bg-primary/5"
            >
              <div className="flex size-12 items-center justify-center rounded-xl bg-primary/10 text-primary transition-colors group-hover:bg-primary group-hover:text-primary-foreground">
                <Bookmark className="size-6" />
              </div>
              <div>
                <h3 className="font-semibold">{t("activity.savedCard")}</h3>
                <p className="text-sm text-muted-foreground">
                  {bookmarkCount === 1
                    ? t("activity.savedOne")
                    : t("activity.savedMany").replace(
                        "{count}",
                        String(bookmarkCount),
                      )}
                </p>
              </div>
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
