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
 *
 * ---------------------------------------------------------------------------
 * Storage-cost retention (see STORAGE_RETENTION_DEFAULTS below)
 * ---------------------------------------------------------------------------
 * RETENTION_POLICY covers the *legal* minimization classes. The classes below
 * are *operational* — they exist to stop unbounded Convex database growth
 * (billed per GB-month). They are runtime-tunable via the `config` table so
 * the window can be shortened without a deploy; the inline defaults here are
 * authoritative until the key is seeded.
 */

import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { getConfig } from "./config";

// Moved to lib/retentionPolicy.ts (pure) so the web privacy policy renders
// from the exact object the purge crons enforce.
export { RETENTION_POLICY } from "./lib/retentionPolicy";
import { RETENTION_POLICY } from "./lib/retentionPolicy";

const PURGE_BATCH = 200;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Operational (storage-cost) retention. Each entry documents a data class,
 * the config key that tunes it and the default used before that key exists.
 *
 *  - articleEmbeddings (stale): 512-float vectors (~4 KB+ per row) that exist
 *    ONLY so clustering can vector-match *recent* articles. Clustering never
 *    looks further back than `DEFAULT_RECLUSTER_WINDOW_HOURS` (48h, see
 *    clustering.ts), so a vector whose article is 45 days old can no longer
 *    influence any clustering decision — it is pure paid storage. The article
 *    row itself is KEPT (it is rendered in the UI and referenced by events);
 *    only the vector is dropped.
 *  - articleEmbeddings (orphaned): vectors whose `articleId` no longer
 *    resolves. Unreachable by every read path in the codebase (all of them go
 *    article -> by_article -> embedding), so they are pure garbage.
 *  - articles (archived + detached): articles that singletonCleanup archived
 *    (`archivedReason` set, `eventId` cleared, their event deleted). Excluded
 *    from enrichment and clustering by status, never rendered. See the
 *    safety notes on purgeArchivedDetachedArticles.
 */
export const STORAGE_RETENTION_DEFAULTS = {
  /** Article embedding vectors, keyed on the article's publishedAt. */
  articleEmbeddingDays: 45,
  /** Articles archived by singletonCleanup and detached from every event. */
  archivedArticleDays: 90,
} as const;

/** Config keys that tune the storage-cost purges (registered in config.ts). */
export const STORAGE_RETENTION_CONFIG_KEYS = {
  articleEmbeddingDays: "article_embedding_retention_days",
  archivedArticleDays: "archived_article_retention_days",
} as const;

/**
 * The only archivedReason values singletonCleanup ever writes. Both paths
 * delete the owning event in the same mutation, so an article carrying either
 * reason is guaranteed to be detached from every event.
 */
const ARCHIVED_REASONS = ["stale_singleton", "stale_processing"] as const;

/**
 * clusterPairLabels is a hand-curated set (admin-labeled), so it is small.
 * If it ever exceeds this we refuse to delete articles rather than risk
 * deleting one the gold set references.
 */
const CLUSTER_LABEL_GUARD_LIMIT = 5000;

function clampBatch(value: number | undefined, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(1, Math.min(500, Math.floor(value)));
}

function clampRetentionDays(
  value: number | undefined,
  fallback: number,
  floor: number,
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  // Never let a bad config value shrink the window below the floor — that is
  // the guard that keeps a typo from deleting vectors clustering still needs.
  return Math.max(floor, Math.floor(value));
}

async function logPurgeRun(
  ctx: MutationCtx,
  dataClass: string,
  deleted: number,
  done: boolean,
  extra?: {
    counters?: Record<string, number>;
    gauges?: Record<string, number | boolean>;
    metadata?: Record<string, string | number | boolean>;
  },
) {
  const now = Date.now();
  await ctx.db.insert("pipelineRunLogs", {
    jobName: `retention:${dataClass}`,
    runId: `${dataClass}-${now}`,
    startedAt: now,
    finishedAt: now,
    durationMs: 0,
    status: "ok",
    counters: { deleted, ...(extra?.counters ?? {}) },
    gauges: { done, ...(extra?.gauges ?? {}) },
    metadata: { dataClass, ...(extra?.metadata ?? {}) },
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

// ---------------------------------------------------------------------------
// Storage-cost purges (Convex bills per GB-month of database storage)
// ---------------------------------------------------------------------------

/**
 * Delete `articleEmbeddings` rows belonging to articles outside the clustering
 * window. THE ARTICLE ROWS ARE LEFT INTACT — only the vector is dropped.
 *
 * Why this is safe: every read path for an embedding starts from an article
 * (`by_article` / `by_article_version`) and every one of those callers is
 * scoped to recent articles — clustering's recluster window defaults to 48h
 * (clustering.ts DEFAULT_RECLUSTER_WINDOW_HOURS) and enrichment only embeds
 * articles it is currently processing. A 45-day window is ~22x the widest
 * window anything actually reads, so no live clustering decision can change.
 * Consumers that miss an embedding degrade gracefully (they `return null` /
 * skip the article) rather than throwing.
 *
 * Scan strategy: walk the table on the implicit `by_creation_time` index
 * oldest-first with `_creationTime < cutoff`, so each invocation only touches
 * the head of the index and deleted rows never get re-read. Every candidate is
 * then double-checked against its article's `publishedAt` before deletion, so
 * a vector is only dropped when BOTH its creation time and its article are
 * beyond the window. Rows whose article no longer exists are deleted too (they
 * are orphans by definition and would otherwise stall the head of the scan).
 *
 * Re-runnable and self-chaining: it reschedules itself while a full batch is
 * still being deleted, and stops as soon as a batch makes no progress.
 */
export const purgeStaleArticleEmbeddings = internalMutation({
  args: {
    retentionDays: v.optional(v.number()),
    batchSize: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const configured = await getConfig<number>(
      ctx,
      STORAGE_RETENTION_CONFIG_KEYS.articleEmbeddingDays,
      STORAGE_RETENTION_DEFAULTS.articleEmbeddingDays,
    );
    // Floor of 7 days: even a fat-fingered config value can never cut into
    // the 48h clustering window (plus a wide safety margin).
    const retentionDays = clampRetentionDays(
      args.retentionDays ?? configured,
      STORAGE_RETENTION_DEFAULTS.articleEmbeddingDays,
      7,
    );
    const batchSize = clampBatch(args.batchSize, PURGE_BATCH);
    const cutoff = Date.now() - retentionDays * DAY_MS;

    const candidates = await ctx.db
      .query("articleEmbeddings")
      .withIndex("by_creation_time", (q) => q.lt("_creationTime", cutoff))
      .take(batchSize);

    let deleted = 0;
    let orphaned = 0;
    let skipped = 0;
    for (const row of candidates) {
      const article = await ctx.db.get(row.articleId);
      if (article === null) {
        // Unreachable garbage — no read path can reach it.
        await ctx.db.delete(row._id);
        deleted++;
        orphaned++;
        continue;
      }
      if (article.publishedAt >= cutoff) {
        // Old vector, recently published article (backfill edge case).
        // Keep it: the article could still be inside a clustering window.
        skipped++;
        continue;
      }
      await ctx.db.delete(row._id);
      deleted++;
    }

    // Stop when the head of the index is exhausted, or when a full batch
    // produced no deletions (otherwise skipped rows would loop forever).
    const done = candidates.length < batchSize || deleted === 0;
    await logPurgeRun(ctx, "article_embeddings_stale", deleted, done, {
      counters: { scanned: candidates.length, orphaned, skipped },
      metadata: { retentionDays, cutoff },
    });

    if (!done) {
      await ctx.scheduler.runAfter(
        0,
        internal.retention.purgeStaleArticleEmbeddings,
        { retentionDays, batchSize },
      );
    }
    return { deleted, scanned: candidates.length, skipped, orphaned, done };
  },
});

/**
 * Delete `articleEmbeddings` rows whose `articleId` no longer resolves to an
 * article. These are unreachable by construction — every consumer looks the
 * embedding up *from* an article via `by_article` / `by_article_version`, so a
 * vector with no article can never be read again.
 *
 * Unlike the stale purge this must sweep the whole table (an orphan can have
 * any creation time), so it walks it once with a persisted pagination cursor
 * chained through the scheduler instead of restarting from the front. Because
 * a sweep reads every vector row, this is bandwidth-expensive: schedule it
 * infrequently (weekly is plenty — the stale purge already collects every
 * orphan older than the embedding window for free).
 */
export const purgeOrphanedArticleEmbeddings = internalMutation({
  args: {
    cursor: v.optional(v.union(v.string(), v.null())),
    batchSize: v.optional(v.number()),
    scannedSoFar: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const batchSize = clampBatch(args.batchSize, PURGE_BATCH);

    const page = await ctx.db.query("articleEmbeddings").paginate({
      cursor: args.cursor ?? null,
      numItems: batchSize,
    });

    let deleted = 0;
    for (const row of page.page) {
      const article = await ctx.db.get(row.articleId);
      if (article !== null) continue;
      await ctx.db.delete(row._id);
      deleted++;
    }

    const scanned = (args.scannedSoFar ?? 0) + page.page.length;
    const done = page.isDone;
    await logPurgeRun(ctx, "article_embeddings_orphaned", deleted, done, {
      counters: { scanned: page.page.length, scannedTotal: scanned },
    });

    if (!done) {
      await ctx.scheduler.runAfter(
        0,
        internal.retention.purgeOrphanedArticleEmbeddings,
        {
          cursor: page.continueCursor,
          batchSize,
          scannedSoFar: scanned,
        },
      );
    }
    return { deleted, scanned, done };
  },
});

/**
 * Delete articles that singletonCleanup archived AND detached from every
 * event, once they are past the archived-article window. Their embeddings go
 * with them.
 *
 * Safety reasoning — every one of these must hold, and each is re-checked on
 * the row itself before the delete, not just assumed from the index:
 *  1. `archivedReason` is only ever set by singletonCleanup
 *     (`stale_singleton` / `stale_processing`), and in BOTH of those paths the
 *     owning event is `ctx.db.delete(args.eventId)`-ed in the same mutation
 *     and the article is patched with `eventId: undefined`. So the article
 *     belongs to no event — live, published, or otherwise.
 *  2. We still assert `eventId === undefined` and `status === "archived"` per
 *     row, so an article that got requeued into the pipeline (which clears
 *     `archivedAt`/`archivedReason` and sets status back to `enriched`) can
 *     never be picked up mid-flight.
 *  3. Nothing renders archived articles: enrichment and clustering filter them
 *     out by status (enrichment.ts shouldEnrich/shouldReembed, clustering's
 *     `by_status_published` queries only take `enriched`/`clustered`), and the
 *     only reader of the archived class is an admin count query
 *     (pipeline.getArchivedArticleStats).
 *  4. `clusterPairLabels` is the one table that can reference an article
 *     outside an event (a hand-labeled clustering gold set). We load it and
 *     refuse to delete anything it references. If that table is ever larger
 *     than the guard limit we bail out entirely rather than risk it.
 */
export const purgeArchivedDetachedArticles = internalMutation({
  args: {
    retentionDays: v.optional(v.number()),
    batchSize: v.optional(v.number()),
    // Set only when this mutation reschedules itself; see the watermark note in
    // the handler. Positionally aligned with ARCHIVED_REASONS.
    cursors: v.optional(v.array(v.number())),
  },
  handler: async (ctx, args) => {
    const configured = await getConfig<number>(
      ctx,
      STORAGE_RETENTION_CONFIG_KEYS.archivedArticleDays,
      STORAGE_RETENTION_DEFAULTS.archivedArticleDays,
    );
    const retentionDays = clampRetentionDays(
      args.retentionDays ?? configured,
      STORAGE_RETENTION_DEFAULTS.archivedArticleDays,
      14,
    );
    const batchSize = clampBatch(args.batchSize, PURGE_BATCH);
    const cutoff = Date.now() - retentionDays * DAY_MS;

    // Guard 4: never delete an article that the clustering gold set cites.
    const labels = await ctx.db
      .query("clusterPairLabels")
      .take(CLUSTER_LABEL_GUARD_LIMIT);
    if (labels.length >= CLUSTER_LABEL_GUARD_LIMIT) {
      // Can't prove the guard set is complete — do nothing rather than guess.
      await logPurgeRun(ctx, "articles_archived_detached", 0, true, {
        metadata: { skippedReason: "cluster_label_guard_overflow" },
      });
      return { deleted: 0, done: true, skippedReason: "guard_overflow" };
    }
    const labeledArticleIds = new Set<string>();
    for (const label of labels) {
      labeledArticleIds.add(label.leftArticleId);
      labeledArticleIds.add(label.rightArticleId);
    }

    // One `archivedAt` watermark per entry in ARCHIVED_REASONS, same order.
    //
    // Deleting a row removes it from the index, so the head advances by itself
    // whenever a batch deletes something. The hazard is a batch that deletes
    // NOTHING: rows held back by the guards below (requeued articles, or
    // articles cited by the clusterPairLabels gold set) stay at the head and get
    // re-read on every run. Once enough of them accumulate to fill a batch the
    // purge reports `deleted === 0`, concludes it is done, and can never reach
    // the rows behind them. Advancing the watermark past a stuck batch is what
    // guarantees forward progress.
    const cursors = ARCHIVED_REASONS.map((_, index) => args.cursors?.[index] ?? 0);

    let deleted = 0;
    let deletedEmbeddings = 0;
    let scanned = 0;
    let protectedByLabel = 0;
    let anyCandidates = false;

    for (const [index, reason] of ARCHIVED_REASONS.entries()) {
      if (deleted >= batchSize) break;
      const from = cursors[index] ?? 0;
      const candidates = await ctx.db
        .query("articles")
        .withIndex("by_archived_reason", (q) =>
          q
            .eq("archivedReason", reason)
            .gte("archivedAt", from)
            .lt("archivedAt", cutoff),
        )
        .take(batchSize - deleted);
      scanned += candidates.length;
      if (candidates.length > 0) anyCandidates = true;
      const deletedBefore = deleted;

      for (const article of candidates) {
        // Guards 1-2, re-asserted on the row itself.
        if (article.status !== "archived") continue;
        if (article.eventId !== undefined) continue;
        if (labeledArticleIds.has(article._id)) {
          protectedByLabel++;
          continue;
        }

        const embeddings = await ctx.db
          .query("articleEmbeddings")
          .withIndex("by_article", (q) => q.eq("articleId", article._id))
          .collect();
        for (const row of embeddings) {
          await ctx.db.delete(row._id);
          deletedEmbeddings++;
        }
        await ctx.db.delete(article._id);
        deleted++;
      }

      // Only step over a batch that made no progress. Skipping is safe here
      // precisely because these rows are permanently protected — and confining
      // the +1ms step to the stuck case keeps it from stepping over rows that
      // merely share a millisecond with the last deleted row.
      if (deleted === deletedBefore && candidates.length > 0) {
        const last = candidates[candidates.length - 1]!;
        cursors[index] = (last.archivedAt ?? from) + 1;
      }
    }

    // Finished only when no reason had anything left in range — not merely when
    // this particular batch deleted nothing.
    const done = !anyCandidates;
    await logPurgeRun(ctx, "articles_archived_detached", deleted, done, {
      counters: { scanned, deletedEmbeddings, protectedByLabel },
      metadata: { retentionDays, cutoff, cursors: JSON.stringify(cursors) },
    });

    if (!done) {
      await ctx.scheduler.runAfter(
        0,
        internal.retention.purgeArchivedDetachedArticles,
        { retentionDays, batchSize, cursors },
      );
    }
    return { deleted, deletedEmbeddings, scanned, done };
  },
});
