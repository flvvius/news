import { SignInPrompt } from "@/components/SignInPrompt";
import UserMenu from "@/components/user-menu";
import BiasBalanceMeter from "@/components/bias-balance-meter";
import { CurrentMonthReadingCalendar } from "@/components/current-month-reading-calendar";
import { RecentReadingItem } from "@/components/activity/recent-reading-item";
import { PageLoadingState } from "@/components/ui/page-loading-state";
import { SectionTitle } from "@/components/ui/section-title";
import { getLocaleFromMatches } from "@/lib/i18n/getLocaleFromMatches";
import { useLocale, useT } from "@/lib/i18n/LocaleContext";
import { getString } from "@/lib/i18n/strings";
import { api } from "@news-app/backend/convex/_generated/api";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useConvexAuth, useQuery } from "convex/react";
import { formatRelativeTimestamp } from "@/lib/dates";
import { Bookmark, ChevronRight } from "lucide-react";
import { QuizCta } from "@/components/quiz-cta";

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
  const readingCalendarDays = dashboardOverview?.readingCalendar.days ?? [];
  const activeReadingDays = dashboardOverview?.readingCalendar.activeDays ?? 0;
  const weeklyBiasReads = dashboardOverview?.weeklyBiasSummary.reads ?? 0;
  const weeklyBiasBalance = dashboardOverview?.weeklyBiasSummary.balance ?? 0;
  const nextStreakMilestone = getNextStreakMilestone(readingStreak);

  return (
    <div className="min-h-[calc(100vh-4rem)] bg-background">
      <div className="container mx-auto max-w-4xl px-4 py-8 sm:py-12">
        <header className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <p className="text-sm text-muted-foreground">
              {t("activity.welcomeBack")}
            </p>
            <h1 className="truncate text-3xl font-semibold tracking-tight">
              {userName.split(" ")[0]}
            </h1>
          </div>
          <UserMenu />
        </header>

        {/* Stats read as figures, not as tiles. The numeral carries the
            weight; the label sits under it in muted small text. */}
        <div className="mt-8 grid grid-cols-2 gap-x-6 gap-y-8 border-t border-border pt-6 sm:grid-cols-4">
          <Stat
            value={readingStreak}
            label={t("activity.dayStreak")}
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
          <Stat value={articlesRead} label={t("activity.articlesRead")} />
          <Stat value={eventsExplored} label={t("activity.eventsExplored")} />
          <Stat value={bookmarkCount} label={t("activity.bookmarked")} />
        </div>

        <div className="mt-10">
          <QuizCta variant="activity" />
        </div>

        <section className="mt-10 border-t border-border pt-6">
          <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-3">
            <div>
              <SectionTitle>{t("activity.section")}</SectionTitle>
              <p className="mt-1 text-sm text-muted-foreground">
                {t("activity.currentMonthReading")}
              </p>
            </div>
            <div className="flex gap-6">
              <MiniStat
                value={readingStreak}
                label={t("activity.current")}
              />
              <MiniStat value={longestStreak} label={t("activity.best")} />
              <MiniStat
                value={activeReadingDays}
                label={t("activity.activeReadingDays")}
              />
            </div>
          </div>
          <div className="mt-6">
            <CurrentMonthReadingCalendar days={readingCalendarDays} />
          </div>
        </section>

        <section className="mt-10 border-t border-border pt-6">
          <SectionTitle>{t("activity.biasBalance")}</SectionTitle>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("activity.biasMix")}
          </p>
          <div className="mt-6 max-w-xl">
            <BiasBalanceMeter value={biasBalance} />
          </div>
          {weeklyBiasReads > 0 && (
            <p className="mt-4 text-sm text-muted-foreground">
              {getBiasSnapshotLabel(weeklyBiasBalance, t)}{" "}
              {t("activity.biasReads").replace(
                "{count}",
                String(weeklyBiasReads),
              )}
            </p>
          )}
        </section>

        <section className="mt-10 border-t border-border pt-6">
          <div className="flex items-baseline justify-between gap-4">
            <div>
              <SectionTitle>{t("activity.recentReading")}</SectionTitle>
              <p className="mt-1 text-sm text-muted-foreground">
                {t("activity.recentReadingBody")}
              </p>
            </div>
            <Link
              to="/"
              className="inline-flex shrink-0 items-center gap-1 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              {t("tabs.feed")}
              <ChevronRight className="size-4" />
            </Link>
          </div>
          <div className="mt-5">
            {recentHistory.length === 0 ? (
              /* One quiet line — no dashed box (native DESIGN_LOG). */
              <p className="text-sm text-muted-foreground">
                {t("activity.readingHistoryEmpty")}
              </p>
            ) : (
              <div className="divide-y divide-border">
                {recentHistory.slice(0, 4).map((entry) => (
                  <div key={entry.event._id} className="py-3 first:pt-0">
                    <RecentReadingItem entry={entry} />
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>

        <section className="mt-10 border-t border-border pt-6">
          <div className="flex items-baseline justify-between gap-4">
            <div>
              <SectionTitle>{t("activity.savedLabel")}</SectionTitle>
              <p className="mt-1 text-sm text-muted-foreground">
                {t("activity.savedSub")}
              </p>
            </div>
            <Link
              to="/salvate"
              className="inline-flex shrink-0 items-center gap-1 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              {t("activity.savedAll")}
              <ChevronRight className="size-4" />
            </Link>
          </div>
          <div className="mt-5">
            {recentBookmarks.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {t("activity.savedEmpty")}
              </p>
            ) : (
              <div className="divide-y divide-border">
                {recentBookmarks.slice(0, 4).map((entry) => (
                  <Link
                    key={entry.event._id}
                    to="/event/$slug"
                    params={{ slug: entry.event.slug }}
                    className="group flex gap-3 py-3 first:pt-0"
                  >
                    <div className="size-14 shrink-0 overflow-hidden rounded-lg border border-border bg-muted">
                      {entry.event.imageUrl ? (
                        <img
                          src={entry.event.imageUrl}
                          alt=""
                          className="size-full object-cover"
                          loading="lazy"
                        />
                      ) : (
                        <div className="flex size-full items-center justify-center text-muted-foreground">
                          <Bookmark className="size-5" />
                        </div>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="line-clamp-2 text-sm font-medium leading-snug transition-colors group-hover:text-primary">
                        {entry.event.title}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {formatRelativeTimestamp(entry.bookmarkedAt, locale)} ·{" "}
                        {(entry.event.sourceCount ?? 0) === 1
                          ? t("activity.sourcesOne")
                          : t("activity.sourcesMany").replace(
                              "{count}",
                              String(entry.event.sourceCount ?? 0),
                            )}
                      </p>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </div>
        </section>

        {/* Quick actions were two bordered panels with icon chips. They are
            navigation, so they read as navigation: hairline rows. */}
        <nav className="mt-10 divide-y divide-border border-t border-border">
          <Link
            to="/"
            className="group flex items-center justify-between gap-4 py-4"
          >
            <div>
              <p className="text-sm font-medium transition-colors group-hover:text-primary">
                {t("activity.feedCard")}
              </p>
              <p className="mt-0.5 text-sm text-muted-foreground">
                {t("activity.feedCardBody")}
              </p>
            </div>
            <ChevronRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
          </Link>

          <Link
            to="/salvate"
            className="group flex items-center justify-between gap-4 py-4"
          >
            <div>
              <p className="text-sm font-medium transition-colors group-hover:text-primary">
                {t("activity.savedCard")}
              </p>
              <p className="mt-0.5 text-sm text-muted-foreground">
                {bookmarkCount === 1
                  ? t("activity.savedOne")
                  : t("activity.savedMany").replace(
                      "{count}",
                      String(bookmarkCount),
                    )}
              </p>
            </div>
            <ChevronRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
          </Link>
        </nav>
      </div>
    </div>
  );
}

function Stat({
  value,
  label,
  hint,
}: {
  value: number;
  label: string;
  hint?: string;
}) {
  return (
    <div>
      <p className="text-3xl font-semibold tabular-nums tracking-tight">
        {value}
      </p>
      <p className="mt-1 text-sm text-muted-foreground">{label}</p>
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

function MiniStat({ value, label }: { value: number; label: string }) {
  return (
    <div>
      <p className="text-lg font-semibold tabular-nums">{value}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}
