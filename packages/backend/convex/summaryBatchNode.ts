"use node";

/**
 * Summary generation through the Gemini Batch API.
 *
 * Live mode (summarizationNode.processSummaryJob) holds a Node action open
 * while the model writes each summary, and Convex bills that wait as action
 * compute. Batch mode splits the main summary call off:
 *
 *   1. submitSummaryBatch — builds the same prompt for every due job and
 *      submits them as one batch. Jobs stay "queued" with nextAttemptAt pushed
 *      to the batch deadline, so the live path leaves them alone.
 *   2. pollSummaryBatches (cron) — checks pending batches. When one completes,
 *      each result is handed to processSummaryJob as `batched`, which skips the
 *      first generation and runs the usual word-cap, overlap and grounding
 *      gates. Failed, expired or overdue items are made due for the live path.
 *
 * Batch requests carry no response_format, so structured output comes from a
 * forced tool call whose input schema is EVENT_SUMMARY_JSON_SCHEMA (Gemini
 * function calling in ANY mode).
 *
 * Gated by config event_summary_batch_enabled (default off).
 */

import {
  experimental_cancelBatch as cancelBatch,
  experimental_getBatchResults as getBatchResults,
  experimental_getBatchStatus as getBatchStatus,
  experimental_startBatch as startBatch,
  jsonSchema,
  tool,
  type Experimental_BatchReference as BatchReference,
  type JSONSchema7,
} from "ai";
import { v } from "convex/values";

import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { internalAction } from "./_generated/server";
import type { ActionCtx } from "./_generated/server";
import { calculateCostWithCachedInput } from "./aiBudget";
import { captureLLMEvent, shutdownPostHog } from "./lib/llmAnalytics";
import { geminiBatchProvider } from "./lib/llmProviders";
import { buildCallSettings } from "./lib/modelRouting";
import {
  EVENT_SUMMARY_JSON_SCHEMA,
  buildSummaryPromptForInput,
  buildSummarySignature,
  loadSummarySettings,
  summaryBatchBlocker,
  summaryMaxTokensFor,
  type SummaryInputArticle,
  type SummarySettings,
} from "./summarizationNode";

type SubmitResult = { submitted: number; reason?: string; batchId?: string };

const SUMMARY_TOOL = "submit_event_summary" as const;

// Gemini Batch API price relative to live calls (Google's published batch
// pricing is 50% of standard). Applied to logged cost so the daily budget
// reflects what batches actually bill.
const BATCH_PRICE_FACTOR = 0.5;

// Same spacing the live path uses between jobs: each collected result still
// makes live grounding calls, which must not burst past the rate limit.
const COLLECT_STAGGER_MS = 8000;

// Mirrors the live path's 429 fallback delay between scheduled jobs.
const LIVE_FALLBACK_STAGGER_MS = 8000;

function summaryTools() {
  return {
    [SUMMARY_TOOL]: tool({
      description:
        "Submit the event summary. Call exactly once with every field filled.",
      inputSchema: jsonSchema(
        EVENT_SUMMARY_JSON_SCHEMA.schema as unknown as JSONSchema7,
      ),
    }),
  };
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function scheduleLive(
  ctx: ActionCtx,
  jobIds: Id<"eventSummaryJobs">[],
): Promise<void> {
  for (const [index, jobId] of jobIds.entries()) {
    await ctx.scheduler.runAfter(
      index * LIVE_FALLBACK_STAGGER_MS,
      internal.summarizationNode.processSummaryJob,
      { jobId },
    );
  }
}

export const submitSummaryBatch = internalAction({
  args: {
    jobs: v.array(
      v.object({
        jobId: v.id("eventSummaryJobs"),
        eventId: v.id("events"),
      }),
    ),
  },
  handler: async (ctx, { jobs }): Promise<SubmitResult> => {
    const [paused, settings, budget]: [
      boolean,
      SummarySettings,
      { allowed: boolean; spentUsd: number; dailyLimitUsd: number },
    ] = await Promise.all([
      ctx.runQuery(internal.config.isPipelinePaused, {}),
      loadSummarySettings(ctx, {}),
      ctx.runQuery(internal.aiBudget.checkBudget, {}),
    ]);
    if (paused) return { submitted: 0, reason: "paused" };
    if (!budget.allowed) {
      console.warn(
        `[summaryBatch] AI budget exhausted ($${budget.spentUsd}/$${budget.dailyLimitUsd}) — not submitting`,
      );
      return { submitted: 0, reason: "budget_exhausted" };
    }
    const blocker = summaryBatchBlocker(settings);
    if (blocker) {
      console.warn(`[summaryBatch] ${blocker} — running jobs live`);
      await scheduleLive(
        ctx,
        jobs.map((job) => job.jobId),
      );
      return { submitted: 0, reason: blocker };
    }

    // Build every prompt first. Jobs that are ineligible or unchanged go to
    // the live path, which already knows how to mark them skipped.
    const inputs = await Promise.all(
      jobs.map((job) =>
        ctx.runQuery(internal.summarization.getEventSummaryInput, {
          eventId: job.eventId,
          minArticles: settings.minArticles,
          minSources: settings.minSources,
          maxArticles: settings.maxInputArticles,
        }),
      ),
    );

    const batchJobs: Array<{
      jobId: Id<"eventSummaryJobs">;
      eventId: Id<"events">;
      summarySignature: string;
    }> = [];
    const liveJobIds: Id<"eventSummaryJobs">[] = [];
    const requests = [];
    const tools = summaryTools();
    const callSettings = buildCallSettings(settings.model, {
      maxTokens: summaryMaxTokensFor(settings.model),
      temperature: 0.2,
      thinkingLevel: settings.thinkingLevel,
    });

    for (const [index, job] of jobs.entries()) {
      const input = inputs[index]!;
      if (!input.eligible) {
        liveJobIds.push(job.jobId);
        continue;
      }
      const summarySignature = buildSummarySignature(input);
      if (input.event.lastSummarySignature === summarySignature) {
        liveJobIds.push(job.jobId);
        continue;
      }
      // Body fetch is off in batch mode (summaryBatchBlocker), so no bodies.
      const prompt = buildSummaryPromptForInput(
        input as { event: { title: string }; articles: SummaryInputArticle[] },
        new Map(),
      );
      requests.push({
        id: job.jobId,
        type: "text" as const,
        model: settings.model,
        system: prompt.system,
        prompt: prompt.user,
        ...callSettings,
        tools,
        toolChoice: { type: "tool" as const, toolName: SUMMARY_TOOL },
      });
      batchJobs.push({ ...job, summarySignature });
    }

    if (liveJobIds.length > 0) await scheduleLive(ctx, liveJobIds);
    if (requests.length === 0) return { submitted: 0, reason: "nothing_to_batch" };

    let batch;
    try {
      batch = await startBatch({
        provider: geminiBatchProvider(),
        requests,
      });
    } catch (error) {
      // A rejected submission (quota, tier without batch access, bad request)
      // must not strand the window's jobs for six hours: run them live now.
      console.error(
        `[summaryBatch] Batch submission failed — running ${batchJobs.length} job(s) live: ${errorText(error)}`,
      );
      await scheduleLive(
        ctx,
        batchJobs.map((job) => job.jobId),
      );
      return { submitted: 0, reason: "submit_failed" };
    }

    await ctx.runMutation(internal.summaryBatches.recordSubmittedSummaryBatch, {
      provider: batch.provider,
      batchId: batch.id,
      model: settings.model,
      jobs: batchJobs,
      maxWaitMs: settings.batchMaxWaitMs,
    });
    console.log(
      `[summaryBatch] Submitted batch ${batch.id} with ${batchJobs.length} job(s)`,
    );
    return { submitted: batchJobs.length, batchId: batch.id };
  },
});

export const pollSummaryBatches = internalAction({
  args: {},
  handler: async (
    ctx,
  ): Promise<{ polled: number; collectedJobs?: number }> => {
    const pending: PendingBatchRow[] = await ctx.runQuery(
      internal.summaryBatches.listPendingSummaryBatches,
      {},
    );
    if (pending.length === 0) return { polled: 0 };

    const provider = geminiBatchProvider();
    let collectedJobs = 0;
    try {
      for (const row of pending) {
        const reference: BatchReference = {
          version: 2,
          id: row.batchId,
          provider: row.provider,
        };
        const allJobIds = row.jobs.map((job) => job.jobId);

        let status;
        try {
          status = await getBatchStatus({ provider, batch: reference });
        } catch (error) {
          console.error(
            `[summaryBatch] Status check failed for ${row.batchId}: ${errorText(error)}`,
          );
          continue;
        }

        if (status.status === "pending") {
          if (Date.now() < row.deadlineAt) {
            await ctx.runMutation(internal.summaryBatches.markSummaryBatchPolled, {
              batchRowId: row._id,
              rawStatus: status.rawStatus,
            });
            continue;
          }
          // Overdue: stop paying for it and let the jobs run live.
          try {
            await cancelBatch({ provider, batch: reference });
          } catch (error) {
            console.warn(
              `[summaryBatch] Cancel failed for overdue ${row.batchId}: ${errorText(error)}`,
            );
          }
          await ctx.runMutation(internal.summaryBatches.finishSummaryBatch, {
            batchRowId: row._id,
            status: "failed",
            rawStatus: status.rawStatus,
            error: "deadline_exceeded",
            succeededCount: 0,
            releaseJobIds: allJobIds,
          });
          continue;
        }

        if (status.status === "failed") {
          await ctx.runMutation(internal.summaryBatches.finishSummaryBatch, {
            batchRowId: row._id,
            status: "failed",
            rawStatus: status.rawStatus,
            error: status.error?.message ?? "batch_failed",
            succeededCount: 0,
            releaseJobIds: allJobIds,
          });
          continue;
        }

        collectedJobs += await collectBatch(ctx, row, reference, provider);
      }
    } finally {
      await shutdownPostHog().catch(() => {});
    }
    return { polled: pending.length, collectedJobs };
  },
});

type PendingBatchRow = {
  _id: Id<"summaryBatches">;
  provider: string;
  deadlineAt: number;
  batchId: string;
  model: string;
  jobs: Array<{
    jobId: Id<"eventSummaryJobs">;
    eventId: Id<"events">;
    summarySignature: string;
  }>;
};

/** Read a completed batch and hand each usable result to processSummaryJob. */
async function collectBatch(
  ctx: ActionCtx,
  row: PendingBatchRow,
  reference: BatchReference,
  provider: ReturnType<typeof geminiBatchProvider>,
): Promise<number> {
  const jobsById = new Map(row.jobs.map((job) => [job.jobId as string, job]));
  const seen = new Set<string>();
  const release: Id<"eventSummaryJobs">[] = [];
  let scheduled = 0;

  try {
    for await (const item of getBatchResults({
      provider,
      batch: reference,
      tools: summaryTools(),
    })) {
      const job = jobsById.get(item.id);
      if (!job || item.type !== "text") continue;
      seen.add(item.id);

      if (item.status !== "succeeded") {
        release.push(job.jobId);
        continue;
      }

      const usage = item.usage;
      const inputTokens = usage.inputTokens ?? 0;
      const outputTokens = usage.outputTokens ?? 0;
      const cachedInputTokens = usage.inputTokenDetails?.cacheReadTokens ?? 0;
      const costUsd =
        calculateCostWithCachedInput(
          row.model,
          inputTokens,
          cachedInputTokens,
          outputTokens,
        ) * BATCH_PRICE_FACTOR;
      await ctx.runMutation(internal.aiBudget.recordUsage, {
        callType: "event_summary",
        model: row.model,
        inputTokens,
        outputTokens,
        cachedInputTokens,
        costUsd,
        eventId: job.eventId,
      });
      captureLLMEvent({
        kind: "generation",
        callType: "event_summary_batch",
        model: row.model,
        provider: "gemini",
        inputTokens,
        outputTokens,
        cachedInputTokens,
        reasoningTokens: usage.outputTokenDetails?.reasoningTokens,
        costUsd,
        latencyMs: 0,
        httpStatus: 200,
        eventId: job.eventId,
      });

      const call = item.content.find(
        (part) => part.type === "tool-call" && part.toolName === SUMMARY_TOOL,
      );
      const output =
        call && "input" in call ? call.input : safeJson(item.text ?? "");
      if (output == null || item.finishReason === "length") {
        release.push(job.jobId);
        continue;
      }

      await ctx.scheduler.runAfter(
        scheduled * COLLECT_STAGGER_MS,
        internal.summarizationNode.processSummaryJob,
        {
          jobId: job.jobId,
          batched: {
            model: row.model,
            summarySignature: job.summarySignature,
            outputJson: JSON.stringify(output),
            inputTokens,
            outputTokens,
          },
        },
      );
      scheduled++;
    }
  } catch (error) {
    // Results could not be read this time. Leave the row pending so the next
    // poll retries; the deadline still bounds how long the jobs wait.
    console.error(
      `[summaryBatch] Reading results of ${row.batchId} failed: ${errorText(error)}`,
    );
    return scheduled;
  }

  // Requests the provider never reported on also go back to the live path.
  for (const job of row.jobs) {
    if (!seen.has(job.jobId)) release.push(job.jobId);
  }

  await ctx.runMutation(internal.summaryBatches.finishSummaryBatch, {
    batchRowId: row._id,
    status: "collected",
    rawStatus: "completed",
    succeededCount: scheduled,
    releaseJobIds: release,
  });
  console.log(
    `[summaryBatch] Collected ${row.batchId}: ${scheduled} scheduled, ${release.length} sent live`,
  );
  return scheduled;
}

function safeJson(text: string): unknown {
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}
