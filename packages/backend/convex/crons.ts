import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// ---------------------------------------------------------------------------
// RSS Ingestion — Every 60 minutes
// ---------------------------------------------------------------------------
// Fetches all curated RSS feeds, deduplicates articles, and inserts new ones.
// Frequency can be tuned down to 30min once the pipeline is proven stable.
crons.interval(
  "ingest-rss-feeds",
  { minutes: 60 },
  internal.ingestion.ingestAllFeeds,
);

// ---------------------------------------------------------------------------
// MBFC Enrichment — DISABLED for MVP
// ---------------------------------------------------------------------------
// MBFC ratings are seeded manually from feeds.ts (curated from
// mediabiasfactcheck.com). Re-enable via the API when the source list
// grows past what can be maintained by hand.
// crons.interval(
//   "enrich-sources-mbfc",
//   { hours: 24 },
//   internal.mbfc.enrichAllSources,
// );

// ---------------------------------------------------------------------------
// Article Enrichment (Embeddings) — Every 30 minutes
// ---------------------------------------------------------------------------
// Generates embeddings for unprocessed articles.
// Runs more frequently than ingestion to keep the pipeline flowing.
crons.interval(
  "enrich-articles",
  { minutes: 30 },
  internal.enrichmentNode.enrichUnprocessedArticles,
);

// ---------------------------------------------------------------------------
// Article Clustering — Every 30 minutes
// ---------------------------------------------------------------------------
// Clusters enriched articles into published events so the feed can render
// real ingested data even before AI summarization exists.
crons.interval(
  "cluster-enriched-articles",
  { minutes: 30 },
  internal.clustering.clusterEnrichedArticles,
);

// ---------------------------------------------------------------------------
// Event Merge Pass — Every 10 minutes
// ---------------------------------------------------------------------------
// Collapses near-duplicate recently published events created across separate
// clustering runs. The action uses a DB-backed lease plus seed/top-K caps, so
// the tighter cadence should skip overlapping work instead of piling up load.
crons.interval(
  "merge-near-duplicate-events",
  { minutes: 10 },
  internal.clustering.mergeNearDuplicateEvents,
);

// ---------------------------------------------------------------------------
// Singleton Recluster Pass — Every 15 minutes
// ---------------------------------------------------------------------------
// Re-examines recent singleton / tiny events after more articles have landed,
// improving recall for stories that were under-clustered during the online pass.
// This cadence is paired with a DB-backed lease, no-candidate short-circuit,
// seed caps, and reduced vector top-K so fallback recovery stays bounded.
crons.interval(
  "recluster-recent-singletons",
  { minutes: 15 },
  internal.clustering.reclusterRecentSingletonEvents,
);

// ---------------------------------------------------------------------------
// Stale Singleton Archive — Hourly
// ---------------------------------------------------------------------------
// Archives stale processing singletons so they stop inflating the vector index.
crons.interval(
  "archive-stale-singleton-events",
  { hours: 1 },
  internal.singletonCleanup.archiveStaleSingletonEvents,
  {},
);

// ---------------------------------------------------------------------------
// Event Summarization — Every 30 minutes
// ---------------------------------------------------------------------------
// Generates GPT-backed perspective summaries for published events that have
// enough source diversity. Runs independently so clustering is never blocked on
// model latency or budget state.
crons.interval(
  "summarize-published-events",
  { minutes: 30 },
  internal.summarizationNode.summarizeQueuedEvents,
  {},
);

// ---------------------------------------------------------------------------
// Summary Queue Health — Hourly
// ---------------------------------------------------------------------------
// Warns in logs when queued jobs duplicate the same event or queue depth
// grows enough to threaten coverage.
crons.interval(
  "summary-queue-health",
  { hours: 1 },
  internal.summarizationNode.alertOnSummaryQueueHealth,
  {},
);

// ---------------------------------------------------------------------------
// Claim Divergence Detection — Every 30 minutes
// ---------------------------------------------------------------------------
// Builds the eventClaims graph from atomic facts so the product can show
// agreements, conflicts, framing differences, and lean-specific exclusives.
crons.interval(
  "detect-event-claims",
  { minutes: 30 },
  internal.claimDivergenceNode.processStaleEventClaims,
  {},
);

// ---------------------------------------------------------------------------
// Daily News Quiz — Daily
// ---------------------------------------------------------------------------
// Generates one globally shared UTC-dated quiz from grounded claim/fact data.
crons.daily(
  "generate-daily-news-quiz",
  { hourUTC: 6, minuteUTC: 0 },
  internal.quizNode.generateDailyQuiz,
  {},
);

// ---------------------------------------------------------------------------
// Article Bias Outlier Detection — Daily
// ---------------------------------------------------------------------------
// Computes rolling per-source article bias stats and flags articles that are
// unusually partisan for their outlet.
crons.daily(
  "flag-bias-outliers",
  { hourUTC: 5, minuteUTC: 0 },
  internal.bias.flagBiasOutliers,
  {},
);

// ---------------------------------------------------------------------------
// AI Budget Reservation Cleanup — Hourly
// ---------------------------------------------------------------------------
// Deletes expired budget reservations outside the OpenAI-call hot path.
crons.interval(
  "cleanup-ai-budget-reservations",
  { hours: 1 },
  internal.aiBudget.cleanupExpiredAiBudgetReservations,
  {},
);

// ---------------------------------------------------------------------------
// Vector Search Run Retention — Daily
// ---------------------------------------------------------------------------
// Keeps detailed vector-search telemetry bounded; daily totals remain intact.
crons.daily(
  "cleanup-vector-search-runs",
  { hourUTC: 4, minuteUTC: 45 },
  internal.vectorSearchBudget.cleanupVectorSearchRuns,
  {},
);

// ---------------------------------------------------------------------------
// Pipeline Alert Checks — Every 15 minutes
// ---------------------------------------------------------------------------
// Writes pipelineAlerts rows for persistent fallback mode, publish droughts,
// stuck processing growth, vector-budget burn rate, job error rates, and absent
// archive runs. Alerts stay in Convex and are surfaced in /admin/pipeline.
crons.interval(
  "check-pipeline-alerts",
  { minutes: 15 },
  internal.pipeline.checkPipelineAlerts,
  {},
);

// ---------------------------------------------------------------------------
// Pipeline Run Log Retention — Daily
// ---------------------------------------------------------------------------
// Deletes pipelineRunLogs older than pipeline_run_log_retention_days
// (default 14). Aggregate daily vector-search totals are stored elsewhere; this
// job only trims detailed per-run rows. Runs at 04:55 UTC near other maintenance
// jobs, so watch Convex load if retention batches grow.
crons.daily(
  "cleanup-pipeline-run-logs",
  { hourUTC: 4, minuteUTC: 55 },
  internal.pipeline.cleanupPipelineRunLogs,
  {},
);

// ---------------------------------------------------------------------------
// Unverified Auth Account Cleanup — Daily
// ---------------------------------------------------------------------------
// Deletes auth/app user rows for email/password accounts that never verified
// within 7 days, keeping the user tables from filling with junk.
crons.daily(
  "cleanup-expired-unverified-accounts",
  { hourUTC: 4, minuteUTC: 30 },
  internal.authMaintenance.cleanupExpiredUnverifiedAccounts,
  {},
);

export default crons;
