/**
 * Bookkeeping for summary batches (Gemini Batch API). The provider calls live
 * in summaryBatchNode.ts; these run in the default runtime.
 */
import { v } from "convex/values";

import type { Id } from "./_generated/dataModel";
import { internalMutation, internalQuery } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";

/**
 * Make jobs due now so the next summarization run picks them up on the live
 * path. Only touches jobs still waiting (queued/failed): a job that succeeded,
 * was skipped, or is processing elsewhere is left alone.
 */
async function makeJobsDue(
  ctx: MutationCtx,
  jobIds: Id<"eventSummaryJobs">[],
  reason: string,
): Promise<number> {
  const now = Date.now();
  let released = 0;
  for (const jobId of jobIds) {
    const job = await ctx.db.get(jobId);
    if (!job || (job.status !== "queued" && job.status !== "failed")) continue;
    await ctx.db.patch(jobId, {
      nextAttemptAt: now,
      lastError: reason.slice(0, 1000),
      updatedAt: now,
    });
    released++;
  }
  return released;
}

export const recordSubmittedSummaryBatch = internalMutation({
  args: {
    provider: v.string(),
    batchId: v.string(),
    model: v.string(),
    jobs: v.array(
      v.object({
        jobId: v.id("eventSummaryJobs"),
        eventId: v.id("events"),
        summarySignature: v.string(),
      }),
    ),
    maxWaitMs: v.number(),
  },
  handler: async (ctx, { provider, batchId, model, jobs, maxWaitMs }) => {
    const now = Date.now();
    const deadlineAt = now + maxWaitMs;
    const batchRowId = await ctx.db.insert("summaryBatches", {
      provider,
      batchId,
      model,
      status: "pending",
      jobs,
      submittedAt: now,
      deadlineAt,
    });
    // Hold the jobs out of the live queue until the batch resolves. The
    // deadline doubles as the fallback: if collection never happens, the jobs
    // simply come due again and run live.
    for (const { jobId } of jobs) {
      const job = await ctx.db.get(jobId);
      if (!job || (job.status !== "queued" && job.status !== "failed")) continue;
      await ctx.db.patch(jobId, {
        nextAttemptAt: deadlineAt,
        lastError: `batched: ${batchId}`,
        updatedAt: now,
      });
    }
    return { batchRowId };
  },
});

export const listPendingSummaryBatches = internalQuery({
  args: {},
  handler: async (ctx) =>
    ctx.db
      .query("summaryBatches")
      .withIndex("by_status_submittedAt", (q) => q.eq("status", "pending"))
      .take(20),
});

export const markSummaryBatchPolled = internalMutation({
  args: {
    batchRowId: v.id("summaryBatches"),
    rawStatus: v.optional(v.string()),
  },
  handler: async (ctx, { batchRowId, rawStatus }) => {
    await ctx.db.patch(batchRowId, { lastPolledAt: Date.now(), rawStatus });
  },
});

export const finishSummaryBatch = internalMutation({
  args: {
    batchRowId: v.id("summaryBatches"),
    status: v.union(v.literal("collected"), v.literal("failed")),
    rawStatus: v.optional(v.string()),
    error: v.optional(v.string()),
    succeededCount: v.number(),
    // Jobs with no usable batch result: made due for the live path.
    releaseJobIds: v.array(v.id("eventSummaryJobs")),
  },
  handler: async (
    ctx,
    { batchRowId, status, rawStatus, error, succeededCount, releaseJobIds },
  ) => {
    const released = await makeJobsDue(
      ctx,
      releaseJobIds,
      `batch_${status === "failed" ? "failed" : "item_failed"}${error ? `: ${error}` : ""}`,
    );
    await ctx.db.patch(batchRowId, {
      status,
      rawStatus,
      error: error?.slice(0, 1000),
      succeededCount,
      failedCount: releaseJobIds.length,
      lastPolledAt: Date.now(),
    });
    return { released };
  },
});
