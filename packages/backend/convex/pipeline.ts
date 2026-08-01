import { v } from "convex/values";
import {
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import { internal } from "./_generated/api";
import { getConfig } from "./config";
import { requireAdminUser } from "./lib/betaAccess";
import type { ActionCtx, MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Pipeline cadence (cost mode) — the basis for every time-based alert below
// ---------------------------------------------------------------------------
// The pipeline no longer runs continuously. It runs in four batched windows per
// day (ingest 00/06/12/18 UTC, then enrich :15, cluster :30, summarize :45),
// with maintenance jobs demoted to once or twice daily and the alert check
// itself down to 2x daily (01:50 / 13:50 UTC).
//
// Thresholds tuned for the old continuous cadence are all *unsatisfiable* under
// this one — a 1-hour freshness SLO against a 6-hour publish cadence, a 30-min
// enrichment window against a job that runs every 6 hours, a 4-hour
// archive-run window against a job that now runs daily. Left alone they would
// fire on every check, turning /admin/pipeline into permanent red and burning
// writes to `pipelineAlerts`.
//
// So: every threshold below is derived from these periods plus a tolerance.
// Retuning the crons means retuning these constants and nothing else.
const PIPELINE_WINDOW_MS = 6 * HOUR_MS; // ingest → … → summarize batch cadence
const DAILY_JOB_PERIOD_MS = DAY_MS; // archive / recluster / prune cadence
const WINDOWS_PER_DAY = Math.round(DAY_MS / PIPELINE_WINDOW_MS); // 4
// Offset from a window's start to the end of its summarize step (crons.ts runs
// ingest at :00 and summarize at :45). Spend for a window has not landed until
// this much of it has elapsed.
const WINDOW_COMPLETION_OFFSET_MS = 45 * 60 * 1000;
// How much slack a healthy pipeline gets: one fully missed batch window.
const ALERT_TOLERANCE = 2;
// Fallback when `pipeline_alert_check_interval_minutes` cannot be read. Must
// track the check-pipeline-alerts cron.
const DEFAULT_ALERT_CHECK_PERIOD_MS = 12 * HOUR_MS;
// How far a burn rate may run ahead of the day's expected progress before it is
// treated as a projected exhaustion.
const VECTOR_BURN_RATE_MARGIN = 0.25;

// Feed freshness. Content can only become visible once per batch window, so the
// previous 1-hour SLO was unsatisfiable by construction (worst case is ~6h *by
// design*). Allow one fully missed window before calling the feed stale.
const FRESHNESS_SLO_MS = PIPELINE_WINDOW_MS * ALERT_TOLERANCE;

// A job running every `periodMs` is only "absent" once a full period *plus* one
// alert-check period has elapsed without an ok run. Without the second term, a
// check that lands just before the job's next run alerts on a perfectly healthy
// pipeline — e.g. archive runs daily at 02:20 and the check runs at 01:50, so
// the legitimately observed gap is ~23.5h.
function absentRunWindowMs(periodMs: number, alertCheckPeriodMs: number) {
  return periodMs + alertCheckPeriodMs;
}

const ARTICLE_QUEUE_STATUSES = [
  "unprocessed",
  "enriched",
  "processing",
  "archived",
] as const;
// COST: every one of these "counts" is really a scan that materialises full
// documents (Convex has no count aggregate), and the tables being counted are
// the two fattest in the schema (articles, events). These run inside reactive
// admin `query`s, so an open /admin/pipeline tab re-executes them on every
// article write. 2000 still comfortably exceeds a normal day's volume
// (~1300 articles/day), so day-scoped counters stay exact; only whole-table
// queue depths saturate, and those are read as "deep" either way.
const DIAGNOSTIC_COUNT_LIMIT = 2000;

const pipelineMetricValue = v.union(
  v.string(),
  v.number(),
  v.boolean(),
  v.null(),
);
const pipelineGaugeValue = v.union(
  pipelineMetricValue,
  v.array(
    v.object({
      key: v.string(),
      owner: v.string(),
      expiresAt: v.number(),
    }),
  ),
);
const pipelineMetadataValue = v.union(
  pipelineMetricValue,
  v.record(v.string(), v.number()),
);

function dateKey(timestamp: number) {
  return new Date(timestamp).toISOString().slice(0, 10);
}

function bucketAge(ageMs: number) {
  if (ageMs < HOUR_MS) return "<1h";
  if (ageMs < 6 * HOUR_MS) return "1-6h";
  if (ageMs < 24 * HOUR_MS) return "6-24h";
  if (ageMs < 3 * DAY_MS) return "1-3d";
  return ">3d";
}

async function readConfigNumber(
  ctx: QueryCtx | MutationCtx,
  key: string,
  fallback: number,
) {
  const value = await getConfig(ctx, key, fallback);
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

type LimitedQuery<T> = {
  take: (limit: number) => Promise<T[]>;
};

type LimitedQueryFactory<T> = () => LimitedQuery<T>;

type PipelineRollupPayload = {
  readRows?: number;
  writeRows?: number;
  vectorSearches?: number;
  runCount?: number;
  errorCount?: number;
  estimatedPayloadBytes?: number;
};

function parsePipelineRollupPayload(
  payloadJson: string,
  key: string,
): PipelineRollupPayload {
  try {
    return JSON.parse(payloadJson) as PipelineRollupPayload;
  } catch (error) {
    console.error(
      `[pipeline] Failed to parse pipelineAdminRollups payload for ${key}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return {};
  }
}

async function limitedCount<T>(
  queryFactory: LimitedQueryFactory<T>,
  limit = DIAGNOSTIC_COUNT_LIMIT,
): Promise<number> {
  return (await queryFactory().take(limit)).length;
}

async function limitedReduce<T, R>(
  queryFactory: LimitedQueryFactory<T>,
  initial: R,
  reducer: (accumulator: R, row: T) => R,
  limit = DIAGNOSTIC_COUNT_LIMIT,
): Promise<R> {
  let accumulator = initial;
  const rows = await queryFactory().take(limit);
  for (const row of rows) {
    accumulator = reducer(accumulator, row);
  }
  return accumulator;
}

export const insertRunLog = internalMutation({
  args: {
    jobName: v.string(),
    runId: v.string(),
    startedAt: v.number(),
    finishedAt: v.number(),
    durationMs: v.number(),
    status: v.union(
      v.literal("ok"),
      v.literal("skipped"),
      v.literal("degraded"),
      v.literal("error"),
    ),
    errorMessage: v.optional(v.string()),
    counters: v.record(v.string(), v.number()),
    gauges: v.record(v.string(), pipelineGaugeValue),
    metadata: v.record(v.string(), pipelineMetadataValue),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("pipelineRunLogs")
      .withIndex("by_job_started_at", (q) =>
        q.eq("jobName", args.jobName).eq("startedAt", args.startedAt),
      )
      .first();
    if (existing && existing.runId === args.runId) return existing._id;
    const logId = await ctx.db.insert("pipelineRunLogs", {
      ...args,
      createdAt: Date.now(),
    });
    const now = Date.now();
    const hour = Math.floor(now / HOUR_MS) * HOUR_MS;
    const key = `${args.jobName}:${hour}`;
    const rollup = await ctx.db
      .query("pipelineAdminRollups")
      .withIndex("by_key", (q) => q.eq("key", key))
      .unique();
    const previous = rollup
      ? parsePipelineRollupPayload(rollup.payloadJson, key)
      : {};
    const readRows =
      args.counters.scanned ??
      args.counters.processed ??
      args.counters.vectorMatchesHydrated ??
      0;
    const payload = {
      jobName: args.jobName,
      bucketStart: hour,
      readRows: Math.max(0, (previous.readRows ?? 0) + readRows),
      writeRows: Math.max(0, (previous.writeRows ?? 0) + 1),
      vectorSearches: Math.max(
        0,
        (previous.vectorSearches ?? 0) + (args.counters.vectorSearches ?? 0),
      ),
      runCount: Math.max(0, (previous.runCount ?? 0) + 1),
      errorCount: Math.max(
        0,
        (previous.errorCount ?? 0) + (args.status === "error" ? 1 : 0),
      ),
      estimatedPayloadBytes: previous.estimatedPayloadBytes ?? 0,
      lastStatus: args.status,
    };
    if (rollup) {
      await ctx.db.patch(rollup._id, {
        payloadJson: JSON.stringify(payload),
        updatedAt: now,
      });
    } else {
      await ctx.db.insert("pipelineAdminRollups", {
        key,
        payloadJson: JSON.stringify(payload),
        generatedAt: hour,
        updatedAt: now,
      });
    }
    return logId;
  },
});

export const recordPipelineIoRollup = internalMutation({
  args: {
    jobName: v.string(),
    readRows: v.number(),
    writeRows: v.number(),
    vectorSearches: v.number(),
    status: v.union(
      v.literal("ok"),
      v.literal("skipped"),
      v.literal("degraded"),
      v.literal("error"),
    ),
    estimatedPayloadBytes: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const hour = Math.floor(now / HOUR_MS) * HOUR_MS;
    const key = `${args.jobName}:${hour}`;
    const existing = await ctx.db
      .query("pipelineAdminRollups")
      .withIndex("by_key", (q) => q.eq("key", key))
      .unique();
    const previous = existing
      ? parsePipelineRollupPayload(existing.payloadJson, key)
      : {};
    const payload = {
      jobName: args.jobName,
      bucketStart: hour,
      readRows: Math.max(0, (previous.readRows ?? 0) + args.readRows),
      writeRows: Math.max(0, (previous.writeRows ?? 0) + args.writeRows),
      vectorSearches: Math.max(
        0,
        (previous.vectorSearches ?? 0) + args.vectorSearches,
      ),
      runCount: Math.max(0, (previous.runCount ?? 0) + 1),
      errorCount: Math.max(
        0,
        (previous.errorCount ?? 0) + (args.status === "error" ? 1 : 0),
      ),
      estimatedPayloadBytes: Math.max(
        0,
        (previous.estimatedPayloadBytes ?? 0) +
          (args.estimatedPayloadBytes ?? 0),
      ),
      lastStatus: args.status,
    };
    if (existing) {
      await ctx.db.patch(existing._id, {
        payloadJson: JSON.stringify(payload),
        updatedAt: now,
      });
      return existing._id;
    }
    return await ctx.db.insert("pipelineAdminRollups", {
      key,
      payloadJson: JSON.stringify(payload),
      generatedAt: hour,
      updatedAt: now,
    });
  },
});

export const cleanupPipelineRunLogs = internalMutation({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const retentionDays = Math.max(
      1,
      Math.floor(
        await readConfigNumber(ctx, "pipeline_run_log_retention_days", 14),
      ),
    );
    const cutoff = Date.now() - retentionDays * DAY_MS;
    const limit = Math.min(Math.max(Math.floor(args.limit ?? 500), 1), 1000);
    const rows = await ctx.db
      .query("pipelineRunLogs")
      .withIndex("by_created_at", (q) => q.lt("createdAt", cutoff))
      .take(limit);
    for (const row of rows) await ctx.db.delete(row._id);
    return { deleted: rows.length, retentionDays };
  },
});

export const getPipelineFunnelToday = query({
  args: {},
  handler: async (ctx) => {
    await requireAdminUser(ctx);
    const today = dateKey(Date.now());
    const start = Date.parse(`${today}T00:00:00.000Z`);
    const [
      articleStats,
      processingCount,
      publishedCount,
      previewsFirstPublishedCount,
      previewsCreatedCount,
      previewsUpdatedCount,
      latestPreview,
      trendingRows,
    ] = await Promise.all([
        limitedReduce(
          () =>
            ctx.db
              .query("articles")
              .withIndex("by_published", (q) => q.gte("publishedAt", start)),
          { total: 0, statusCounts: {} as Record<string, number> },
          (acc, row) => {
            acc.total += 1;
            acc.statusCounts[row.status] =
              (acc.statusCounts[row.status] ?? 0) + 1;
            return acc;
          },
        ),
        limitedCount(() =>
          ctx.db
            .query("events")
            .withIndex("by_status_recency", (q) =>
              q.eq("status", "processing").gte("firstPublishedAt", start),
            ),
        ),
        limitedCount(() =>
          ctx.db
            .query("events")
            .withIndex("by_status_recency", (q) =>
              q.eq("status", "published").gte("firstPublishedAt", start),
            ),
        ),
        limitedCount(() =>
          ctx.db
            .query("publicEventPreviews")
            .withIndex("by_first_published_at", (q) =>
              q.gte("firstPublishedAt", start),
            ),
        ),
        limitedCount(() =>
          ctx.db
            .query("publicEventPreviews")
            .withIndex("by_created_at", (q) => q.gte("createdAt", start)),
        ),
        limitedCount(() =>
          ctx.db
            .query("publicEventPreviews")
            .withIndex("by_last_updated_at", (q) =>
              q.gte("lastUpdatedAt", start),
            ),
        ),
        ctx.db
          .query("publicEventPreviews")
          .withIndex("by_last_updated_at")
          .order("desc")
          .first(),
        ctx.db
          .query("publicEventPreviews")
          .withIndex("by_trending_score")
          .order("desc")
          .take(100),
      ]);
    const currentQueues = await Promise.all(
      ARTICLE_QUEUE_STATUSES.map(
        async (status) => ({
          status,
          count: await limitedCount(() =>
            ctx.db
              .query("articles")
              .withIndex("by_status", (q) => q.eq("status", status)),
          ),
        }),
      ),
    );

    return {
      date: today,
      ingested: articleStats.total,
      enriched: articleStats.statusCounts.enriched ?? 0,
      clustered: articleStats.statusCounts.clustered ?? 0,
      archived: articleStats.statusCounts.archived ?? 0,
      created: processingCount + publishedCount,
      published: previewsFirstPublishedCount,
      publishedBreakdown: {
        firstPublishedToday: previewsFirstPublishedCount,
        previewRowsCreatedToday: previewsCreatedCount,
        previewRowsUpdatedToday: previewsUpdatedCount,
        visibleInLatestToday: previewsUpdatedCount,
        visibleInTrendingTop100Today: trendingRows.filter(
          (row) => row.lastUpdatedAt >= start,
        ).length,
      },
      freshness: {
        sloMinutes: Math.round(FRESHNESS_SLO_MS / 60_000),
        latestFeedVisibleAt: latestPreview?.lastUpdatedAt,
        latestFeedVisibleAgeMs: latestPreview
          ? Date.now() - latestPreview.lastUpdatedAt
          : null,
        isFresh:
          latestPreview !== null &&
          Date.now() - latestPreview.lastUpdatedAt <= FRESHNESS_SLO_MS,
      },
      queues: Object.fromEntries(
        currentQueues.map((row) => [row.status, row.count]),
      ),
      updatedAt: Date.now(),
    };
  },
});

export const getStuckProcessingEvents = query({
  args: {},
  handler: async (ctx) => {
    await requireAdminUser(ctx);
    const now = Date.now();
    // Bounded: the response is five age buckets plus the 20 oldest rows, so a
    // 5000-row scan of full event docs bought nothing but I/O. Ascending order
    // means the oldest (the ones that matter) are always the rows we keep.
    const events = await ctx.db
      .query("events")
      .withIndex("by_status_last_article_at", (q) =>
        q.eq("status", "processing"),
      )
      .order("asc")
      .take(1000);
    const buckets: Record<string, number> = {
      "<1h": 0,
      "1-6h": 0,
      "6-24h": 0,
      "1-3d": 0,
      ">3d": 0,
    };
    for (const event of events) {
      buckets[bucketAge(now - (event.lastArticleAt ?? event.firstPublishedAt))]++;
    }
    return {
      buckets,
      oldest: events.slice(0, 20).map((event) => ({
        _id: event._id,
        title: event.title,
        lastArticleAt: event.lastArticleAt ?? event.firstPublishedAt,
        articleCount: event.articleCount ?? 1,
        sourceCount: event.sourceCount ?? 1,
      })),
    };
  },
});

export const getPipelineHealthSummary = query({
  args: {},
  handler: async (ctx) => {
    await requireAdminUser(ctx);
    const cutoff = Date.now() - DAY_MS;
    const logs = await ctx.db
      .query("pipelineRunLogs")
      .withIndex("by_created_at", (q) => q.gte("createdAt", cutoff))
      .order("desc")
      .take(1000);
    const byJob = new Map<
      string,
      {
        total: number;
        ok: number;
        error: number;
        degraded: number;
        fallbackRuns: number;
        durationMs: number;
      }
    >();
    for (const log of logs) {
      const row =
        byJob.get(log.jobName) ??
        {
          total: 0,
          ok: 0,
          error: 0,
          degraded: 0,
          fallbackRuns: 0,
          durationMs: 0,
        };
      row.total++;
      if (log.status === "ok") row.ok++;
      if (log.status === "error") row.error++;
      if (log.status === "degraded") row.degraded++;
      if (log.gauges.usedFallbackMode === true) {
        row.fallbackRuns++;
      }
      row.durationMs += log.durationMs;
      byJob.set(log.jobName, row);
    }
    return {
      jobs: Array.from(byJob.entries()).map(([jobName, row]) => ({
        jobName,
        ...row,
        successRatio: row.total === 0 ? 1 : row.ok / row.total,
        averageDurationMs:
          row.total === 0 ? 0 : Math.round(row.durationMs / row.total),
      })),
      latest: logs.slice(0, 50),
    };
  },
});

export const getVectorBudgetStatus = query({
  args: {},
  handler: async (ctx) => {
    await requireAdminUser(ctx);
    const today = dateKey(Date.now());
    const total = await ctx.db
      .query("vectorSearchDailyTotal")
      .withIndex("by_date", (q) => q.eq("date", today))
      .unique();
    const limit = await readConfigNumber(
      ctx,
      "vector_search_daily_budget_qgb",
      25,
    );
    const cutoff = Date.now() - DAY_MS;
    const runs = await ctx.db
      .query("vectorSearchRuns")
      .withIndex("by_createdAt", (q) => q.gte("createdAt", cutoff))
      .take(1000);
    const fallbackRuns = runs.filter((run) => run.usedFallbackMode).length;
    const blockedRuns = runs.filter((run) => !run.budgetAllowed).length;
    const calibrationDefault = await readConfigNumber(
      ctx,
      "vector_search_per_search_bytes_default",
      31457280,
    );
    const observedQgb = await readConfigNumber(
      ctx,
      "vector_search_observed_qgb_last_24h",
      0,
    );
    const searches = runs.reduce((sum, run) => sum + run.vectorSearches, 0);
    const calibratedPerSearchBytes =
      observedQgb > 0 && searches > 0
        ? Math.min(
            Math.max((observedQgb * 1_000_000_000) / searches, 1024 * 1024),
            200 * 1024 * 1024,
          )
        : calibrationDefault;
    return {
      date: today,
      usedQgb: total?.qgbRead ?? 0,
      remainingQgb: Math.max(0, limit - (total?.qgbRead ?? 0)),
      limitQgb: limit,
      ratio: limit > 0 ? (total?.qgbRead ?? 0) / limit : 0,
      fallbackRuns,
      blockedRuns,
      calibratedPerSearchBytes,
      calibrationSource: observedQgb > 0 ? "observed" : "default",
      runsLast24h: runs.length,
      vectorSearchesLast24h: searches,
    };
  },
});

export const getArchivedArticleStats = query({
  args: {},
  handler: async (ctx) => {
    await requireAdminUser(ctx);
    const now = Date.now();
    const stats = await limitedReduce(
      () =>
        ctx.db
          .query("articles")
          .withIndex("by_archived_reason", (q) =>
            q.eq("archivedReason", "stale_singleton"),
          ),
      { total: 0, last24h: 0, last7d: 0 },
      (acc, row) => {
        acc.total += 1;
        if ((row.archivedAt ?? 0) >= now - DAY_MS) acc.last24h += 1;
        if ((row.archivedAt ?? 0) >= now - 7 * DAY_MS) acc.last7d += 1;
        return acc;
      },
    );
    return {
      byReason: {
        stale_singleton: stats.total,
      },
      last24h: stats.last24h,
      last7d: stats.last7d,
    };
  },
});

export const getPipelineDoctor = query({
  args: {},
  handler: async (ctx) => {
    await requireAdminUser(ctx);
    const now = Date.now();
    const staleLeaseCutoff = now;
    const queueRows = await Promise.all(
      ARTICLE_QUEUE_STATUSES.map(async (status) => {
        const [oldest, newest, count] = await Promise.all([
          ctx.db
            .query("articles")
            .withIndex("by_status_published", (q) => q.eq("status", status))
            .order("asc")
            .first(),
          ctx.db
            .query("articles")
            .withIndex("by_status_published", (q) => q.eq("status", status))
            .order("desc")
            .first(),
          limitedCount(() =>
            ctx.db
              .query("articles")
              .withIndex("by_status", (q) => q.eq("status", status)),
          ),
        ]);
        return {
          status,
          count,
          oldestPublishedAt: oldest?.publishedAt,
          oldestAgeMs: oldest ? now - oldest.publishedAt : null,
          newestPublishedAt: newest?.publishedAt,
          newestAgeMs: newest ? now - newest.publishedAt : null,
        };
      }),
    );

    const expiredProcessingArticles = await limitedCount(() =>
      ctx.db
        .query("articles")
        .withIndex("by_status_enrichment_lease", (q) =>
          q
            .eq("status", "processing")
            .lt("enrichmentLeaseExpiresAt", staleLeaseCutoff),
        ),
    );
    // Only the first 20 survivors of the filter below are ever returned, so a
    // 500-row scan of full event docs was ~2.5x more I/O than the answer needs.
    const recentProcessingEvents = await ctx.db
      .query("events")
      .withIndex("by_status_last_article_at", (q) =>
        q.eq("status", "processing"),
      )
      .order("desc")
      .take(200);
    const oneShortOfPublish = recentProcessingEvents
      .filter((event) => {
        const articleCount = event.articleCount ?? 1;
        const sourceCount = event.sourceCount ?? 1;
        return (
          (articleCount >= 2 && sourceCount === 1) ||
          (articleCount === 1 && sourceCount >= 2)
        );
      })
      .slice(0, 20)
      .map((event) => ({
        _id: event._id,
        title: event.title,
        articleCount: event.articleCount ?? 1,
        sourceCount: event.sourceCount ?? 1,
        lastArticleAt: event.lastArticleAt ?? event.firstPublishedAt,
        ageMs: now - (event.lastArticleAt ?? event.firstPublishedAt),
      }));

    const [latestRows, trendingRows, recentLogs] = await Promise.all([
      ctx.db
        .query("publicEventPreviews")
        .withIndex("by_last_updated_at")
        .order("desc")
        .take(20),
      ctx.db
        .query("publicEventPreviews")
        .withIndex("by_trending_score")
        .order("desc")
        .take(100),
      ctx.db
        .query("pipelineRunLogs")
        .withIndex("by_created_at", (q) => q.gte("createdAt", now - DAY_MS))
        .order("desc")
        .take(200),
    ]);
    const trendingIds = new Set(trendingRows.map((row) => row.eventId));
    const latestHiddenRows = latestRows.filter(
      (row) => !trendingIds.has(row.eventId),
    );
    const latestHiddenTotal = latestHiddenRows.length;
    const latestHiddenByTrending = latestHiddenRows
      .slice(0, 10)
      .map((row) => ({
        eventId: row.eventId,
        title: row.title,
        lastUpdatedAt: row.lastUpdatedAt,
        firstPublishedAt: row.firstPublishedAt,
        ageMs: now - row.lastUpdatedAt,
      }));
    const failureReasons = new Map<string, number>();
    for (const log of recentLogs) {
      if (log.status !== "error" && log.status !== "degraded") continue;
      const key =
        log.errorMessage ??
        (typeof log.gauges.reason === "string" ? log.gauges.reason : log.status);
      failureReasons.set(key, (failureReasons.get(key) ?? 0) + 1);
    }

    return {
      generatedAt: now,
      freshnessSloMinutes: Math.round(FRESHNESS_SLO_MS / 60_000),
      queues: queueRows,
      expiredProcessingArticles,
      processingEvents: {
        scannedRecent: recentProcessingEvents.length,
        oneShortOfPublish,
      },
      feedVisibility: {
        latestVisibleAt: latestRows[0]?.lastUpdatedAt,
        latestVisibleAgeMs: latestRows[0]
          ? now - latestRows[0].lastUpdatedAt
          : null,
        latestHiddenTotal,
        latestHiddenByTrending,
      },
      recentFailures: Array.from(failureReasons.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([reason, count]) => ({ reason, count })),
    };
  },
});

export const getActiveAlerts = query({
  args: {},
  handler: async (ctx) => {
    await requireAdminUser(ctx);
    return await ctx.db
      .query("pipelineAlerts")
      .withIndex("by_resolved_created_at", (q) => q.eq("resolvedAt", undefined))
      .order("desc")
      .take(100);
  },
});

export const getPipelineIoRollups = query({
  args: {
    sinceHours: v.optional(v.number()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireAdminUser(ctx);
    const sinceHours = Math.min(Math.max(Math.floor(args.sinceHours ?? 168), 1), 168);
    const limit = Math.min(Math.max(Math.floor(args.limit ?? 50), 1), 200);
    const cutoff = Date.now() - sinceHours * HOUR_MS;
    const rows = await ctx.db
      .query("pipelineAdminRollups")
      .withIndex("by_generated_at", (q) => q.gte("generatedAt", cutoff))
      .order("desc")
      .take(limit);
    return rows.map((row) => {
      try {
        return JSON.parse(row.payloadJson) as {
          jobName: string;
          bucketStart: number;
          readRows: number;
          writeRows: number;
          vectorSearches: number;
          runCount: number;
          errorCount: number;
          estimatedPayloadBytes: number;
          lastStatus: string;
        };
      } catch {
        const keyParts = row.key.split(":");
        const jobName =
          keyParts.length > 1 ? keyParts.slice(0, -1).join(":") : row.key;
        return {
          jobName,
          bucketStart: row.generatedAt,
          readRows: 0,
          writeRows: 0,
          vectorSearches: 0,
          runCount: 0,
          errorCount: 0,
          estimatedPayloadBytes: 0,
          lastStatus: "error",
        };
      }
    });
  },
});

export const acknowledgeAlert = mutation({
  args: { alertId: v.id("pipelineAlerts") },
  handler: async (ctx, args) => {
    const user = await requireAdminUser(ctx);
    const alert = await ctx.db.get(args.alertId);
    if (!alert) {
      throw new Error("Alert not found");
    }
    await ctx.db.patch(args.alertId, {
      acknowledgedBy: user.email,
      acknowledgedAt: Date.now(),
    });
    return { acknowledged: true };
  },
});

async function upsertAlert(
  ctx: ActionCtx,
  alert: {
    severity: "info" | "warning" | "error";
    code: string;
    message: string;
    details: Record<string, string | number | boolean | null>;
  },
) {
  await ctx.runMutation(internal.pipeline.upsertPipelineAlert, alert);
}

export const upsertPipelineAlert = internalMutation({
  args: {
    severity: v.union(
      v.literal("info"),
      v.literal("warning"),
      v.literal("error"),
    ),
    code: v.string(),
    message: v.string(),
    details: v.record(v.string(), pipelineMetricValue),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("pipelineAlerts")
      .withIndex("by_code_resolved", (q) =>
        q.eq("code", args.code).eq("resolvedAt", undefined),
      )
      .first();
    if (existing) return existing._id;
    return await ctx.db.insert("pipelineAlerts", {
      ...args,
      createdAt: Date.now(),
    });
  },
});

export const checkPipelineAlerts = internalAction({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const startedAt = now;
    const runId = `checkPipelineAlerts-${startedAt}`;
    let evaluatedRules = 0;
    let stuckProcessingOver72h = 0;
    let status: "ok" | "error" = "ok";
    let errorMessage: string | undefined;

    try {
      const { alertCheckPeriodMs } = await ctx.runQuery(
        internal.pipeline.getAlertCadence,
        {},
      );
      // Every rule below reasons over "what happened since the previous check",
      // so this is the natural evaluation window for anything that runs at
      // least once per batch window.
      const sinceLastCheck = now - alertCheckPeriodMs;
      // Daily jobs need a wider log history than the check period: the archive
      // job legitimately last ran ~23.5h before the 01:50 check, so a 24h log
      // window would miss it by minutes and alert on a healthy pipeline.
      const logLookbackMs = absentRunWindowMs(
        DAILY_JOB_PERIOD_MS,
        alertCheckPeriodMs,
      );

      const logs = await ctx.runQuery(internal.pipeline.getRecentPipelineLogs, {
        since: now - logLookbackMs,
        limit: 1000,
      });
      // COST: only fetch the vector runs the fallback rule actually looks at
      // (since the previous check) instead of a full day's worth.
      const vectorRuns = await ctx.runQuery(
        internal.pipeline.getRecentVectorRunsForAlerts,
        { since: sinceLastCheck },
      );

      // Clustering runs once per batch window, so an hour-wide window would
      // almost never contain a clustering run at all and this rule could never
      // fire. Evaluate every run since the previous check instead; 3 fallbacks
      // in that span still means "persistently degraded", not "one bad batch".
      const recentFallbackRuns = (
        vectorRuns as Array<Doc<"vectorSearchRuns">>
      ).filter(
        (run: Doc<"vectorSearchRuns">) =>
          run.jobName === "clusterEnrichedArticles" && run.usedFallbackMode,
      );
      evaluatedRules++;
      if (recentFallbackRuns.length >= 3) {
        await upsertAlert(ctx, {
          severity: "warning",
          code: "fallback_persistent",
          message:
            "clusterEnrichedArticles has used fallback mode at least 3 times since the previous alert check.",
          details: {
            count: recentFallbackRuns.length,
            windowMs: alertCheckPeriodMs,
          },
        });
      }

      const visible = await ctx.runQuery(
        internal.pipeline.countVisiblePreviewsSince,
        { since: now - FRESHNESS_SLO_MS },
      );
      evaluatedRules++;
      // FRESHNESS_SLO_MS is now one batch window x tolerance, so this window
      // always spans at least one completed summarize step. Zero visible
      // previews across two whole windows means the pipeline really has stopped
      // producing, not that we looked between batches.
      if (visible === 0) {
        await upsertAlert(ctx, {
          severity: "warning",
          code: "feed_visibility_drought",
          message: `No public feed previews became visible or refreshed within the ${Math.round(
            FRESHNESS_SLO_MS / HOUR_MS,
          )}-hour freshness SLO (${ALERT_TOLERANCE} batch windows).`,
          details: { since: now - FRESHNESS_SLO_MS },
        });
      }

      const budget = await ctx.runQuery(
        internal.pipeline.getVectorBudgetForAlerts,
        {},
      );
      // Vector spend no longer accrues smoothly across the day — it arrives in
      // WINDOWS_PER_DAY roughly equal steps. Expected progress must therefore be
      // measured in completed batch windows, not elapsed hours; the old
      // hour-based model treated a perfectly on-plan post-window reading as an
      // overrun (at 13:50 it expected 58% used while 3 of 4 windows had run).
      //
      // A window counts as completed only once its summarize step has run, not
      // the moment it starts — otherwise the whole of 00:00-00:45 is credited
      // with spend that has not happened yet, and a manual alert check in that
      // gap reads as an overrun.
      const nowDate = new Date(now);
      const startOfUtcDay = Date.UTC(
        nowDate.getUTCFullYear(),
        nowDate.getUTCMonth(),
        nowDate.getUTCDate(),
      );
      const windowsCompleted = Math.max(
        0,
        Math.min(
          WINDOWS_PER_DAY,
          Math.floor(
            (now - startOfUtcDay - WINDOW_COMPLETION_OFFSET_MS) /
              PIPELINE_WINDOW_MS,
          ) + 1,
        ),
      );
      const expectedDailyProgress = windowsCompleted / WINDOWS_PER_DAY;
      evaluatedRules++;
      // "Most of the budget gone with most of the day still to run." Only
      // meaningful while at least half the day's windows are still ahead: at
      // 3-of-4 windows completed, 75% used is exactly on plan, not an alarm.
      if (budget.ratio >= 0.75 && windowsCompleted <= WINDOWS_PER_DAY / 2) {
        await upsertAlert(ctx, {
          severity: "warning",
          code: "vector_budget_burn_rate",
          message: `Vector search qGB usage exceeded 75% with only ${windowsCompleted} of ${WINDOWS_PER_DAY} daily pipeline windows completed.`,
          details: {
            usedQgb: budget.usedQgb,
            limitQgb: budget.limitQgb,
            ratio: budget.ratio,
            windowsCompleted,
          },
        });
      }
      evaluatedRules++;
      if (
        budget.ratio >=
        Math.min(0.9, expectedDailyProgress + VECTOR_BURN_RATE_MARGIN)
      ) {
        await upsertAlert(ctx, {
          severity: "warning",
          code: "p0_budget_projected_exhaustion",
          message:
            "Vector budget burn rate is ahead of the day's completed pipeline windows; throttle non-core pipeline work before feed creation is affected.",
          details: {
            usedQgb: budget.usedQgb,
            limitQgb: budget.limitQgb,
            ratio: budget.ratio,
            expectedDailyProgress,
            windowsCompleted,
          },
        });
      }

      const stuckProcessing = await ctx.runQuery(
        internal.pipeline.countProcessingEventsOlderThan,
        { ageMs: 72 * HOUR_MS },
      );
      stuckProcessingOver72h = stuckProcessing.count;
      const recentAlertGauge = (logs as Array<Doc<"pipelineRunLogs">>)
        .filter(
          (log) =>
            log.jobName === "checkPipelineAlerts" &&
            typeof log.gauges.stuckProcessingOver72h === "number",
        )
        .sort((a, b) => b.startedAt - a.startedAt)[0];
      const previousStuckProcessingOver72h =
        recentAlertGauge === undefined
          ? undefined
          : recentAlertGauge.gauges.stuckProcessingOver72h;
      evaluatedRules++;
      // The count saturates at STUCK_PROCESSING_CAP so it stays cheap to
      // compute. Once saturated, growth is no longer observable — but a backlog
      // that large is itself the condition worth alerting on, so saturation
      // raises the alert directly instead of silently going quiet.
      if (stuckProcessing.saturated) {
        await upsertAlert(ctx, {
          severity: "warning",
          code: "stuck_processing_growth",
          message: `Processing events older than 72 hours reached the ${STUCK_PROCESSING_CAP}+ alerting cap.`,
          details: {
            current: stuckProcessingOver72h,
            saturated: true,
          },
        });
      } else if (
        typeof previousStuckProcessingOver72h === "number" &&
        stuckProcessingOver72h > previousStuckProcessingOver72h
      ) {
        await upsertAlert(ctx, {
          severity: "warning",
          code: "stuck_processing_growth",
          message:
            "Processing events older than 72 hours increased compared with the prior alert baseline.",
          details: {
            current: stuckProcessingOver72h,
            previous: previousStuckProcessingOver72h,
            previousStartedAt: recentAlertGauge.startedAt,
          },
        });
      }

      const byJob = new Map<string, { total: number; ok: number }>();
      for (const log of logs as Array<Doc<"pipelineRunLogs">>) {
        // A "skipped" run is a deliberate no-op (e.g. a job yielding to a
        // pipeline lock, or short-circuiting because it was already running).
        // It did no work, so it must not count as a failure toward the
        // error-rate SLO — otherwise jobs that intentionally yield (like the
        // stale-singleton archive) flap below 80%. The "job stuck skipping"
        // failure mode is still caught by the per-job absent-ok-run checks.
        if (log.status === "skipped") continue;
        const row = byJob.get(log.jobName) ?? { total: 0, ok: 0 };
        row.total++;
        if (log.status === "ok") row.ok++;
        byJob.set(log.jobName, row);
      }
      evaluatedRules++;
      const logLookbackHours = Math.round(logLookbackMs / HOUR_MS);
      for (const [jobName, row] of byJob.entries()) {
        // The 3-run minimum is what keeps this rule honest under the batched
        // cadence: per-window jobs accumulate ~6 runs across the log lookback,
        // so a single bad batch cannot trip it, while once-daily jobs never
        // reach the minimum and are covered by the absent-ok-run checks below
        // instead of by a 1-of-1 "0% success" false alarm.
        if (row.total >= 3 && row.ok / row.total < 0.8) {
          await upsertAlert(ctx, {
            severity: "error",
            code: `job_error_rate:${jobName}`,
            message: `${jobName} success ratio is below 80% over the last ${logLookbackHours} hours.`,
            details: { total: row.total, ok: row.ok },
          });
        }
      }
      // Enrichment runs once per batch window (:15 past), so a 30-minute window
      // never contained a run and this rule was dead. Evaluate every enrichment
      // run since the previous check instead.
      const enrichmentWindow = (logs as Array<Doc<"pipelineRunLogs">>).filter(
        (log) =>
          log.jobName === "enrichUnprocessedArticles" &&
          log.startedAt >= sinceLastCheck,
      );
      const enrichmentAttempts = enrichmentWindow.reduce(
        (sum, log) => sum + (log.counters.claimedArticles ?? 0),
        0,
      );
      const enrichmentFailures = enrichmentWindow.reduce(
        (sum, log) => sum + (log.counters.failedArticles ?? 0),
        0,
      );
      evaluatedRules++;
      if (
        enrichmentAttempts >= 10 &&
        enrichmentFailures / enrichmentAttempts > 0.2
      ) {
        await upsertAlert(ctx, {
          severity: "warning",
          code: "enrichment_failure_rate",
          message:
            "More than 20% of claimed enrichment articles failed since the previous alert check.",
          details: {
            attempts: enrichmentAttempts,
            failures: enrichmentFailures,
            ratio: enrichmentFailures / enrichmentAttempts,
            windowMs: alertCheckPeriodMs,
          },
        });
      }

      // archiveStaleSingletonEvents now runs once daily (02:20 UTC) rather than
      // continuously, so the old 4-hour window guaranteed a false alarm on every
      // check. One full job period plus one alert period absorbs the legitimate
      // ~23.5h gap seen by the 01:50 check while still catching a job that has
      // genuinely stopped.
      const archiveAbsentWindowMs = absentRunWindowMs(
        DAILY_JOB_PERIOD_MS,
        alertCheckPeriodMs,
      );
      const archiveOk = (logs as Array<Doc<"pipelineRunLogs">>).some(
        (log: Doc<"pipelineRunLogs">) =>
          log.jobName === "archiveStaleSingletonEvents" &&
          log.status === "ok" &&
          log.startedAt >= now - archiveAbsentWindowMs,
      );
      evaluatedRules++;
      if (!archiveOk) {
        await upsertAlert(ctx, {
          severity: "warning",
          code: "archive_run_absent",
          message: `archiveStaleSingletonEvents has not produced an ok log in the last ${Math.round(
            archiveAbsentWindowMs / HOUR_MS,
          )} hours.`,
          details: { windowMs: archiveAbsentWindowMs },
        });
      }
    } catch (error) {
      status = "error";
      errorMessage = error instanceof Error ? error.message : String(error);
      console.error(
        JSON.stringify({
          scope: "checkPipelineAlerts",
          event: "error",
          runId,
          errorMessage,
        }),
      );
      await upsertAlert(ctx, {
        severity: "error",
        code: "pipeline_alert_check_error",
        message: "Pipeline alert evaluation failed.",
        details: { errorMessage },
      });
    }

    const finishedAt = Date.now();
    await ctx.runMutation(internal.pipeline.insertRunLog, {
      jobName: "checkPipelineAlerts",
      runId,
      startedAt,
      finishedAt,
      durationMs: finishedAt - startedAt,
      status,
      errorMessage,
      counters: { evaluatedRules },
      gauges: { stuckProcessingOver72h },
      metadata: {},
    });
    console.log(
      JSON.stringify({
        scope: "checkPipelineAlerts",
        event: "complete",
        runId,
        status,
        evaluatedRules,
        stuckProcessingOver72h,
        durationMs: finishedAt - startedAt,
      }),
    );
    return { checked: true };
  },
});

export const getRecentPipelineLogs = internalQuery({
  args: { since: v.number(), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("pipelineRunLogs")
      .withIndex("by_created_at", (q) => q.gte("createdAt", args.since))
      .take(Math.min(Math.max(args.limit ?? 1000, 1), 5000));
  },
});

export const getRecentVectorRunsForAlerts = internalQuery({
  args: { since: v.number() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("vectorSearchRuns")
      .withIndex("by_createdAt", (q) => q.gte("createdAt", args.since))
      .take(1000);
  },
});

export const countPublishedPreviewsSince = internalQuery({
  args: { since: v.number() },
  handler: async (ctx, args) => {
    return (
      await ctx.db
        .query("publicEventPreviews")
        .withIndex("by_first_published_at", (q) =>
          q.gte("firstPublishedAt", args.since),
        )
        .take(5000)
    ).length;
  },
});

export const countVisiblePreviewsSince = internalQuery({
  args: { since: v.number() },
  handler: async (ctx, args) => {
    return await limitedCount(() =>
      ctx.db
        .query("publicEventPreviews")
        .withIndex("by_last_updated_at", (q) =>
          q.gte("lastUpdatedAt", args.since),
        ),
    );
  },
});

/**
 * Saturating count of "stuck processing" events, used only by the 20-minute
 * alert cron.
 *
 * COST: this was the third-largest database-I/O consumer in the whole app
 * (~1.7 GB / 19 days). It ran 72x a day and read up to 5000 *full* event
 * documents per scan — twice, because the second scan re-reads essentially the
 * same rows just to catch legacy rows that predate `lastArticleAt`.
 *
 * The alert rule only asks "is the backlog growing?", never "exactly how big is
 * it?", so an exact count was never needed. We now stop at STUCK_PROCESSING_CAP
 * and report saturation explicitly: below the cap the growth comparison works
 * exactly as before, and at the cap `saturated` is itself the alarm (a backlog
 * of 300+ stuck events is already a page-worthy state, and growth beyond it
 * tells the operator nothing new).
 */
const STUCK_PROCESSING_CAP = 300;
// Legacy rows missing `lastArticleAt` are a fixed, shrinking set that the
// primary index cannot see. Sample a small window rather than walking every
// old processing event to count what is almost always zero.
const STUCK_PROCESSING_LEGACY_CAP = 100;

export const countProcessingEventsOlderThan = internalQuery({
  args: { ageMs: v.number() },
  handler: async (ctx, args) => {
    const cutoff = Date.now() - Math.max(0, args.ageMs);
    const withLastArticleAt = await limitedCount(
      () =>
        ctx.db
          .query("events")
          .withIndex("by_status_last_article_at", (q) =>
            q.eq("status", "processing").lt("lastArticleAt", cutoff),
          ),
      STUCK_PROCESSING_CAP,
    );
    // Short-circuit: already saturated, so the legacy scan cannot change the
    // reported signal.
    const withoutLastArticleAt =
      withLastArticleAt >= STUCK_PROCESSING_CAP
        ? 0
        : await limitedReduce(
            () =>
              ctx.db
                .query("events")
                .withIndex("by_status_recency", (q) =>
                  q.eq("status", "processing").lt("firstPublishedAt", cutoff),
                ),
            0,
            (acc, row) => (row.lastArticleAt === undefined ? acc + 1 : acc),
            STUCK_PROCESSING_LEGACY_CAP,
          );
    const count = Math.min(
      withLastArticleAt + withoutLastArticleAt,
      STUCK_PROCESSING_CAP,
    );
    return { count, saturated: count >= STUCK_PROCESSING_CAP };
  },
});

/**
 * The alert-check cadence, read from config so the thresholds track the
 * check-pipeline-alerts cron without a code deploy. `checkPipelineAlerts` is an
 * action and has no `ctx.db`, hence the wrapper.
 */
export const getAlertCadence = internalQuery({
  args: {},
  handler: async (ctx) => {
    const minutes = await readConfigNumber(
      ctx,
      "pipeline_alert_check_interval_minutes",
      DEFAULT_ALERT_CHECK_PERIOD_MS / 60_000,
    );
    // Clamp so a mistyped config value can neither disable alerting (absurdly
    // wide windows) nor make it hair-trigger (windows narrower than a run).
    const clamped = Math.min(Math.max(minutes, 5), 24 * 60);
    return { alertCheckPeriodMs: clamped * 60_000 };
  },
});

export const getVectorBudgetForAlerts = internalQuery({
  args: {},
  handler: async (ctx) => {
    const today = dateKey(Date.now());
    const total = await ctx.db
      .query("vectorSearchDailyTotal")
      .withIndex("by_date", (q) => q.eq("date", today))
      .unique();
    const limit = await readConfigNumber(
      ctx,
      "vector_search_daily_budget_qgb",
      25,
    );
    return {
      usedQgb: total?.qgbRead ?? 0,
      limitQgb: limit,
      ratio: limit > 0 ? (total?.qgbRead ?? 0) / limit : 0,
    };
  },
});

export const triggerPipelineJob = mutation({
  args: {
    jobName: v.union(
      v.literal("ingestAllFeeds"),
      v.literal("enrichUnprocessedArticles"),
      v.literal("archiveStaleSingletonEvents"),
      v.literal("mergeNearDuplicateEvents"),
      v.literal("reclusterRecentSingletonEvents"),
      v.literal("clusterEnrichedArticles"),
      v.literal("deleteStaleProcessingEvents"),
      v.literal("checkPipelineAlerts"),
    ),
  },
  handler: async (ctx, args) => {
    await requireAdminUser(ctx);
    if (args.jobName === "ingestAllFeeds") {
      await ctx.scheduler.runAfter(0, internal.ingestion.ingestAllFeeds, {});
    } else if (args.jobName === "enrichUnprocessedArticles") {
      await ctx.scheduler.runAfter(
        0,
        internal.enrichmentNode.enrichUnprocessedArticles,
        {},
      );
    } else if (args.jobName === "archiveStaleSingletonEvents") {
      await ctx.scheduler.runAfter(
        0,
        internal.singletonCleanup.archiveStaleSingletonEvents,
        { autoContinue: true },
      );
    } else if (args.jobName === "mergeNearDuplicateEvents") {
      await ctx.scheduler.runAfter(0, internal.clustering.mergeNearDuplicateEvents, {});
    } else if (args.jobName === "reclusterRecentSingletonEvents") {
      await ctx.scheduler.runAfter(
        0,
        internal.clustering.reclusterRecentSingletonEvents,
        {},
      );
    } else if (args.jobName === "clusterEnrichedArticles") {
      await ctx.scheduler.runAfter(0, internal.clustering.clusterEnrichedArticles, {});
    } else if (args.jobName === "deleteStaleProcessingEvents") {
      await ctx.scheduler.runAfter(
        0,
        internal.singletonCleanup.deleteStaleProcessingEvents,
        { autoContinue: true },
      );
    } else {
      await ctx.scheduler.runAfter(0, internal.pipeline.checkPipelineAlerts, {});
    }
    return { scheduled: true };
  },
});

export const setVectorObservedQgb = mutation({
  args: { observedQgb: v.number() },
  handler: async (ctx, args) => {
    await requireAdminUser(ctx);
    const key = "vector_search_observed_qgb_last_24h";
    const value = JSON.stringify(Math.max(0, args.observedQgb));
    const description =
      "Optional operator-provided observed Convex vector qGB for the last 24 hours, used to calibrate per-search cost estimates.";
    const existing = await ctx.db
      .query("config")
      .withIndex("by_key", (q) => q.eq("key", key))
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, {
        value,
        description,
        updatedAt: Date.now(),
      });
    } else {
      await ctx.db.insert("config", {
        key,
        value,
        description,
        updatedAt: Date.now(),
      });
    }
    return { saved: true };
  },
});
