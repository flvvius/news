import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// ===========================================================================
// COST MODE — batched pipeline windows
// ===========================================================================
// Convex bills action compute by WALL-CLOCK time (including time spent waiting
// on the network), and database I/O by bytes read. Running the pipeline
// continuously was costing ~$41/mo against a <$10/mo budget, so the chain now
// runs in 4 batch windows per day instead of on independent short intervals.
//
// The stages are phase-staggered inside each window (:00 ingest → :15 enrich →
// :30 cluster → :45 summarize) so a story still flows end-to-end within ~45
// minutes of being ingested. `crons.interval` is epoch-phase-aligned, which
// would have fired every stage simultaneously and added a full window of
// latency per stage, so these use explicit cron expressions instead.
//
// Freshness cost: worst-case ~6h from publication to appearing in the feed.
// This is a deliberate, authorised trade to keep the app online.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// RSS Ingestion — 4x daily (00:00, 06:00, 12:00, 18:00 UTC)
// ---------------------------------------------------------------------------
// Fetches all curated RSS feeds, deduplicates articles, and inserts new ones.
crons.cron(
  "ingest-rss-feeds",
  "0 0,6,12,18 * * *",
  internal.ingestion.ingestAllFeeds,
);

// Source ratings come from the manual Romanian reputation seed
// (sourceReputation.ts, BIV-401) — the single source-metadata path. The old
// MBFC RapidAPI integration was removed in BIV-402; see
// docs/bias-axis-spec.md and the backlog note in sourceReputation.ts if an
// automated refresh is ever wanted again.

// ---------------------------------------------------------------------------
// Article Enrichment (Embeddings) — 4x daily (:15 past each window)
// ---------------------------------------------------------------------------
// Generates embeddings for unprocessed articles. Runs 15 minutes after each
// ingest window so the freshly inserted articles are picked up in the same pass.
// The action self-chains until the article backlog is drained, so this trigger
// only needs to start each window (chainDepth defaults to 0).
crons.cron(
  "enrich-articles",
  "15 0,6,12,18 * * *",
  internal.enrichmentNode.enrichUnprocessedArticles,
  {},
);

// ---------------------------------------------------------------------------
// Article Clustering — 4x daily (:30 past each window)
// ---------------------------------------------------------------------------
// Clusters enriched articles into published events so the feed can render
// real ingested data even before AI summarization exists.
// Self-chains until the enriched backlog is drained, then hands off to merge,
// recluster and summarization once (not once per batch).
crons.cron(
  "cluster-enriched-articles",
  "30 0,6,12,18 * * *",
  internal.clustering.clusterEnrichedArticles,
  {},
);

// ---------------------------------------------------------------------------
// Event Merge Pass — 2x daily
// ---------------------------------------------------------------------------
// Collapses near-duplicate recently published events created across separate
// clustering runs. This was the single largest vector-search consumer after
// clustering itself (527 query-GB), and at a 20-minute cadence it mostly
// re-scanned events it had already compared. Twice daily, offset from the
// clustering windows, still catches duplicates created across separate runs.
crons.cron(
  "merge-near-duplicate-events",
  "45 1,13 * * *",
  internal.clustering.mergeNearDuplicateEvents,
);

// ---------------------------------------------------------------------------
// Singleton Recluster Pass — Daily (03:45 UTC)
// ---------------------------------------------------------------------------
// Re-examines recent singleton / tiny events after more articles have landed,
// improving recall for stories that were under-clustered during the online pass.
// This cadence is paired with a DB-backed lease, no-candidate short-circuit,
// seed caps, and reduced vector top-K so fallback recovery stays bounded.
crons.cron(
  "recluster-recent-singletons",
  "45 3 * * *",
  internal.clustering.reclusterRecentSingletonEvents,
);

// ---------------------------------------------------------------------------
// Stale Singleton Archive — Daily (02:20 UTC)
// ---------------------------------------------------------------------------
// Archives stale processing singletons so they stop inflating the vector index.
// The job yields (skips) whenever a clustering job holds a pipeline lock to
// avoid concurrent mutation of hot event/embedding rows.
//
// This previously ran every 53 minutes: interval crons are epoch-phase-aligned,
// so an hourly cadence was an exact multiple of the old 20/30/40-minute
// clustering cadences and fired in lockstep with them every time, guaranteeing
// a blocking lock and a 100% skip rate. 53 is coprime with 20/30/40/60, so the
// job drifted across phases and regularly landed in quiet windows.
//
// That reasoning is obsolete now that every clustering stage runs at explicit
// fixed times. 02:20 UTC simply sits in a gap between the 00:xx pipeline window
// and the 03:45 recluster pass, so the lock is free without needing to drift.
crons.cron(
  "archive-stale-singleton-events",
  "20 2 * * *",
  internal.singletonCleanup.archiveStaleSingletonEvents,
  {},
);

// ---------------------------------------------------------------------------
// Event Summarization — 4x daily (:45 past each window)
// ---------------------------------------------------------------------------
// Generates perspective summaries for published events that have enough source
// diversity. Runs 45 minutes into each window so clustering has already created
// the events this pass will summarize.
//
// This action's downstream job (processSummaryJob) was 92% of all Convex action
// compute. Cadence alone was not the problem — the per-job wall clock was — but
// a lower cadence also keeps us inside Gemini's free-tier rate limit, which is
// what was generating the 429 storm that wasted most of that compute.
//
// This supersedes the hourly cadence from #60, which deliberately preserved
// throughput ("the win comes from the per-job body-fetch fix, not from starving
// throughput"). That was not enough on its own — the deployment still exceeded
// the free plan — so throughput is now cut too.
crons.cron(
  "summarize-published-events",
  "45 0,6,12,18 * * *",
  internal.summarizationNode.summarizeQueuedEvents,
  {},
);

// ---------------------------------------------------------------------------
// Summary Queue Health — Daily (05:30 UTC)
// ---------------------------------------------------------------------------
// Warns in logs when queued jobs duplicate the same event or queue depth
// grows enough to threaten coverage.
crons.cron(
  "summary-queue-health",
  "30 5 * * *",
  internal.summarizationNode.alertOnSummaryQueueHealth,
  {},
);

// ---------------------------------------------------------------------------
// Claim Divergence Detection — DISABLED (cost mode)
// ---------------------------------------------------------------------------
// Builds the eventClaims graph from atomic facts so the product can show
// agreements, conflicts, framing differences, and lean-specific exclusives.
//
// Claim analysis is already switched off in prod at the config layer
// (article_fact_extraction_enabled = false), so this cron was waking every 45
// minutes only to read config, find nothing to do, and exit — pure billed
// compute and database I/O for zero product value. The cron is disabled to stop
// paying for that. Re-enable it together with the config flag, not before.
// crons.interval(
//   "detect-event-claims",
//   { minutes: 45 },
//   internal.claimDivergenceNode.processStaleEventClaims,
//   {},
// );

// ---------------------------------------------------------------------------
// Daily News Quiz — DISABLED (cost mode)
// ---------------------------------------------------------------------------
// Generates one globally shared UTC-dated quiz from grounded claim/fact data.
//
// The quiz is already switched off in prod, and it is derived from claim/fact
// data that the disabled claim pipeline no longer produces — so this was a
// daily model-backed action producing nothing usable. Re-enable alongside
// claim analysis and the quiz feature flag.
// crons.daily(
//   "generate-daily-news-quiz",
//   { hourUTC: 6, minuteUTC: 0 },
//   internal.quizNode.generateDailyQuiz,
//   {},
// );

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
// AI Budget Reservation Cleanup — 2x daily
// ---------------------------------------------------------------------------
// Deletes expired budget reservations outside the OpenAI-call hot path.
crons.cron(
  "cleanup-ai-budget-reservations",
  "5 1,13 * * *",
  internal.aiBudget.cleanupExpiredAiBudgetReservations,
  {},
);

// ---------------------------------------------------------------------------
// Vector Search Reservation Cleanup — 2x daily
// ---------------------------------------------------------------------------
// Releases expired vector-search reservations outside the reservation hot path
// so every semantic lookup no longer scans stale reservations first.
crons.cron(
  "cleanup-vector-search-reservations",
  "10 1,13 * * *",
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
// Pipeline Alert Checks — 2x daily
// ---------------------------------------------------------------------------
// Writes pipelineAlerts rows for persistent fallback mode, publish droughts,
// stuck processing growth, vector-budget burn rate, job error rates, and absent
// archive runs. Alerts stay in Convex and are surfaced in /admin/pipeline.
//
// At a 20-minute cadence this was the 3rd largest database-I/O consumer in the
// app (1.68 GB, via pipeline.countProcessingEventsOlderThan) — admin-only
// telemetry costing real money 72 times a day. With the pipeline now running in
// 4 daily windows there is nothing to observe between windows anyway, so this
// runs twice daily, shortly after the 00:xx and 12:xx windows complete.
crons.cron(
  "check-pipeline-alerts",
  "50 1,13 * * *",
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
// Storage Retention (cost mode) — see STORAGE_RETENTION_DEFAULTS in retention.ts
// ---------------------------------------------------------------------------
// These are operational/storage-cost purges, distinct from the legal data
// minimization jobs above. Database storage was growing without bound (~1,300
// articles/day, each with a 512-dimension embedding), which meant the bill
// compounded every month regardless of any other saving. These cap it.
//
// All three self-chain via the scheduler until their backlog is drained, so a
// daily trigger is enough. NOTE: the FIRST drain reads every row it deletes, so
// expect a one-off spike in database I/O the first day this ships.

// Deletes vectors for articles past article_embedding_retention_days (45).
// Article rows are kept; only the embeddings go. Clustering's widest lookback
// is 48h, so a 45-day floor is ~22x more history than anything actually reads.
crons.daily(
  "retention-purge-stale-article-embeddings",
  { hourUTC: 4, minuteUTC: 5 },
  internal.retention.purgeStaleArticleEmbeddings,
  {},
);

// Deletes articles archived as stale singletons past
// archived_article_retention_days (90). These belong to no event.
crons.daily(
  "retention-purge-archived-articles",
  { hourUTC: 4, minuteUTC: 15 },
  internal.retention.purgeArchivedDetachedArticles,
  {},
);

// Full-table orphan sweep. WEEKLY ONLY (Sundays): unlike the jobs above this
// cannot use a head-of-index scan — an orphan can have any creation time — so
// it reads every embedding row, which is billed database I/O. The daily stale
// purge already collects every orphan older than 45 days for free, so this
// exists only to catch recent orphans from interrupted writes.
crons.cron(
  "retention-purge-orphaned-article-embeddings",
  "35 4 * * 0",
  internal.retention.purgeOrphanedArticleEmbeddings,
  {},
);

// ---------------------------------------------------------------------------
// Pipeline Runtime Config Snapshot — 5 min before each pipeline window
// ---------------------------------------------------------------------------
// Collapses the per-key clustering config reads into one compact document that
// pipeline jobs read on every run. Without this the snapshot is never built and
// jobs silently fall back to N per-key reads.
crons.cron(
  "refresh-pipeline-runtime-config",
  "55 23,5,11,17 * * *",
  internal.config.refreshPipelineRuntimeConfig,
  {},
);

// ---------------------------------------------------------------------------
// Anonymous Trending Feed Snapshot — 4x daily, after each pipeline window
// ---------------------------------------------------------------------------
// Precomputes the trending first page so anonymous/cold loads skip the live
// ranked scan. Rebuilt on a cron (not on every preview write) to avoid write
// amplification and contention on the single snapshot document.
//
// Rebuilt 45 minutes after each summarization pass so the snapshot reflects
// that window's freshly summarized events. There is no new content to surface
// between windows, so a tighter cadence would rewrite an identical document.
crons.cron(
  "rebuild-public-feed-snapshots",
  "30 1,7,13,19 * * *",
  internal.events.rebuildPublicFeedSnapshotsJob,
  {},
);

// ---------------------------------------------------------------------------
// Hot Vector Table Prune — Daily (02:40 UTC)
// ---------------------------------------------------------------------------
// Deletes eventEmbeddingHot rows for events that have gone quiet so the hot
// clustering index stays small. Active events are re-added by the write path.
crons.cron(
  "prune-hot-event-embeddings",
  "40 2 * * *",
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
