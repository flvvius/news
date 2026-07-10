/**
 * L11 — automated data minimization. RETENTION_POLICY is the single source
 * of truth for every data class → retention period (this doubles as the
 * GDPR Art. 30 records input and feeds the privacy policy). Each purge run
 * logs (data class, deleted count, timestamp) to pipelineRunLogs.
 *
 * Data classes with no purge job here, and why:
 *  - article body text: NEVER persisted — fetched transiently per
 *    summarization run and dropped (lib/articleExtraction.fetchArticleBodyText);
 *    retention is zero by construction (see no-article-body-storage rule).
 *  - unverified accounts: authMaintenance.cleanupExpiredUnverifiedAccounts
 *    (7 days), already scheduled in crons.ts.
 *  - opted-out domain content: purged immediately on state change (L5).
 */

import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import { internal } from "./_generated/api";

export const RETENTION_POLICY = {
  /** Waitlist signups that never engaged (still pending, never invited). */
  waitlistUnengagedDays: 90,
  /** Reading history / interaction log. */
  readingHistoryDays: 548, // 18 months
  /** Unverified accounts (enforced by authMaintenance). */
  unverifiedAccountDays: 7,
  /** Personalized insights (already enforced via userInsights.expiresAt). */
  userInsightsDays: 30,
  /** Transient article body text: never stored (retention zero). */
  articleBodyTextDays: 0,
} as const;

const PURGE_BATCH = 200;

async function logPurgeRun(
  ctx: MutationCtx,
  dataClass: string,
  deleted: number,
  done: boolean,
) {
  const now = Date.now();
  await ctx.db.insert("pipelineRunLogs", {
    jobName: `retention:${dataClass}`,
    runId: `${dataClass}-${now}`,
    startedAt: now,
    finishedAt: now,
    durationMs: 0,
    status: "ok",
    counters: { deleted },
    gauges: { done },
    metadata: { dataClass },
    createdAt: now,
  });
}

/**
 * Waitlist rows still `pending` (never invited, never converted — no
 * confirmed engagement) older than the retention window are deleted.
 */
export const purgeStaleWaitlistEntries = internalMutation({
  args: { retentionDays: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const retentionDays =
      args.retentionDays ?? RETENTION_POLICY.waitlistUnengagedDays;
    const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;

    const candidates = await ctx.db
      .query("waitlist")
      .withIndex("by_status", (q) =>
        q.eq("status", "pending").lt("createdAt", cutoff),
      )
      .take(PURGE_BATCH);

    for (const row of candidates) {
      await ctx.db.delete(row._id);
    }
    const done = candidates.length < PURGE_BATCH;
    await logPurgeRun(ctx, "waitlist_unengaged", candidates.length, done);

    if (!done) {
      await ctx.scheduler.runAfter(
        0,
        internal.retention.purgeStaleWaitlistEntries,
        { retentionDays },
      );
    }
    return { deleted: candidates.length, done };
  },
});

/** Interaction log entries (reading history) older than 18 months. */
export const purgeOldReadingHistory = internalMutation({
  args: { retentionDays: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const retentionDays =
      args.retentionDays ?? RETENTION_POLICY.readingHistoryDays;
    const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;

    const candidates = await ctx.db
      .query("interactions")
      .withIndex("by_timestamp", (q) => q.lt("timestamp", cutoff))
      .take(PURGE_BATCH);

    for (const row of candidates) {
      await ctx.db.delete(row._id);
    }
    const done = candidates.length < PURGE_BATCH;
    await logPurgeRun(ctx, "reading_history", candidates.length, done);

    if (!done) {
      await ctx.scheduler.runAfter(
        0,
        internal.retention.purgeOldReadingHistory,
        { retentionDays },
      );
    }
    return { deleted: candidates.length, done };
  },
});

/** Expired personalized insights (belt-and-suspenders over expiresAt). */
export const purgeExpiredUserInsights = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const candidates = await ctx.db
      .query("userInsights")
      .withIndex("by_expires_at", (q) => q.lt("expiresAt", now))
      .take(PURGE_BATCH);

    for (const row of candidates) {
      await ctx.db.delete(row._id);
    }
    const done = candidates.length < PURGE_BATCH;
    await logPurgeRun(ctx, "user_insights", candidates.length, done);

    if (!done) {
      await ctx.scheduler.runAfter(
        0,
        internal.retention.purgeExpiredUserInsights,
        {},
      );
    }
    return { deleted: candidates.length, done };
  },
});
