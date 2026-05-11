import { v } from "convex/values";
import {
  internalMutation,
  internalQuery,
  query,
} from "./_generated/server";
import { internal } from "./_generated/api";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { requireAdminUser } from "./lib/betaAccess";

const DEFAULT_DAILY_VECTOR_SEARCH_BUDGET_QGB = 0.25;
const DEFAULT_VECTOR_SEARCH_RUN_RETENTION_DAYS = 30;
const ESTIMATED_VECTOR_ROW_BYTES = 5 * 1024;
const VECTOR_SEARCH_RESERVATION_TTL_MS = 15 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const VECTOR_SEARCH_RUN_CLEANUP_CONTINUATION_DELAY_MS = 500;

function roundQgb(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function formatUtcDate(timestamp: number): string {
  return new Date(timestamp).toISOString().split("T")[0]!;
}

function getUtcShard(timestamp: number): number {
  return new Date(timestamp).getUTCHours();
}

async function getConfigBoolean(
  ctx: QueryCtx | MutationCtx,
  key: string,
  fallback: boolean,
): Promise<boolean> {
  const row = await ctx.db
    .query("config")
    .withIndex("by_key", (q) => q.eq("key", key))
    .unique();
  if (!row) return fallback;

  try {
    return JSON.parse(row.value) === true;
  } catch {
    return fallback;
  }
}

async function getConfigNumber(
  ctx: QueryCtx | MutationCtx,
  key: string,
  fallback: number,
): Promise<number> {
  const row = await ctx.db
    .query("config")
    .withIndex("by_key", (q) => q.eq("key", key))
    .unique();
  if (!row) return fallback;

  try {
    const parsed = Number(JSON.parse(row.value));
    return Number.isFinite(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

async function getDailyTotals(
  ctx: QueryCtx | MutationCtx,
  date: string,
): Promise<{ qgbRead: number; vectorSearches: number; runCount: number }> {
  const total = await ctx.db
    .query("vectorSearchDailyTotal")
    .withIndex("by_date", (q) => q.eq("date", date))
    .unique();
  if (total) {
    return {
      qgbRead: roundQgb(total.qgbRead),
      vectorSearches: total.vectorSearches,
      runCount: total.runCount,
    };
  }

  const rows = await ctx.db
    .query("vectorSearchDaily")
    .withIndex("by_date", (q) => q.eq("date", date))
    .collect();
  return {
    qgbRead: roundQgb(rows.reduce((sum, row) => sum + row.qgbRead, 0)),
    vectorSearches: rows.reduce((sum, row) => sum + row.vectorSearches, 0),
    runCount: rows.reduce((sum, row) => sum + row.runCount, 0),
  };
}

async function ensureDailyTotal(ctx: MutationCtx, date: string) {
  const existing = await ctx.db
    .query("vectorSearchDailyTotal")
    .withIndex("by_date", (q) => q.eq("date", date))
    .unique();
  if (existing) return existing;

  const totals = await getDailyTotals(ctx, date);
  try {
    const totalId = await ctx.db.insert("vectorSearchDailyTotal", {
      date,
      qgbRead: totals.qgbRead,
      vectorSearches: totals.vectorSearches,
      runCount: totals.runCount,
      updatedAt: Date.now(),
    });
    return await ctx.db.get(totalId);
  } catch (error) {
    const createdByConcurrentMutation = await ctx.db
      .query("vectorSearchDailyTotal")
      .withIndex("by_date", (q) => q.eq("date", date))
      .unique();
    if (createdByConcurrentMutation) return createdByConcurrentMutation;
    throw error;
  }
}

async function adjustDailyUsage(
  ctx: MutationCtx,
  args: {
    date: string;
    shard: number;
    deltaQgbRead: number;
    deltaVectorSearches: number;
    deltaRunCount: number;
  },
): Promise<void> {
  const existing = await ctx.db
    .query("vectorSearchDaily")
    .withIndex("by_date_shard", (q) =>
      q.eq("date", args.date).eq("shard", args.shard),
    )
    .unique();

  const nextQgbRead = roundQgb(
    Math.max(0, (existing?.qgbRead ?? 0) + args.deltaQgbRead),
  );
  const nextVectorSearches = Math.max(
    0,
    (existing?.vectorSearches ?? 0) + args.deltaVectorSearches,
  );
  const nextRunCount = Math.max(0, (existing?.runCount ?? 0) + args.deltaRunCount);
  const appliedQgb = roundQgb(nextQgbRead - (existing?.qgbRead ?? 0));
  const appliedSearches = nextVectorSearches - (existing?.vectorSearches ?? 0);
  const appliedRuns = nextRunCount - (existing?.runCount ?? 0);
  const total = await ensureDailyTotal(ctx, args.date);
  let appliedQgbToTotal = appliedQgb;
  let appliedSearchesToTotal = appliedSearches;
  let appliedRunsToTotal = appliedRuns;

  if (existing) {
    await ctx.db.patch(existing._id, {
      qgbRead: nextQgbRead,
      vectorSearches: nextVectorSearches,
      runCount: nextRunCount,
      updatedAt: Date.now(),
    });
  } else {
    try {
      await ctx.db.insert("vectorSearchDaily", {
        date: args.date,
        shard: args.shard,
        qgbRead: nextQgbRead,
        vectorSearches: nextVectorSearches,
        runCount: nextRunCount,
        updatedAt: Date.now(),
      });
    } catch (error) {
      const createdByConcurrentMutation = await ctx.db
        .query("vectorSearchDaily")
        .withIndex("by_date_shard", (q) =>
          q.eq("date", args.date).eq("shard", args.shard),
        )
        .unique();
      if (!createdByConcurrentMutation) throw error;

      const retryQgbRead = roundQgb(
        Math.max(0, createdByConcurrentMutation.qgbRead + args.deltaQgbRead),
      );
      const retryVectorSearches = Math.max(
        0,
        createdByConcurrentMutation.vectorSearches + args.deltaVectorSearches,
      );
      const retryRunCount = Math.max(
        0,
        createdByConcurrentMutation.runCount + args.deltaRunCount,
      );
      appliedQgbToTotal = roundQgb(
        retryQgbRead - createdByConcurrentMutation.qgbRead,
      );
      appliedSearchesToTotal =
        retryVectorSearches - createdByConcurrentMutation.vectorSearches;
      appliedRunsToTotal = retryRunCount - createdByConcurrentMutation.runCount;

      await ctx.db.patch(createdByConcurrentMutation._id, {
        qgbRead: retryQgbRead,
        vectorSearches: retryVectorSearches,
        runCount: retryRunCount,
        updatedAt: Date.now(),
      });
    }
  }

  if (total) {
    await ctx.db.patch(total._id, {
      qgbRead: roundQgb((total.qgbRead ?? 0) + appliedQgbToTotal),
      vectorSearches: Math.max(
        0,
        (total.vectorSearches ?? 0) + appliedSearchesToTotal,
      ),
      runCount: Math.max(0, (total.runCount ?? 0) + appliedRunsToTotal),
      updatedAt: Date.now(),
    });
  } else {
    await ctx.db.insert("vectorSearchDailyTotal", {
      date: args.date,
      qgbRead: roundQgb(appliedQgbToTotal),
      vectorSearches: Math.max(0, appliedSearchesToTotal),
      runCount: Math.max(0, appliedRunsToTotal),
      updatedAt: Date.now(),
    });
  }
}

async function releaseExpiredReservations(
  ctx: MutationCtx,
  now: number,
): Promise<void> {
  for (;;) {
    const expired = await ctx.db
      .query("vectorSearchReservations")
      .withIndex("by_status_expiresAt", (q) =>
        q.eq("status", "reserved").lte("expiresAt", now),
      )
      .take(100);

    if (expired.length === 0) return;

    for (const reservation of expired) {
      await adjustDailyUsage(ctx, {
        date: reservation.date,
        shard: reservation.shard,
        deltaQgbRead: -reservation.qgbReserved,
        deltaVectorSearches: -reservation.vectorSearchesReserved,
        deltaRunCount: 0,
      });
      await ctx.db.patch(reservation._id, {
        status: "released",
        updatedAt: now,
      });
    }
  }
}

export function estimateVectorSearchQgbRead(args: {
  vectorSearches: number;
  averageMatchesReturned: number;
  estimatedVectorRowBytes?: number;
}): number {
  const estimatedVectorRowBytes =
    args.estimatedVectorRowBytes ?? ESTIMATED_VECTOR_ROW_BYTES;
  const bytesRead =
    Math.max(0, args.vectorSearches) *
    Math.max(0, args.averageMatchesReturned) *
    estimatedVectorRowBytes;
  return roundQgb(bytesRead / 1_000_000_000);
}

export const checkBudget = internalQuery({
  args: {},
  handler: async (ctx) => {
    const enabled = await getConfigBoolean(
      ctx,
      "vector_search_budget_enabled",
      true,
    );
    const dailyLimitQgb = await getConfigNumber(
      ctx,
      "vector_search_daily_budget_qgb",
      DEFAULT_DAILY_VECTOR_SEARCH_BUDGET_QGB,
    );
    const today = formatUtcDate(Date.now());
    const totals = await getDailyTotals(ctx, today);
    const allowed = !enabled || totals.qgbRead < dailyLimitQgb;

    return {
      enabled,
      allowed,
      usedQgb: totals.qgbRead,
      remainingQgb: roundQgb(Math.max(0, dailyLimitQgb - totals.qgbRead)),
      dailyLimitQgb,
      vectorSearches: totals.vectorSearches,
      runCount: totals.runCount,
      fallbackModeEnabled: await getConfigBoolean(
        ctx,
        "vector_search_fallback_mode_enabled",
        true,
      ),
    };
  },
});

export const reserveUsage = internalMutation({
  args: {
    jobName: v.string(),
    runId: v.string(),
    qgbRead: v.number(),
    vectorSearches: v.number(),
  },
  handler: async (ctx, args) => {
    const enabled = await getConfigBoolean(
      ctx,
      "vector_search_budget_enabled",
      true,
    );
    const dailyLimitQgb = await getConfigNumber(
      ctx,
      "vector_search_daily_budget_qgb",
      DEFAULT_DAILY_VECTOR_SEARCH_BUDGET_QGB,
    );
    const now = Date.now();
    const date = formatUtcDate(now);
    const shard = getUtcShard(now);
    await releaseExpiredReservations(ctx, now);
    const totals = await getDailyTotals(ctx, date);
    const qgbRead = roundQgb(Math.max(0, args.qgbRead));
    const vectorSearches = Math.max(0, Math.floor(args.vectorSearches));
    const allowed = !enabled || totals.qgbRead + qgbRead <= dailyLimitQgb;

    if (!allowed) {
      return {
        allowed: false as const,
        enabled,
        usedQgb: totals.qgbRead,
        remainingQgb: roundQgb(Math.max(0, dailyLimitQgb - totals.qgbRead)),
        dailyLimitQgb,
        fallbackModeEnabled: await getConfigBoolean(
          ctx,
          "vector_search_fallback_mode_enabled",
          true,
        ),
      };
    }

    await adjustDailyUsage(ctx, {
      date,
      shard,
      deltaQgbRead: qgbRead,
      deltaVectorSearches: vectorSearches,
      deltaRunCount: 0,
    });

    const reservationId = await ctx.db.insert("vectorSearchReservations", {
      jobName: args.jobName,
      runId: args.runId,
      date,
      shard,
      qgbReserved: qgbRead,
      vectorSearchesReserved: vectorSearches,
      status: "reserved",
      createdAt: now,
      expiresAt: now + VECTOR_SEARCH_RESERVATION_TTL_MS,
      updatedAt: now,
    });

    return {
      allowed: true as const,
      reservationId,
      enabled,
      usedQgb: roundQgb(totals.qgbRead + qgbRead),
      remainingQgb: roundQgb(
        Math.max(0, dailyLimitQgb - totals.qgbRead - qgbRead),
      ),
      dailyLimitQgb,
      fallbackModeEnabled: await getConfigBoolean(
        ctx,
        "vector_search_fallback_mode_enabled",
        true,
      ),
    };
  },
});

export const consumeReservation = internalMutation({
  args: {
    reservationId: v.id("vectorSearchReservations"),
    qgbRead: v.number(),
    vectorSearches: v.number(),
  },
  handler: async (ctx, args) => {
    const reservation = await ctx.db.get(args.reservationId);
    if (!reservation || reservation.status !== "reserved") {
      return { consumed: false as const };
    }

    const qgbRead = roundQgb(Math.max(0, args.qgbRead));
    const vectorSearches = Math.max(0, Math.floor(args.vectorSearches));

    await adjustDailyUsage(ctx, {
      date: reservation.date,
      shard: reservation.shard,
      deltaQgbRead: roundQgb(qgbRead - reservation.qgbReserved),
      deltaVectorSearches:
        vectorSearches - reservation.vectorSearchesReserved,
      deltaRunCount: 0,
    });

    await ctx.db.patch(reservation._id, {
      qgbConsumed: qgbRead,
      vectorSearchesConsumed: vectorSearches,
      status: "consumed",
      updatedAt: Date.now(),
    });

    return { consumed: true as const };
  },
});

export const releaseReservation = internalMutation({
  args: {
    reservationId: v.id("vectorSearchReservations"),
  },
  handler: async (ctx, args) => {
    const reservation = await ctx.db.get(args.reservationId);
    if (!reservation || reservation.status !== "reserved") {
      return { released: false as const };
    }

    await adjustDailyUsage(ctx, {
      date: reservation.date,
      shard: reservation.shard,
      deltaQgbRead: -reservation.qgbReserved,
      deltaVectorSearches: -reservation.vectorSearchesReserved,
      deltaRunCount: 0,
    });

    await ctx.db.patch(reservation._id, {
      status: "released",
      updatedAt: Date.now(),
    });

    return { released: true as const };
  },
});

export const recordUsage = internalMutation({
  args: {
    jobName: v.string(),
    runId: v.string(),
    qgbRead: v.number(),
    vectorSearches: v.number(),
    vectorMatchesReturned: v.number(),
    vectorMatchesHydrated: v.number(),
    vectorMatchesDiscardedPostFetch: v.number(),
    usedFallbackMode: v.boolean(),
    budgetAllowed: v.boolean(),
    elapsedMs: v.number(),
    metricsJson: v.string(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const date = formatUtcDate(now);
    const shard = getUtcShard(now);
    const existingRun = await ctx.db
      .query("vectorSearchRuns")
      .withIndex("by_run_id", (q) => q.eq("runId", args.runId))
      .first();
    if (existingRun) {
      return { recorded: true as const };
    }
    const reservations = await ctx.db
      .query("vectorSearchReservations")
      .withIndex("by_run_id", (q) => q.eq("runId", args.runId))
      .collect();

    if (reservations.length === 0) {
      await adjustDailyUsage(ctx, {
        date,
        shard,
        deltaQgbRead: roundQgb(Math.max(0, args.qgbRead)),
        deltaVectorSearches: Math.max(0, Math.floor(args.vectorSearches)),
        deltaRunCount: 1,
      });
    } else {
      await adjustDailyUsage(ctx, {
        date,
        shard,
        deltaQgbRead: 0,
        deltaVectorSearches: 0,
        deltaRunCount: 1,
      });
    }

    await ctx.db.insert("vectorSearchRuns", {
      jobName: args.jobName,
      runId: args.runId,
      date,
      qgbRead: roundQgb(Math.max(0, args.qgbRead)),
      vectorSearches: Math.max(0, Math.floor(args.vectorSearches)),
      vectorMatchesReturned: Math.max(
        0,
        Math.floor(args.vectorMatchesReturned),
      ),
      vectorMatchesHydrated: Math.max(
        0,
        Math.floor(args.vectorMatchesHydrated),
      ),
      vectorMatchesDiscardedPostFetch: Math.max(
        0,
        Math.floor(args.vectorMatchesDiscardedPostFetch),
      ),
      usedFallbackMode: args.usedFallbackMode,
      budgetAllowed: args.budgetAllowed,
      elapsedMs: Math.max(0, Math.floor(args.elapsedMs)),
      metricsJson: args.metricsJson,
      createdAt: now,
    });

    return { recorded: true as const };
  },
});

export const getRecentRunSummaryForAdmin = query({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { limit }) => {
    await requireAdminUser(ctx);

    const pageSize = Math.floor(Math.max(1, Math.min(limit ?? 50, 200)));
    const rows = await ctx.db
      .query("vectorSearchRuns")
      .withIndex("by_date")
      .order("desc")
      .take(pageSize);

    const totals = rows.reduce(
      (acc, row) => {
        acc.qgbRead += row.qgbRead;
        acc.vectorSearches += row.vectorSearches;
        acc.vectorMatchesReturned += row.vectorMatchesReturned;
        acc.vectorMatchesHydrated += row.vectorMatchesHydrated;
        acc.vectorMatchesDiscardedPostFetch +=
          row.vectorMatchesDiscardedPostFetch;
        acc.runCount++;
        if (row.usedFallbackMode) acc.fallbackRuns++;
        if (!row.budgetAllowed) acc.budgetBlockedRuns++;
        return acc;
      },
      {
        qgbRead: 0,
        vectorSearches: 0,
        vectorMatchesReturned: 0,
        vectorMatchesHydrated: 0,
        vectorMatchesDiscardedPostFetch: 0,
        runCount: 0,
        fallbackRuns: 0,
        budgetBlockedRuns: 0,
      },
    );

    return {
      totals: {
        ...totals,
        qgbRead: roundQgb(totals.qgbRead),
      },
      runs: rows.map((row) => ({
        ...row,
        metrics:
          (() => {
            try {
              return JSON.parse(row.metricsJson);
            } catch {
              return null;
            }
          })(),
      })),
    };
  },
});

export const cleanupVectorSearchRuns = internalMutation({
  args: {
    limit: v.optional(v.number()),
    retentionDays: v.optional(v.number()),
    autoContinue: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const configuredRetentionDays = await getConfigNumber(
      ctx,
      "vector_search_run_retention_days",
      DEFAULT_VECTOR_SEARCH_RUN_RETENTION_DAYS,
    );
    const retentionDays = Math.max(
      1,
      Math.floor(args.retentionDays ?? configuredRetentionDays),
    );
    const pageSize = Math.floor(Math.max(1, Math.min(args.limit ?? 100, 500)));
    const cutoff = Date.now() - retentionDays * DAY_MS;
    const rows = await ctx.db
      .query("vectorSearchRuns")
      .withIndex("by_createdAt", (q) => q.lt("createdAt", cutoff))
      .take(pageSize);

    for (const row of rows) {
      await ctx.db.delete(row._id);
    }
    const hasMore = rows.length === pageSize;
    const scheduledContinuation = Boolean(args.autoContinue ?? true) && hasMore;
    if (scheduledContinuation) {
      await ctx.scheduler.runAfter(
        VECTOR_SEARCH_RUN_CLEANUP_CONTINUATION_DELAY_MS,
        internal.vectorSearchBudget.cleanupVectorSearchRuns,
        {
          limit: pageSize,
          retentionDays,
          autoContinue: true,
        },
      );
    }

    return {
      deleted: rows.length,
      retentionDays,
      hasMore,
      scheduledContinuation,
    };
  },
});
