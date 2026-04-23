import SignInForm from "@/components/sign-in-form";
import SignUpForm from "@/components/sign-up-form";
import UserMenu from "@/components/user-menu";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@news-app/backend/convex/_generated/api";
import { createFileRoute } from "@tanstack/react-router";
import {
  Authenticated,
  AuthLoading,
  Unauthenticated,
  useMutation,
  useQuery,
} from "convex/react";
import type { FormEvent } from "react";
import { useEffect, useState } from "react";

export const Route = createFileRoute("/dashboard")({
  head: () => ({
    meta: [
      { title: "Dashboard — Biviant" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: RouteComponent,
});

function RouteComponent() {
  const [showSignIn, setShowSignIn] = useState(false);

  return (
    <>
      <Authenticated>
        <AuthenticatedDashboard />
      </Authenticated>
      <Unauthenticated>
        {showSignIn ? (
          <SignInForm onSwitchToSignUp={() => setShowSignIn(false)} />
        ) : (
          <SignUpForm onSwitchToSignIn={() => setShowSignIn(true)} />
        )}
      </Unauthenticated>
      <AuthLoading>
        <div className="flex items-center justify-center h-full">
          <div className="animate-pulse text-muted-foreground">Loading...</div>
        </div>
      </AuthLoading>
    </>
  );
}

function AuthenticatedDashboard() {
  const currentUser = useQuery(api.user.getCurrentUser);
  const privateData = useQuery(api.privateData.get);
  const isAdmin = useQuery(api.user.isCurrentUserAdmin);
  const topicDiagnostics = useQuery(
    api.clustering.getRecentTopicInferenceDiagnosticsForAdmin,
    isAdmin ? { limit: 10 } : "skip",
  );
  const setConfig = useMutation(api.config.set);
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

  if (currentUser === undefined || isAdmin === undefined) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="animate-pulse text-muted-foreground">Loading...</div>
      </div>
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
    if (
      !Number.isInteger(maxTopics) ||
      maxTopics < 1 ||
      maxTopics > 5
    ) {
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

  return (
    <div className="mx-auto max-w-6xl p-6">
      <h1 className="mb-4 text-2xl font-bold">Dashboard</h1>
      {currentUser && (
        <p className="mb-4 text-muted-foreground">
          Welcome, {currentUser.profile?.name || currentUser.email}!
        </p>
      )}
      <p className="text-sm text-muted-foreground">
        privateData: {privateData?.message}
      </p>
      <div className="mt-6">
        <UserMenu />
      </div>

      {isAdmin && (
        <section className="mt-10 space-y-6">
          <div className="space-y-2">
            <h2 className="text-xl font-semibold">Topic Inference Diagnostics</h2>
            <p className="text-sm text-muted-foreground">
              Review recent event topic assignments and the strongest candidate
              scores behind them.
            </p>
          </div>

          {topicDiagnostics === undefined ? (
            <div className="rounded-xl border border-border/60 bg-card p-4 text-sm text-muted-foreground">
              Loading topic diagnostics...
            </div>
          ) : topicDiagnostics.length === 0 ? (
            <div className="rounded-xl border border-border/60 bg-card p-4 text-sm text-muted-foreground">
              No published events available for diagnostics yet.
            </div>
          ) : (
            <>
              <div className="rounded-xl border border-border/60 bg-card p-4">
                <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                  Current Thresholds
                </h3>
                <div className="mt-3 grid gap-3 sm:grid-cols-3">
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
                  <form onSubmit={handleSaveConfig} className="mt-5 space-y-4">
                    <div className="grid gap-3 md:grid-cols-3">
                      <div className="space-y-2">
                        <label
                          htmlFor="topic-inference-min-score"
                          className="text-xs font-semibold uppercase tracking-wide text-muted-foreground"
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
                      <div className="space-y-2">
                        <label
                          htmlFor="topic-inference-confidence-ratio"
                          className="text-xs font-semibold uppercase tracking-wide text-muted-foreground"
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
                      <div className="space-y-2">
                        <label
                          htmlFor="topic-inference-max-topics"
                          className="text-xs font-semibold uppercase tracking-wide text-muted-foreground"
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
              </div>

              <div className="space-y-4">
                {topicDiagnostics.map((event) => (
                  <article
                    key={event.eventId}
                    className="rounded-2xl border border-border/60 bg-card p-5"
                  >
                    <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                      <div className="space-y-1">
                        <h3 className="text-lg font-semibold">{event.eventTitle}</h3>
                        <p className="text-sm text-muted-foreground">
                          {event.articleCount} article
                          {event.articleCount === 1 ? "" : "s"} in cluster
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <TopicChipList
                          label="Attached"
                          topics={event.attachedTopics.map((topic) => topic.displayName)}
                        />
                        <TopicChipList
                          label="Inferred"
                          topics={event.inferredTopics.map((topic) => topic.displayName)}
                        />
                      </div>
                    </div>

                    <div className="mt-4 grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
                      <section className="space-y-3">
                        <div>
                          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                            Inference Input
                          </p>
                          <div className="mt-2 space-y-2 text-sm text-muted-foreground">
                            <p>{event.inferenceInput.title}</p>
                            {event.inferenceInput.summary && (
                              <p>{event.inferenceInput.summary}</p>
                            )}
                            {event.inferenceInput.rssSnippet && (
                              <p>{event.inferenceInput.rssSnippet}</p>
                            )}
                          </div>
                        </div>

                        {event.inferenceInput.atomicFacts.length > 0 && (
                          <div>
                            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                              Facts Used
                            </p>
                            <div className="mt-2 flex flex-wrap gap-2">
                              {event.inferenceInput.atomicFacts.map((fact) => (
                                <span
                                  key={fact}
                                  className="rounded-full bg-muted px-3 py-1 text-xs text-muted-foreground"
                                >
                                  {fact}
                                </span>
                              ))}
                            </div>
                          </div>
                        )}

                        <div>
                          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                            Recent Articles
                          </p>
                          <div className="mt-2 space-y-2">
                            {event.articles.map((article) => (
                              <div
                                key={article._id}
                                className="rounded-xl border border-border/50 p-3"
                              >
                                <p className="text-sm font-medium">{article.title}</p>
                                {(article.summary || article.rssSnippet) && (
                                  <p className="mt-1 text-sm text-muted-foreground">
                                    {article.summary ?? article.rssSnippet}
                                  </p>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      </section>

                      <section>
                        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                          Top Candidate Scores
                        </p>
                        <div className="mt-2 space-y-2">
                          {event.topCandidates.map((candidate) => (
                            <div
                              key={candidate.slug}
                              className="rounded-xl border border-border/50 p-3"
                            >
                              <div className="flex items-center justify-between gap-3">
                                <div>
                                  <p className="text-sm font-medium">
                                    {candidate.displayName}
                                  </p>
                                  <p className="text-xs text-muted-foreground">
                                    {candidate.signalCount} signal
                                    {candidate.signalCount === 1 ? "" : "s"}
                                  </p>
                                </div>
                                <div className="text-right">
                                  <p className="text-sm font-semibold">
                                    {candidate.score}
                                  </p>
                                  <p className="text-xs text-muted-foreground">
                                    weighted score
                                  </p>
                                </div>
                              </div>
                              <div className="mt-3 flex flex-wrap gap-2">
                                <BreakdownChip
                                  label="Title phrases"
                                  value={candidate.breakdown.titlePhraseHits}
                                />
                                <BreakdownChip
                                  label="Summary phrases"
                                  value={candidate.breakdown.summaryPhraseHits}
                                />
                                <BreakdownChip
                                  label="Snippet phrases"
                                  value={candidate.breakdown.snippetPhraseHits}
                                />
                                <BreakdownChip
                                  label="Fact phrases"
                                  value={candidate.breakdown.factPhraseHits}
                                />
                                <BreakdownChip
                                  label="Title keywords"
                                  value={candidate.breakdown.titleKeywordHits}
                                />
                                <BreakdownChip
                                  label="Summary keywords"
                                  value={candidate.breakdown.summaryKeywordHits}
                                />
                                <BreakdownChip
                                  label="Snippet keywords"
                                  value={candidate.breakdown.snippetKeywordHits}
                                />
                                <BreakdownChip
                                  label="Fact keywords"
                                  value={candidate.breakdown.factKeywordHits}
                                />
                              </div>
                            </div>
                          ))}
                        </div>
                      </section>
                    </div>
                  </article>
                ))}
              </div>
            </>
          )}
        </section>
      )}
    </div>
  );
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border/50 bg-background/60 p-3">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 text-lg font-semibold">{value}</p>
    </div>
  );
}

function TopicChipList({
  label,
  topics,
}: {
  label: string;
  topics: string[];
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      {topics.length > 0 ? (
        topics.map((topic) => (
          <span
            key={`${label}-${topic}`}
            className="rounded-full bg-muted px-3 py-1 text-xs"
          >
            {topic}
          </span>
        ))
      ) : (
        <span className="rounded-full bg-muted px-3 py-1 text-xs text-muted-foreground">
          None
        </span>
      )}
    </div>
  );
}

function BreakdownChip({
  label,
  value,
}: {
  label: string;
  value: number;
}) {
  return (
    <span className="rounded-full bg-muted px-3 py-1 text-xs text-muted-foreground">
      {label}: {value}
    </span>
  );
}
