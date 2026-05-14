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
const ARTICLE_QUEUE_STATUSES = [
  "unprocessed",
  "enriched",
  "processing",
  "archived",
] as const;
const PAGINATION_PAGE_SIZE = 1000;

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

type PaginatedQuery<T> = {
  paginate: (args: {
    cursor: string | null;
    numItems: number;
  }) => Promise<{
    page: T[];
    isDone: boolean;
    continueCursor: string | null;
  }>;
};

async function paginatedCount<T>(
  query: PaginatedQuery<T>,
  pageSize = PAGINATION_PAGE_SIZE,
): Promise<number> {
  let cursor: string | null = null;
  let total = 0;
  while (true) {
    const page = await query.paginate({
      cursor,
      numItems: pageSize,
    });
    total += page.page.length;
    if (page.isDone) break;
    cursor = page.continueCursor;
  }
  return total;
}

async function paginatedReduce<T, R>(
  query: PaginatedQuery<T>,
  initial: R,
  reducer: (accumulator: R, row: T) => R,
  pageSize = PAGINATION_PAGE_SIZE,
): Promise<R> {
  let cursor: string | null = null;
  let accumulator = initial;
  while (true) {
    const page = await query.paginate({
      cursor,
      numItems: pageSize,
    });
    for (const row of page.page) {
      accumulator = reducer(accumulator, row);
    }
    if (page.isDone) break;
    cursor = page.continueCursor;
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
    return await ctx.db.insert("pipelineRunLogs", {
      ...args,
      createdAt: Date.now(),
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
    const [articleStats, processingCount, publishedCount, previewsCount] =
      await Promise.all([
        paginatedReduce(
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
        paginatedCount(
          ctx.db
            .query("events")
            .withIndex("by_status_recency", (q) =>
              q.eq("status", "processing").gte("firstPublishedAt", start),
            ),
        ),
        paginatedCount(
          ctx.db
            .query("events")
            .withIndex("by_status_recency", (q) =>
              q.eq("status", "published").gte("firstPublishedAt", start),
            ),
        ),
        paginatedCount(
          ctx.db
            .query("publicEventPreviews")
            .withIndex("by_first_published_at", (q) =>
              q.gte("firstPublishedAt", start),
            ),
        ),
      ]);
    const currentQueues = await Promise.all(
      ARTICLE_QUEUE_STATUSES.map(
        async (status) => ({
          status,
          count: await paginatedCount(
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
      published: previewsCount,
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
    const events = await ctx.db
      .query("events")
      .withIndex("by_status_last_article_at", (q) =>
        q.eq("status", "processing"),
      )
      .order("asc")
      .take(5000);
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
    const stats = await paginatedReduce(
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
    const hourAgo = now - HOUR_MS;
    const dayAgo = now - DAY_MS;
    let evaluatedRules = 0;
    let stuckProcessingOver72h = 0;
    let status: "ok" | "error" = "ok";
    let errorMessage: string | undefined;

    try {
      const logs = await ctx.runQuery(internal.pipeline.getRecentPipelineLogs, {
        since: dayAgo,
        limit: 1000,
      });
      const vectorRuns = await ctx.runQuery(
        internal.pipeline.getRecentVectorRunsForAlerts,
        { since: dayAgo },
      );

      const recentFallbackRuns = (
        vectorRuns as Array<Doc<"vectorSearchRuns">>
      ).filter(
        (run: Doc<"vectorSearchRuns">) =>
          run.jobName === "clusterEnrichedArticles" &&
          run.usedFallbackMode &&
          run.createdAt >= hourAgo,
      );
      evaluatedRules++;
      if (recentFallbackRuns.length >= 3) {
        await upsertAlert(ctx, {
          severity: "warning",
          code: "fallback_persistent",
          message:
            "clusterEnrichedArticles has used fallback mode at least 3 times in the last hour.",
          details: { count: recentFallbackRuns.length },
        });
      }

      const published = await ctx.runQuery(
        internal.pipeline.countPublishedPreviewsSince,
        { since: now - 6 * HOUR_MS },
      );
      evaluatedRules++;
      if (published === 0) {
        await upsertAlert(ctx, {
          severity: "warning",
          code: "publish_drought",
          message: "No events have been published in the last 6 hours.",
          details: { since: now - 6 * HOUR_MS },
        });
      }

      const budget = await ctx.runQuery(
        internal.pipeline.getVectorBudgetForAlerts,
        {},
      );
      evaluatedRules++;
      if (budget.ratio >= 0.75 && new Date(now).getUTCHours() < 18) {
        await upsertAlert(ctx, {
          severity: "warning",
          code: "vector_budget_burn_rate",
          message: "Vector search qGB usage exceeded 75% before 18:00 UTC.",
          details: {
            usedQgb: budget.usedQgb,
            limitQgb: budget.limitQgb,
            ratio: budget.ratio,
          },
        });
      }

      stuckProcessingOver72h = await ctx.runQuery(
        internal.pipeline.countProcessingEventsOlderThan,
        { ageMs: 72 * HOUR_MS },
      );
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
      if (
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
        const row = byJob.get(log.jobName) ?? { total: 0, ok: 0 };
        row.total++;
        if (log.status === "ok") row.ok++;
        byJob.set(log.jobName, row);
      }
      evaluatedRules++;
      for (const [jobName, row] of byJob.entries()) {
        if (row.total >= 3 && row.ok / row.total < 0.8) {
          await upsertAlert(ctx, {
            severity: "error",
            code: `job_error_rate:${jobName}`,
            message: `${jobName} success ratio is below 80% over the last 24 hours.`,
            details: { total: row.total, ok: row.ok },
          });
        }
      }

      const archiveOk = (logs as Array<Doc<"pipelineRunLogs">>).some(
        (log: Doc<"pipelineRunLogs">) =>
          log.jobName === "archiveStaleSingletonEvents" &&
          log.status === "ok" &&
          log.startedAt >= now - 4 * HOUR_MS,
      );
      evaluatedRules++;
      if (!archiveOk) {
        await upsertAlert(ctx, {
          severity: "warning",
          code: "archive_run_absent",
          message:
            "archiveStaleSingletonEvents has not produced an ok log in the last 4 hours.",
          details: {},
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

export const countProcessingEventsOlderThan = internalQuery({
  args: { ageMs: v.number() },
  handler: async (ctx, args) => {
    const cutoff = Date.now() - Math.max(0, args.ageMs);
    const withLastArticleAt = await paginatedCount(
      ctx.db
        .query("events")
        .withIndex("by_status_last_article_at", (q) =>
          q.eq("status", "processing").lt("lastArticleAt", cutoff),
        ),
    );
    const withoutLastArticleAt = await paginatedReduce(
      ctx.db
        .query("events")
        .withIndex("by_status_recency", (q) =>
          q.eq("status", "processing").lt("firstPublishedAt", cutoff),
        ),
      0,
      (acc, row) => (row.lastArticleAt === undefined ? acc + 1 : acc),
    );
    return withLastArticleAt + withoutLastArticleAt;
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
      v.literal("archiveStaleSingletonEvents"),
      v.literal("mergeNearDuplicateEvents"),
      v.literal("reclusterRecentSingletonEvents"),
      v.literal("clusterEnrichedArticles"),
    ),
  },
  handler: async (ctx, args) => {
    await requireAdminUser(ctx);
    if (args.jobName === "archiveStaleSingletonEvents") {
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
    } else {
      await ctx.scheduler.runAfter(0, internal.clustering.clusterEnrichedArticles, {});
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
