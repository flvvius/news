import { SignInPrompt } from "@/components/SignInPrompt";
import UserMenu from "@/components/user-menu";
import BiasBalanceMeter from "@/components/bias-balance-meter";
import StreakActivityCalendar from "@/components/streak-activity-calendar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageLoadingState } from "@/components/ui/page-loading-state";
import { api } from "@news-app/backend/convex/_generated/api";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  Authenticated,
  AuthLoading,
  Unauthenticated,
  useMutation as useConvexMutationHook,
  useQuery,
} from "convex/react";
import type { FormEvent } from "react";
import { useEffect, useState } from "react";
import { formatRelativeTimestamp } from "@/lib/dates";
import {
  Bookmark,
  ChevronRight,
  Flame,
  Newspaper,
  Sparkles,
} from "lucide-react";

function formatReadDuration(seconds?: number) {
  if (!seconds || seconds <= 0) return null;
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.round(seconds / 60);
  return `${minutes} min`;
}

function formatScrollDepth(percentage?: number) {
  if (percentage === undefined) return null;
  return `${Math.round(percentage * 100)}% depth`;
}

function getBiasSnapshotLabel(balance: number) {
  const absolute = Math.abs(balance);
  if (absolute < 15) return "Balanced mix this week";
  if (balance < 0) {
    return absolute >= 60
      ? "Strongly left-leaning this week"
      : "Leaning left this week";
  }
  return absolute >= 60
    ? "Strongly right-leaning this week"
    : "Leaning right this week";
}

function getNextStreakMilestone(streak: number) {
  const milestones = [7, 30, 100, 365];
  return milestones.find((milestone) => milestone > streak) ?? null;
}

export const Route = createFileRoute("/activitate")({
  head: () => ({
    meta: [
      { title: "Activitate — Biviant" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: RouteComponent,
});

function RouteComponent() {
  return (
    <>
      <Authenticated>
        <AuthorizedDashboard />
      </Authenticated>
      <Unauthenticated>
        <SignInPrompt
          title="Urmărește-ți obiceiurile de citire"
          description="Vezi balanța de bias, streak-urile de citire și statisticile tale într-un singur loc."
          redirectTo="/activitate"
        />
      </Unauthenticated>
      <AuthLoading>
        <PageLoadingState
          title="Verificăm sesiunea"
          description="Pregătim activitatea ta și verificăm starea contului."
          cardCount={2}
        />
      </AuthLoading>
    </>
  );
}

function AuthorizedDashboard() {
  const currentUser = useQuery(api.user.getCurrentUser);
  const dashboardOverview = useQuery(api.interactions.getDashboardOverview);
  const isAdmin = useQuery(api.user.isCurrentUserAdmin);
  const topicDiagnostics = useQuery(
    api.clustering.getRecentTopicInferenceDiagnosticsForAdmin,
    isAdmin ? { limit: 10 } : "skip",
  );
  const setConfig = useConvexMutationHook(api.config.set);
  const [minScoreInput, setMinScoreInput] = useState("");
  const [confidenceRatioInput, setConfidenceRatioInput] = useState("");
  const [maxTopicsInput, setMaxTopicsInput] = useState("");
  const [configMessage, setConfigMessage] = useState("");
  const [isSavingConfig, setIsSavingConfig] = useState(false);
  const currentSettings = topicDiagnostics?.[0]?.settings;

  useEffect(() => {
    if (!currentSettings) return;
    setMinScoreInput(String(currentSettings.minScore));
    setConfidenceRatioInput(String(currentSettings.confidenceRatio));
    setMaxTopicsInput(String(currentSettings.maxTopics));
  }, [
    currentSettings?.minScore,
    currentSettings?.confidenceRatio,
    currentSettings?.maxTopics,
  ]);

  if (
    currentUser === undefined ||
    dashboardOverview === undefined ||
    isAdmin === undefined
  ) {
    return (
      <PageLoadingState
        title="Se încarcă activitatea"
        description="Pregătim salvările, streak-urile și statisticile tale."
        cardCount={3}
      />
    );
  }

  const hasConfigChanges =
    !!currentSettings &&
    (minScoreInput !== String(currentSettings.minScore) ||
      confidenceRatioInput !== String(currentSettings.confidenceRatio) ||
      maxTopicsInput !== String(currentSettings.maxTopics));

  const handleResetConfig = () => {
    if (!currentSettings) return;
    setMinScoreInput(String(currentSettings.minScore));
    setConfidenceRatioInput(String(currentSettings.confidenceRatio));
    setMaxTopicsInput(String(currentSettings.maxTopics));
    setConfigMessage("");
  };

  const handleSaveConfig = async (event: FormEvent) => {
    event.preventDefault();
    if (!currentSettings || isSavingConfig) return;

    const minScore = Number(minScoreInput);
    const confidenceRatio = Number(confidenceRatioInput);
    const maxTopics = Number(maxTopicsInput);

    if (!Number.isFinite(minScore) || minScore < 1 || minScore > 20) {
      setConfigMessage("Min score must be a number between 1 and 20.");
      return;
    }
    if (
      !Number.isFinite(confidenceRatio) ||
      confidenceRatio < 0.1 ||
      confidenceRatio > 1
    ) {
      setConfigMessage("Confidence ratio must be between 0.1 and 1.");
      return;
    }
    if (!Number.isInteger(maxTopics) || maxTopics < 1 || maxTopics > 5) {
      setConfigMessage("Max topics must be a whole number between 1 and 5.");
      return;
    }

    setIsSavingConfig(true);
    setConfigMessage("");

    try {
      await Promise.all([
        setConfig({
          key: "topic_inference_min_score",
          value: JSON.stringify(minScore),
          description:
            "Minimum weighted lexical score required before a topic is attached to a clustered event.",
        }),
        setConfig({
          key: "topic_inference_confidence_ratio",
          value: JSON.stringify(confidenceRatio),
          description:
            "Relative score threshold for keeping additional inferred topics alongside the top-scoring topic.",
        }),
        setConfig({
          key: "topic_inference_max_topics",
          value: JSON.stringify(maxTopics),
          description:
            "Maximum number of inferred topics attached to an event during clustering.",
        }),
      ]);
      setConfigMessage("Topic inference settings saved.");
    } catch (error) {
      console.error("Failed to save topic inference settings:", error);
      setConfigMessage("Could not save settings. Please try again.");
    } finally {
      setIsSavingConfig(false);
    }
  };

  const userName = currentUser?.profile?.name || currentUser?.email || "User";
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
                <p className="text-sm text-muted-foreground">Welcome back</p>
                <h1 className="text-2xl font-bold tracking-tight">
                  {userName.split(" ")[0]}
                </h1>
              </div>
            </div>
            <UserMenu />
          </header>

          {/* Bento Grid - Main Stats */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {/* Streak - Prominent */}
            <div className="rounded-xl border border-border bg-card p-5">
              <div className="flex items-center gap-3">
                <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10">
                  <Flame className="size-5 text-primary" />
                </div>
                <div>
                  <p className="text-2xl font-bold tabular-nums">
                    {readingStreak}
                  </p>
                  <p className="text-xs text-muted-foreground">day streak</p>
                </div>
              </div>
              {nextStreakMilestone && readingStreak > 0 && (
                <p className="mt-3 text-xs text-muted-foreground">
                  {nextStreakMilestone - readingStreak} days to{" "}
                  {nextStreakMilestone}
                </p>
              )}
            </div>

            {/* Articles Read */}
            <div className="rounded-xl border border-border bg-card p-5">
              <div className="flex items-center gap-3">
                <div className="flex size-10 items-center justify-center rounded-lg bg-muted">
                  <Newspaper className="size-5 text-muted-foreground" />
                </div>
                <div>
                  <p className="text-2xl font-bold tabular-nums">
                    {articlesRead}
                  </p>
                  <p className="text-xs text-muted-foreground">articles read</p>
                </div>
              </div>
            </div>

            {/* Events Explored */}
            <div className="rounded-xl border border-border bg-card p-5">
              <div className="flex items-center gap-3">
                <div className="flex size-10 items-center justify-center rounded-lg bg-muted">
                  <Sparkles className="size-5 text-muted-foreground" />
                </div>
                <div>
                  <p className="text-2xl font-bold tabular-nums">
                    {eventsExplored}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    events explored
                  </p>
                </div>
              </div>
            </div>

            {/* Bookmarks */}
            <div className="rounded-xl border border-border bg-card p-5">
              <div className="flex items-center gap-3">
                <div className="flex size-10 items-center justify-center rounded-lg bg-muted">
                  <Bookmark className="size-5 text-muted-foreground" />
                </div>
                <div>
                  <p className="text-2xl font-bold tabular-nums">
                    {bookmarkCount}
                  </p>
                  <p className="text-xs text-muted-foreground">bookmarked</p>
                </div>
              </div>
            </div>
          </div>

          {/* Activity + Bias Row */}
          <div className="grid gap-4 lg:grid-cols-[1.3fr_0.7fr]">
            {/* Activity Calendar */}
            <div className="rounded-xl border border-border bg-card p-6">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <h2 className="font-semibold">Activity</h2>
                  <p className="text-sm text-muted-foreground">
                    Last 12 weeks of reading
                  </p>
                </div>
                <div className="flex gap-6 text-center">
                  <div>
                    <p className="text-lg font-bold tabular-nums">
                      {readingStreak}
                    </p>
                    <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                      Current
                    </p>
                  </div>
                  <div>
                    <p className="text-lg font-bold tabular-nums">
                      {longestStreak}
                    </p>
                    <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                      Best
                    </p>
                  </div>
                  <div>
                    <p className="text-lg font-bold tabular-nums">
                      {activeDays}
                    </p>
                    <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                      Active
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
              <h2 className="font-semibold">Bias Balance</h2>
              <p className="text-sm text-muted-foreground">
                Your reading perspective mix
              </p>
              <div className="mt-5">
                <BiasBalanceMeter value={biasBalance} />
              </div>
              {weeklyBiasReads > 0 && (
                <p className="mt-4 text-xs text-muted-foreground">
                  {getBiasSnapshotLabel(weeklyBiasBalance)} across{" "}
                  {weeklyBiasReads} reads
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
                  <h2 className="font-semibold">Recent Reading</h2>
                  <p className="text-sm text-muted-foreground">
                    Events you spent time with
                  </p>
                </div>
                <Button asChild variant="ghost" size="sm">
                  <Link to="/feed" className="gap-1">
                    Feed
                    <ChevronRight className="size-4" />
                  </Link>
                </Button>
              </div>
              <div className="p-5">
                {recentHistory.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-border bg-muted/30 px-4 py-8 text-center text-sm text-muted-foreground">
                    Your reading history will appear here
                  </div>
                ) : (
                  <div className="space-y-3">
                    {recentHistory.slice(0, 4).map((entry) => {
                      const durationLabel = formatReadDuration(
                        entry.metadata.timeSpentSeconds,
                      );
                      const scrollLabel = formatScrollDepth(
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
                                {formatRelativeTimestamp(entry.lastViewedAt)}
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
                  <h2 className="font-semibold">Salvate</h2>
                  <p className="text-sm text-muted-foreground">
                    Păstrate pentru mai târziu
                  </p>
                </div>
                <Button asChild variant="ghost" size="sm">
                  <Link to="/salvate" className="gap-1">
                    Toate
                    <ChevronRight className="size-4" />
                  </Link>
                </Button>
              </div>
              <div className="p-5">
                {recentBookmarks.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-border bg-muted/30 px-4 py-8 text-center text-sm text-muted-foreground">
                    Salvează evenimente din feed ca să apară aici
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
                              {formatRelativeTimestamp(entry.bookmarkedAt)}
                            </span>
                            <span>·</span>
                            <span>
                              {(entry.event.sourceCount ?? 0)} source
                              {(entry.event.sourceCount ?? 0) === 1 ? "" : "s"}
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
                <h3 className="font-semibold">Explorează feed-ul</h3>
                <p className="text-sm text-muted-foreground">
                  Vezi subiectele de astăzi
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
                <h3 className="font-semibold">Salvate</h3>
                <p className="text-sm text-muted-foreground">
                  {bookmarkCount}{" "}
                  {bookmarkCount === 1 ? "articol salvat" : "articole salvate"}
                </p>
              </div>
            </Link>
          </div>

          {/* Admin: Topic Diagnostics */}
          {isAdmin && topicDiagnostics && topicDiagnostics.length > 0 && (
            <section className="space-y-4 rounded-xl border border-border bg-card p-6">
              <div>
                <h2 className="text-lg font-semibold">
                  Topic Inference Diagnostics
                </h2>
                <p className="text-sm text-muted-foreground">
                  Review recent event topic assignments
                </p>
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                <MetricCard
                  label="Min score"
                  value={String(topicDiagnostics[0]?.settings.minScore ?? "-")}
                />
                <MetricCard
                  label="Confidence ratio"
                  value={String(
                    topicDiagnostics[0]?.settings.confidenceRatio ?? "-",
                  )}
                />
                <MetricCard
                  label="Max topics"
                  value={String(topicDiagnostics[0]?.settings.maxTopics ?? "-")}
                />
              </div>

              {currentSettings && (
                <form onSubmit={handleSaveConfig} className="space-y-4 pt-2">
                  <div className="grid gap-3 sm:grid-cols-3">
                    <div className="space-y-1.5">
                      <label
                        htmlFor="topic-inference-min-score"
                        className="text-xs font-medium text-muted-foreground"
                      >
                        Min score
                      </label>
                      <Input
                        id="topic-inference-min-score"
                        inputMode="decimal"
                        value={minScoreInput}
                        onChange={(e) => setMinScoreInput(e.target.value)}
                        disabled={isSavingConfig}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label
                        htmlFor="topic-inference-confidence-ratio"
                        className="text-xs font-medium text-muted-foreground"
                      >
                        Confidence ratio
                      </label>
                      <Input
                        id="topic-inference-confidence-ratio"
                        inputMode="decimal"
                        value={confidenceRatioInput}
                        onChange={(e) =>
                          setConfidenceRatioInput(e.target.value)
                        }
                        disabled={isSavingConfig}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label
                        htmlFor="topic-inference-max-topics"
                        className="text-xs font-medium text-muted-foreground"
                      >
                        Max topics
                      </label>
                      <Input
                        id="topic-inference-max-topics"
                        inputMode="numeric"
                        value={maxTopicsInput}
                        onChange={(e) => setMaxTopicsInput(e.target.value)}
                        disabled={isSavingConfig}
                      />
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-3">
                    <Button
                      type="submit"
                      size="sm"
                      disabled={isSavingConfig || !hasConfigChanges}
                    >
                      {isSavingConfig ? "Saving..." : "Save settings"}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={handleResetConfig}
                      disabled={isSavingConfig || !hasConfigChanges}
                    >
                      Reset
                    </Button>
                    {configMessage && (
                      <p className="text-sm text-muted-foreground">
                        {configMessage}
                      </p>
                    )}
                  </div>
                </form>
              )}

              <div className="space-y-3 pt-2">
                {topicDiagnostics.map((event) => (
                  <article
                    key={event.eventId}
                    className="rounded-lg border border-border bg-background p-4"
                  >
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <h3 className="font-medium">{event.eventTitle}</h3>
                        <p className="text-sm text-muted-foreground">
                          {event.articleCount} article
                          {event.articleCount === 1 ? "" : "s"}
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <TopicChipList
                          label="Attached"
                          topics={event.attachedTopics.map(
                            (t) => t.displayName,
                          )}
                        />
                        <TopicChipList
                          label="Inferred"
                          topics={event.inferredTopics.map(
                            (t) => t.displayName,
                          )}
                        />
                      </div>
                    </div>

                    <div className="mt-4 grid gap-4 lg:grid-cols-2">
                      <div className="space-y-3">
                        <div>
                          <p className="text-xs font-medium text-muted-foreground">
                            Inference Input
                          </p>
                          <div className="mt-2 space-y-1 text-sm text-muted-foreground">
                            <p>{event.inferenceInput.title}</p>
                            {event.inferenceInput.summary && (
                              <p>{event.inferenceInput.summary}</p>
                            )}
                          </div>
                        </div>

                        {event.inferenceInput.atomicFacts.length > 0 && (
                          <div>
                            <p className="text-xs font-medium text-muted-foreground">
                              Facts
                            </p>
                            <div className="mt-2 flex flex-wrap gap-1">
                              {event.inferenceInput.atomicFacts.map((fact) => (
                                <span
                                  key={fact}
                                  className="rounded-full bg-muted px-2 py-0.5 text-xs"
                                >
                                  {fact}
                                </span>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>

                      <div>
                        <p className="text-xs font-medium text-muted-foreground">
                          Top Candidates
                        </p>
                        <div className="mt-2 space-y-2">
                          {event.topCandidates.map((candidate) => (
                            <div
                              key={candidate.slug}
                              className="flex items-center justify-between gap-3 rounded-lg border border-border p-2"
                            >
                              <div>
                                <p className="text-sm font-medium">
                                  {candidate.displayName}
                                </p>
                                <p className="text-xs text-muted-foreground">
                                  {candidate.signalCount} signals
                                </p>
                              </div>
                              <p className="text-sm font-semibold tabular-nums">
                                {candidate.score}
                              </p>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-background p-3">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 text-lg font-semibold tabular-nums">{value}</p>
    </div>
  );
}

function TopicChipList({ label, topics }: { label: string; topics: string[] }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-xs text-muted-foreground">{label}:</span>
      {topics.length > 0 ? (
        topics.map((topic) => (
          <span
            key={`${label}-${topic}`}
            className="rounded-full bg-muted px-2 py-0.5 text-xs"
          >
            {topic}
          </span>
        ))
      ) : (
        <span className="text-xs text-muted-foreground">None</span>
      )}
    </div>
  );
}
