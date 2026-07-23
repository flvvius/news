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

// Source ratings come from the manual Romanian reputation seed
// (sourceReputation.ts, BIV-401) — the single source-metadata path. The old
// MBFC RapidAPI integration was removed in BIV-402; see
// docs/bias-axis-spec.md and the backlog note in sourceReputation.ts if an
// automated refresh is ever wanted again.

// ---------------------------------------------------------------------------
// Article Enrichment (Embeddings) — Every 30 minutes
// ---------------------------------------------------------------------------
// Generates embeddings for unprocessed articles.
// Runs more frequently than ingestion to keep the pipeline flowing and to work
// down the unprocessed-article backlog faster.
crons.interval(
  "enrich-articles",
  { minutes: 30 },
  internal.enrichmentNode.enrichUnprocessedArticles,
);

// ---------------------------------------------------------------------------
// Article Clustering — Every 40 minutes
// ---------------------------------------------------------------------------
// Clusters enriched articles into published events so the feed can render
// real ingested data even before AI summarization exists.
crons.interval(
  "cluster-enriched-articles",
  { minutes: 40 },
  internal.clustering.clusterEnrichedArticles,
);

// ---------------------------------------------------------------------------
// Event Merge Pass — Every 20 minutes
// ---------------------------------------------------------------------------
// Collapses near-duplicate recently published events created across separate
// clustering runs. The action uses a DB-backed lease plus seed/top-K caps, so
// the tighter cadence should skip overlapping work instead of piling up load.
crons.interval(
  "merge-near-duplicate-events",
  { minutes: 20 },
  internal.clustering.mergeNearDuplicateEvents,
);

// ---------------------------------------------------------------------------
// Singleton Recluster Pass — Every 30 minutes
// ---------------------------------------------------------------------------
// Re-examines recent singleton / tiny events after more articles have landed,
// improving recall for stories that were under-clustered during the online pass.
// This cadence is paired with a DB-backed lease, no-candidate short-circuit,
// seed caps, and reduced vector top-K so fallback recovery stays bounded.
crons.interval(
  "recluster-recent-singletons",
  { minutes: 30 },
  internal.clustering.reclusterRecentSingletonEvents,
);

// ---------------------------------------------------------------------------
// Stale Singleton Archive — Every 53 minutes (drifting)
// ---------------------------------------------------------------------------
// Archives stale processing singletons so they stop inflating the vector index.
// The job yields (skips) whenever a clustering job holds a pipeline lock to
// avoid concurrent mutation of hot event/embedding rows. Convex interval crons
// are epoch-phase-aligned, so an *hourly* cadence is an exact multiple of the
// 20-min merge and 30-min recluster cadences and fired in lockstep with them
// every single time — guaranteeing a blocking lock and a 100% skip rate. A
// 53-minute cadence is coprime with 20/30/40/60, so archive drifts across
// phases and regularly lands in quiet windows without ever starving the core
// clustering pipeline (which keeps priority).
crons.interval(
  "archive-stale-singleton-events",
  { minutes: 53 },
  internal.singletonCleanup.archiveStaleSingletonEvents,
  {},
);

// ---------------------------------------------------------------------------
// Event Summarization — Every 3 hours
// ---------------------------------------------------------------------------
// Generates GPT-backed perspective summaries for published events that have
// enough source diversity. Runs independently so clustering is never blocked on
// model latency or budget state. Cadence widened from 45min → 3h to cut the
// number of concurrent Node-action runs: processSummaryJob is the dominant
// action-compute consumer, so fewer, fuller passes keep the deployment under
// the action-compute budget. Queue depth is watched by summary-queue-health.
crons.interval(
  "summarize-published-events",
  { hours: 3 },
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
// Claim Divergence Detection — Every 45 minutes
// ---------------------------------------------------------------------------
// Builds the eventClaims graph from atomic facts so the product can show
// agreements, conflicts, framing differences, and lean-specific exclusives.
crons.interval(
  "detect-event-claims",
  { minutes: 45 },
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
// crons.daily(
//   "flag-bias-outliers",
//   { hourUTC: 5, minuteUTC: 0 },
//   internal.bias.flagBiasOutliers,
//   {},
// );

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
// Vector Search Reservation Cleanup — Hourly
// ---------------------------------------------------------------------------
// Releases expired vector-search reservations outside the reservation hot path
// so every semantic lookup no longer scans stale reservations first.
crons.interval(
  "cleanup-vector-search-reservations",
  { hours: 1 },
  internal.vectorSearchBudget.cleanupExpiredVectorSearchReservations,
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
// Static Sitemap Snapshot — Daily
// ---------------------------------------------------------------------------
// Precomputes sitemap XML so crawler hits do not perform live 5k event/source
// queries through the web route.
crons.daily(
  "rebuild-public-sitemap-snapshot",
  { hourUTC: 3, minuteUTC: 20 },
  internal.sitemap.rebuildPublicSitemapSnapshot,
  {},
);

// ---------------------------------------------------------------------------
// Pipeline Alert Checks — Every 20 minutes
// ---------------------------------------------------------------------------
// Writes pipelineAlerts rows for persistent fallback mode, publish droughts,
// stuck processing growth, vector-budget burn rate, job error rates, and absent
// archive runs. Alerts stay in Convex and are surfaced in /admin/pipeline.
crons.interval(
  "check-pipeline-alerts",
  { minutes: 20 },
  internal.pipeline.checkPipelineAlerts,
  {},
);

// ---------------------------------------------------------------------------
// Pipeline Run Log Retention — Daily
// ---------------------------------------------------------------------------
// Deletes pipelineRunLogs older than pipeline_run_log_retention_days
// (default 14). Aggregate daily vector-search totals are stored elsewhere; this
// job only trims detailed per-run rows. Runs at 05:10 UTC away from other
// maintenance jobs to avoid concentrated load.
crons.daily(
  "cleanup-pipeline-run-logs",
  { hourUTC: 5, minuteUTC: 10 },
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

// ---------------------------------------------------------------------------
// L11 Data Retention — Daily (see retention.RETENTION_POLICY)
// ---------------------------------------------------------------------------
// Automated minimization: unengaged waitlist signups (90d), reading history
// (18mo), expired personalized insights. Each run logs the deleted count per
// data class to pipelineRunLogs. Transient article body text has no purge job
// because it is never persisted in the first place.
crons.daily(
  "retention-purge-stale-waitlist",
  { hourUTC: 4, minuteUTC: 40 },
  internal.retention.purgeStaleWaitlistEntries,
  {},
);

crons.daily(
  "retention-purge-reading-history",
  { hourUTC: 4, minuteUTC: 50 },
  internal.retention.purgeOldReadingHistory,
  {},
);

crons.daily(
  "retention-purge-expired-insights",
  { hourUTC: 5, minuteUTC: 0 },
  internal.retention.purgeExpiredUserInsights,
  {},
);

// ---------------------------------------------------------------------------
// Pipeline Runtime Config Snapshot — Every 5 minutes
// ---------------------------------------------------------------------------
// Collapses the per-key clustering config reads into one compact document that
// pipeline jobs read on every run. Without this the snapshot is never built and
// jobs silently fall back to N per-key reads.
crons.interval(
  "refresh-pipeline-runtime-config",
  { hours: 1 },
  internal.config.refreshPipelineRuntimeConfig,
  {},
);

// ---------------------------------------------------------------------------
// Anonymous Trending Feed Snapshot — Every 2 minutes
// ---------------------------------------------------------------------------
// Precomputes the trending first page so anonymous/cold loads skip the live
// ranked scan. Rebuilt on a cron (not on every preview write) to avoid write
// amplification and contention on the single snapshot document.
crons.interval(
  "rebuild-public-feed-snapshots",
  { minutes: 20 },
  internal.events.rebuildPublicFeedSnapshotsJob,
  {},
);

// ---------------------------------------------------------------------------
// Hot Vector Table Prune — Hourly
// ---------------------------------------------------------------------------
// Deletes eventEmbeddingHot rows for events that have gone quiet so the hot
// clustering index stays small. Active events are re-added by the write path.
crons.interval(
  "prune-hot-event-embeddings",
  { hours: 1 },
  internal.clustering.pruneHotEventEmbeddings,
  {},
);

// ---------------------------------------------------------------------------
// Morning Briefing — Daily (Ticket 19)
// ---------------------------------------------------------------------------
// Pushes one fresh followed-topic story per user. No-ops until BRIEFING_ENABLED
// is set, so it stays dormant until push infra is configured (the cron the
// notification primer in T6 waits on). 07:00 UTC is a basic global send window.
crons.daily(
  "send-morning-briefing",
  { hourUTC: 7, minuteUTC: 0 },
  internal.briefing.sendMorningBriefings,
  {},
);

export default crons;
