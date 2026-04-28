"use node";

import { createHash, randomUUID } from "node:crypto";
import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import type { ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { shutdownPostHog } from "./lib/openai";
import { callOpenAI } from "./lib/aiCall";
import { buildEventSummaryPrompt, type EventSummaryOutput } from "./prompts";

const DEFAULT_MODEL = "gpt-4o-mini";
const DEFAULT_ENQUEUE_LIMIT = 40;
const DEFAULT_BATCH_SIZE = 4;
const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_MIN_ARTICLES = 3;
const DEFAULT_MIN_SOURCES = 2;
const DEFAULT_MAX_INPUT_ARTICLES = 12;
const JOB_LEASE_TTL_MS = 10 * 60 * 1000;
const BASE_RETRY_DELAY_MS = 5 * 60 * 1000;
const SUMMARY_WORD_LIMITS = {
  center: 110,
  left: 70,
  right: 70,
  globalImpact: 50,
};
const EVENT_SUMMARY_JSON_SCHEMA = {
  name: "EventSummary",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      center: {
        type: "string",
        description:
          "60-110 word factual core, grounded in supplied article material.",
      },
      left: {
        type: "string",
        description:
          "25-70 word left/left-center framing summary or the limited-coverage fallback.",
      },
      right: {
        type: "string",
        description:
          "25-70 word right/right-center framing summary or the limited-coverage fallback.",
      },
      globalImpact: {
        type: "string",
        description:
          "25-50 word concrete downstream impact, or the exact fallback when unsupported.",
      },
    },
    required: ["center", "left", "right", "globalImpact"],
  },
} as const;

function safeInteger(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(parsed)));
}

function safeString(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : fallback;
}

function cleanSummaryField(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const cleaned = value.replace(/\s+/g, " ").trim();
  return cleaned.length > 0 ? cleaned.slice(0, 1200) : fallback;
}

function parseSummaryOutput(
  raw: unknown,
  eventTitle: string,
): EventSummaryOutput {
  let parsed: unknown = raw;
  if (typeof raw === "string") {
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      throw new Error(
        `Model returned invalid JSON: ${error instanceof Error ? error.message : "unknown parse error"}`,
      );
    }
  }

  if (!parsed || typeof parsed !== "object") {
    throw new Error("Model returned a non-object JSON payload");
  }

  const record = parsed as Record<string, unknown>;
  const centerFallback = `Coverage is developing around ${eventTitle}.`;
  const sideFallback =
    "The available coverage does not provide enough distinct framing from this side yet.";

  return {
    center: cleanSummaryField(record.center, centerFallback),
    left: cleanSummaryField(record.left, sideFallback),
    right: cleanSummaryField(record.right, sideFallback),
    globalImpact: cleanSummaryField(
      record.globalImpact,
      "This story may affect public debate as more reporting develops.",
    ),
  };
}

function countWords(value: string): number {
  return value.trim().split(/\s+/).filter(Boolean).length;
}

function validateSummaryWordCaps(summary: EventSummaryOutput): string[] {
  const violations: string[] = [];
  for (const [field, maxWords] of Object.entries(SUMMARY_WORD_LIMITS)) {
    const wordCount = countWords(summary[field as keyof EventSummaryOutput]);
    if (wordCount > maxWords) {
      violations.push(
        `${field} has ${wordCount} words; maximum is ${maxWords}`,
      );
    }
  }
  return violations;
}

function buildSummarySignature(input: {
  event: { _id: string; title: string };
  articles: Array<{
    _id: string;
    canonicalUrl: string;
    publishedAt: number;
    summary?: string;
    rssSnippet?: string;
    atomicFacts: string[];
    source?: { _id: string; baseBias: number; reliabilityScore: number } | null;
  }>;
}): string {
  const payload = {
    eventId: input.event._id,
    title: input.event.title,
    articles: input.articles
      .map((article) => ({
        id: article._id,
        canonicalUrl: article.canonicalUrl,
        publishedAt: article.publishedAt,
        sourceId: article.source?._id ?? null,
        sourceBaseBias: article.source?.baseBias ?? null,
        sourceReliability: article.source?.reliabilityScore ?? null,
        summary: article.summary ?? "",
        rssSnippet: article.rssSnippet ?? "",
        atomicFacts: article.atomicFacts,
      }))
      .sort((a, b) => a.id.localeCompare(b.id)),
  };
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

function retryDelayMs(attempts: number): number {
  return BASE_RETRY_DELAY_MS * 2 ** Math.max(0, attempts - 1);
}

async function loadSummarySettings(
  ctx: ActionCtx,
  args: { enqueueLimit?: number; processLimit?: number },
) {
  const cfg = await ctx.runQuery(internal.config.getBatch, {
    keys: [
      "event_summary_model",
      "event_summary_enqueue_limit",
      "event_summary_batch_size",
      "event_summary_max_attempts",
      "event_summary_min_articles",
      "event_summary_min_sources",
      "event_summary_max_input_articles",
    ],
  });

  return {
    model: safeString(cfg.event_summary_model, DEFAULT_MODEL),
    enqueueLimit: safeInteger(
      args.enqueueLimit ?? cfg.event_summary_enqueue_limit,
      DEFAULT_ENQUEUE_LIMIT,
      1,
      200,
    ),
    batchSize: safeInteger(
      args.processLimit ?? cfg.event_summary_batch_size,
      DEFAULT_BATCH_SIZE,
      1,
      10,
    ),
    maxAttempts: safeInteger(
      cfg.event_summary_max_attempts,
      DEFAULT_MAX_ATTEMPTS,
      1,
      8,
    ),
    minArticles: safeInteger(
      cfg.event_summary_min_articles,
      DEFAULT_MIN_ARTICLES,
      1,
      20,
    ),
    minSources: safeInteger(
      cfg.event_summary_min_sources,
      DEFAULT_MIN_SOURCES,
      1,
      20,
    ),
    maxInputArticles: safeInteger(
      cfg.event_summary_max_input_articles,
      DEFAULT_MAX_INPUT_ARTICLES,
      3,
      20,
    ),
  };
}

export const summarizeQueuedEvents = internalAction({
  args: {
    enqueueLimit: v.optional(v.number()),
    processLimit: v.optional(v.number()),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{
    enqueued: number;
    processed: number;
    succeeded: number;
    failed: number;
    skipped: number;
    budgetExhausted: boolean;
  }> => {
    const paused = await ctx.runQuery(internal.config.isPipelinePaused, {});
    if (paused) {
      console.log("[summarization] Pipeline paused — skipping summaries");
      return {
        enqueued: 0,
        processed: 0,
        succeeded: 0,
        failed: 0,
        skipped: 0,
        budgetExhausted: false,
      };
    }

    const settings = await loadSummarySettings(ctx, args);

    const enqueueResult = await ctx.runMutation(
      internal.summarization.enqueueEligibleEventSummaries,
      {
        limit: settings.enqueueLimit,
        minArticles: settings.minArticles,
        minSources: settings.minSources,
      },
    );

    const dueJobs = await ctx.runQuery(
      internal.summarization.listDueSummaryJobs,
      {
        limit: settings.batchSize,
      },
    );

    for (const job of dueJobs) {
      await ctx.scheduler.runAfter(
        0,
        internal.summarizationNode.processSummaryJob,
        {
          jobId: job._id,
        },
      );
    }

    console.log(
      `[summarization] Scheduled ${dueJobs.length} job(s); ${enqueueResult.queued} queued`,
    );

    return {
      enqueued: enqueueResult.queued,
      processed: dueJobs.length,
      succeeded: 0,
      failed: 0,
      skipped: 0,
      budgetExhausted: false,
    };
  },
});

export const processSummaryJob = internalAction({
  args: {
    jobId: v.id("eventSummaryJobs"),
  },
  handler: async (
    ctx,
    { jobId },
  ): Promise<{
    processed: boolean;
    succeeded: boolean;
    failed: boolean;
    skipped: boolean;
    budgetExhausted: boolean;
  }> => {
    const paused = await ctx.runQuery(internal.config.isPipelinePaused, {});
    if (paused) {
      console.log("[summarization] Pipeline paused — skipping job");
      return {
        processed: false,
        succeeded: false,
        failed: false,
        skipped: true,
        budgetExhausted: false,
      };
    }

    const settings = await loadSummarySettings(ctx, {});
    const runId = randomUUID();
    let budgetExhausted = false;

    const budget = await ctx.runQuery(internal.aiBudget.checkBudget, {});
    if (!budget.allowed) {
      budgetExhausted = true;
      await ctx.runMutation(internal.summarization.deferSummaryJob, {
        jobId,
        reason: `AI budget exhausted ($${budget.spentUsd}/$${budget.dailyLimitUsd})`,
        retryAfterMs: 60 * 60 * 1000,
      });
      return {
        processed: true,
        succeeded: false,
        failed: false,
        skipped: true,
        budgetExhausted,
      };
    }

    const leaseExpiresAt = Date.now() + JOB_LEASE_TTL_MS;
    const started = await ctx.runMutation(
      internal.summarization.startSummaryJob,
      {
        jobId,
        runId,
        leaseExpiresAt,
        maxAttempts: settings.maxAttempts,
      },
    );

    if (!started.started) {
      return {
        processed: false,
        succeeded: false,
        failed: false,
        skipped: true,
        budgetExhausted: false,
      };
    }

    const job = started.job;

    try {
      const input = await ctx.runQuery(
        internal.summarization.getEventSummaryInput,
        {
          eventId: job.eventId,
          minArticles: settings.minArticles,
          minSources: settings.minSources,
          maxArticles: settings.maxInputArticles,
        },
      );

      if (!input.eligible) {
        await ctx.runMutation(internal.summarization.markSummaryJobSkipped, {
          jobId: job._id,
          runId,
          reason: input.reason ?? "event_not_eligible",
        });
        return {
          processed: true,
          succeeded: false,
          failed: false,
          skipped: true,
          budgetExhausted,
        };
      }

      const summarySignature = buildSummarySignature(input);
      if (input.event.lastSummarySignature === summarySignature) {
        await ctx.runMutation(internal.summarization.markSummaryJobSkipped, {
          jobId: job._id,
          runId,
          reason: "no_change_since_last_run",
          eventId: input.event._id,
          summarySignature,
        });
        return {
          processed: true,
          succeeded: false,
          failed: false,
          skipped: true,
          budgetExhausted,
        };
      }

      const prompt = buildEventSummaryPrompt({
        eventTitle: input.event.title,
        articles: input.articles.map((article) => ({
          title: article.title,
          sourceName: article.source?.name ?? "Unknown source",
          sourceBiasLabel: article.source?.biasLabel ?? "unknown",
          sourceReliability: article.source?.reliabilityScore ?? 0,
          publishedAt: new Date(article.publishedAt).toISOString(),
          summary: article.summary,
          rssSnippet: article.rssSnippet,
          atomicFacts: article.atomicFacts,
          canonicalUrl: article.canonicalUrl,
        })),
      });

      let summary: EventSummaryOutput | null = null;
      let inputTokens = 0;
      let outputTokens = 0;
      let retryInstruction: string | null = null;

      for (let attempt = 0; attempt < 2; attempt++) {
        const response = await callOpenAI<unknown>({
          kind: "chat",
          model: settings.model,
          temperature: 0.2,
          maxTokens: 900,
          responseFormat: {
            type: "json_schema",
            json_schema: EVENT_SUMMARY_JSON_SCHEMA,
          },
          messages: [
            { role: "system", content: prompt.system },
            { role: "user", content: prompt.user },
            ...(retryInstruction
              ? [{ role: "user" as const, content: retryInstruction }]
              : []),
          ],
          context: {
            callType: "event_summary",
            eventId: input.event._id,
          },
          runtime: ctx,
        });

        inputTokens += response.usage.inputTokens;
        outputTokens += response.usage.outputTokens;

        const content = response.result;
        if (!content) {
          throw new Error(
            response.error ?? "Model returned an empty summary response",
          );
        }

        const candidate = parseSummaryOutput(content, input.event.title);
        const wordCapViolations = validateSummaryWordCaps(candidate);
        if (wordCapViolations.length === 0) {
          summary = candidate;
          break;
        }

        if (attempt === 1) {
          throw new Error(
            `Model exceeded summary word caps after retry: ${wordCapViolations.join("; ")}`,
          );
        }

        retryInstruction = [
          "Your previous JSON exceeded one or more word limits:",
          ...wordCapViolations.map((violation) => `- ${violation}`),
          "Return the same JSON keys again, but keep every field within its word cap.",
        ].join("\n");
      }

      if (!summary) {
        throw new Error("Model did not produce a usable event summary");
      }

      const result = await ctx.runMutation(
        internal.summarization.applyEventSummaryResult,
        {
          jobId: job._id,
          eventId: input.event._id,
          runId,
          center: summary.center,
          left: summary.left,
          right: summary.right,
          globalImpact: summary.globalImpact,
          summarySignature,
        },
      );

      if (result.applied) {
        console.log(
          `[summarization] Summary applied for event ${job.eventId} (${inputTokens}/${outputTokens} tokens)`,
        );
        return {
          processed: true,
          succeeded: true,
          failed: false,
          skipped: false,
          budgetExhausted,
        };
      }

      return {
        processed: true,
        succeeded: false,
        failed: false,
        skipped: true,
        budgetExhausted,
      };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unknown summarization error";
      console.error(
        `[summarization] Failed to summarize event ${job.eventId}: ${message}`,
      );
      const retryAfterMs = retryDelayMs(job.attempts);
      const failedResult = await ctx.runMutation(
        internal.summarization.markSummaryJobFailed,
        {
          jobId: job._id,
          runId,
          error: message,
          retryAfterMs,
          maxAttempts: settings.maxAttempts,
        },
      );
      if (!failedResult.attemptsExhausted) {
        await ctx.scheduler.runAfter(
          retryAfterMs,
          internal.summarizationNode.processSummaryJob,
          { jobId: job._id },
        );
      }
      return {
        processed: true,
        succeeded: false,
        failed: true,
        skipped: false,
        budgetExhausted,
      };
    } finally {
      try {
        await shutdownPostHog();
      } catch (error) {
        console.error(
          `[summarization] Failed to flush PostHog events: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
  },
});
