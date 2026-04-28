"use node";

import { randomUUID } from "node:crypto";
import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { getOpenAI, shutdownPostHog } from "./lib/openai";
import { calculateCost } from "./aiBudget";
import {
  buildEventSummaryPrompt,
  type EventSummaryOutput,
} from "./prompts";

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

function stripJsonFences(value: string): string {
  return value
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

function cleanSummaryField(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const cleaned = value.replace(/\s+/g, " ").trim();
  return cleaned.length > 0 ? cleaned.slice(0, 1200) : fallback;
}

function parseSummaryOutput(raw: string, eventTitle: string): EventSummaryOutput {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripJsonFences(raw));
  } catch (error) {
    throw new Error(
      `Model returned invalid JSON: ${error instanceof Error ? error.message : "unknown parse error"}`,
    );
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
      violations.push(`${field} has ${wordCount} words; maximum is ${maxWords}`);
    }
  }
  return violations;
}

function retryDelayMs(attempts: number): number {
  return BASE_RETRY_DELAY_MS * 2 ** Math.max(0, attempts - 1);
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

    const settings = {
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

    const enqueueResult = await ctx.runMutation(
      internal.summarization.enqueueEligibleEventSummaries,
      {
        limit: settings.enqueueLimit,
        minArticles: settings.minArticles,
        minSources: settings.minSources,
      },
    );

    const runId = randomUUID();
    const jobs = await ctx.runMutation(internal.summarization.claimSummaryJobs, {
      limit: settings.batchSize,
      runId,
      leaseExpiresAt: Date.now() + JOB_LEASE_TTL_MS,
      maxAttempts: settings.maxAttempts,
    });

    let processed = 0;
    let succeeded = 0;
    let failed = 0;
    let skipped = 0;
    let budgetExhausted = false;

    try {
      for (const job of jobs) {
        processed++;

        const budget = await ctx.runQuery(internal.aiBudget.checkBudget, {});
        if (!budget.allowed) {
          budgetExhausted = true;
          await ctx.runMutation(internal.summarization.markSummaryJobFailed, {
            jobId: job._id,
            runId,
            error: `AI budget exhausted ($${budget.spentUsd}/$${budget.dailyLimitUsd})`,
            retryAfterMs: 60 * 60 * 1000,
            maxAttempts: settings.maxAttempts,
          });
          failed++;
          continue;
        }

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
          skipped++;
          continue;
        }

        try {
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

          const openai = await getOpenAI();
          let summary: EventSummaryOutput | null = null;
          let inputTokens = 0;
          let outputTokens = 0;
          let retryInstruction: string | null = null;

          for (let attempt = 0; attempt < 2; attempt++) {
            const response = await openai.chat.completions.create({
              model: settings.model,
              temperature: 0.2,
              max_tokens: 900,
              response_format: {
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
            });

            inputTokens += response.usage?.prompt_tokens ?? 0;
            outputTokens += response.usage?.completion_tokens ?? 0;

            const content = response.choices[0]?.message?.content;
            if (!content) {
              throw new Error("Model returned an empty summary response");
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

          const costUsd = calculateCost(settings.model, inputTokens, outputTokens);
          const usage = await ctx.runMutation(internal.aiBudget.logUsage, {
            model: settings.model,
            operation: "summarize_event",
            inputTokens,
            outputTokens,
            costUsd,
            eventId: input.event._id,
          });
          if (!usage.allowed) {
            console.warn(
              `[summarization] Usage log rejected because budget would be exceeded ($${usage.spentUsd}/$${usage.dailyLimitUsd})`,
            );
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
            },
          );

          if (result.applied) {
            succeeded++;
          } else {
            skipped++;
          }
        } catch (error) {
          const message =
            error instanceof Error ? error.message : "Unknown summarization error";
          console.error(
            `[summarization] Failed to summarize event ${job.eventId}: ${message}`,
          );
          await ctx.runMutation(internal.summarization.markSummaryJobFailed, {
            jobId: job._id,
            runId,
            error: message,
            retryAfterMs: retryDelayMs(job.attempts),
            maxAttempts: settings.maxAttempts,
          });
          failed++;
        }
      }
    } finally {
      await shutdownPostHog();
    }

    console.log(
      `[summarization] Done: ${succeeded} succeeded, ${failed} failed, ${skipped} skipped, ${enqueueResult.queued} queued`,
    );

    return {
      enqueued: enqueueResult.queued,
      processed,
      succeeded,
      failed,
      skipped,
      budgetExhausted,
    };
  },
});
