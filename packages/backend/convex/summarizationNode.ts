"use node";

import { createHash, randomUUID } from "node:crypto";
import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import type { ActionCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import { shutdownPostHog } from "./lib/openai";
import { callLLM } from "./lib/aiCall";
import { fetchArticleBodyText } from "./lib/articleExtraction";
import {
  buildEventSummaryPrompt,
  SIDE_COVERAGE_FALLBACK,
  SUMMARY_PROMPT_VERSION,
  type EventSummaryOutput,
} from "./prompts";

import { DEFAULT_CHAT_MODEL } from "./lib/modelRouting";
import {
  checkSummaryOverlap,
  MAX_VERBATIM_NGRAM,
  type OverlapCheckResult,
} from "./lib/verbatimOverlap";

const DEFAULT_MODEL = DEFAULT_CHAT_MODEL;
// Free-tier strategy: the primary model's daily quota (e.g. gemini-3.5-flash,
// 20 req/day free) covers the first events of the day; quota 429s switch the
// job to this model instead of failing it. "none" disables the fallback.
const DEFAULT_FALLBACK_MODEL = "gemini-3.1-flash-lite";
const DEFAULT_ENQUEUE_LIMIT = 40;
const DEFAULT_BATCH_SIZE = 4;
const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_MIN_ARTICLES = 3;
const DEFAULT_MIN_SOURCES = 2;
const DEFAULT_MAX_INPUT_ARTICLES = 12;
const DEFAULT_BODY_FETCH_ENABLED = true;
const DEFAULT_BODY_CHARS = 2600;
// Total prompt budget for transient bodies across all articles; the
// per-article cap scales down as more articles are selected.
const TOTAL_BODY_CHARS_BUDGET = 24000;
const MIN_BODY_CHARS_PER_ARTICLE = 1200;
const BODY_FETCH_CONCURRENCY = 4;
// Hard deadline for the whole body-fetch fan-out. Each fetch attempt is
// individually 8s-capped, but a slow publisher can still chain resolve +
// several header-profile attempts per article; past this budget the job
// proceeds with whatever bodies have already landed.
const BODY_FETCH_TOTAL_TIMEOUT_MS = 60_000;
const JOB_LEASE_TTL_MS = 10 * 60 * 1000;
const BASE_RETRY_DELAY_MS = 5 * 60 * 1000;
const JOB_STAGGER_MS = 8000;
const SUMMARY_WORD_LIMITS = {
  neutral: 120,
  reformist: 100,
  suveranist: 100,
  globalImpact: 100,
};

type SummarySettings = {
  model: string;
  fallbackModel?: string;
  enqueueLimit: number;
  batchSize: number;
  maxAttempts: number;
  minArticles: number;
  minSources: number;
  maxInputArticles: number;
  bodyFetchEnabled: boolean;
  bodyChars: number;
  // L3 — verbatim-overlap gate threshold (shared contiguous words).
  maxVerbatimNgram: number;
};

type SummaryQueueHealthResult = {
  scannedQueuedJobs: number;
  queuedJobs: number;
  queuedUniqueEvents: number;
  duplicateQueuedEvents: number;
  duplicateQueuedJobs: number;
  duplicateRatio: number;
  processingJobs: number;
  failedJobs: number;
  truncated: {
    queued: boolean;
    processing: boolean;
    failed: boolean;
  };
};

type SummaryInputArticle = {
  _id: string;
  title: string;
  source?: {
    name: string;
    biasLabel?: string;
    reliabilityScore: number;
  } | null;
  publishedAt: number;
  summary?: string;
  rssSnippet?: string;
  atomicFacts: string[];
  canonicalUrl: string;
};
const EVENT_SUMMARY_JSON_SCHEMA = {
  name: "EventSummary",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      neutral: {
        type: "string",
        description:
          "Nucleul factual de 60-120 de cuvinte, în limba română, ancorat în articolele furnizate.",
      },
      reformist: {
        type: "string",
        description:
          "Rezumatul cadrării reformiste de 25-100 de cuvinte, în limba română, sau textul de rezervă pentru acoperire limitată.",
      },
      suveranist: {
        type: "string",
        description:
          "Rezumatul cadrării suveraniste de 25-100 de cuvinte, în limba română, sau textul de rezervă pentru acoperire limitată.",
      },
      globalImpact: {
        type: "string",
        description:
          "Impactul concret de 25-100 de cuvinte, în limba română, sau textul de rezervă exact când nu este susținut.",
      },
      perspectiveApplicable: {
        type: "boolean",
        description:
          "false doar în CAZUL D (subiect fără dimensiune reformist-suveranistă); altfel true.",
      },
    },
    required: [
      "neutral",
      "reformist",
      "suveranist",
      "globalImpact",
      "perspectiveApplicable",
    ],
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

function safeBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") return value;
  if (value === "true") return true;
  if (value === "false") return false;
  return fallback;
}

function cleanSummaryField(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const cleaned = value
    .replace(/\s+/g, " ")
    // The prompt's internal case rubric must not leak into user-visible
    // text (observed: "CAZUL B: Sursele reformiste…").
    .replace(/^\s*CAZUL\s+[A-D]\s*[:—-]\s*/i, "")
    .trim();
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
  const neutralFallback = `Acoperirea subiectului „${eventTitle}" este în curs de dezvoltare.`;
  const sideFallback = SIDE_COVERAGE_FALLBACK;
  // Missing/invalid flag defaults to true (legacy behavior). When the model
  // declares CASE D, the side fields are force-cleared even if it wrote
  // something into them.
  const perspectiveApplicable = record.perspectiveApplicable !== false;

  return {
    neutral: cleanSummaryField(record.neutral, neutralFallback),
    reformist: perspectiveApplicable
      ? cleanSummaryField(record.reformist, sideFallback)
      : "",
    suveranist: perspectiveApplicable
      ? cleanSummaryField(record.suveranist, sideFallback)
      : "",
    globalImpact: cleanSummaryField(
      record.globalImpact,
      "Această știre poate influența dezbaterea publică pe măsură ce apar noi relatări.",
    ),
    perspectiveApplicable,
  };
}

function countWords(value: string): number {
  return value.trim().split(/\s+/).filter(Boolean).length;
}

function validateSummaryWordCaps(summary: EventSummaryOutput): string[] {
  const violations: string[] = [];
  for (const [field, maxWords] of Object.entries(SUMMARY_WORD_LIMITS) as Array<
    [keyof typeof SUMMARY_WORD_LIMITS, number]
  >) {
    const wordCount = countWords(summary[field]);
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
    promptVersion: SUMMARY_PROMPT_VERSION,
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

/**
 * Rate/quota rejection from the model API (Gemini free tier surfaces both
 * per-minute and per-day exhaustion as 429 RESOURCE_EXHAUSTED). These are
 * the errors worth retrying on the fallback model rather than failing.
 */
function isQuotaError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /\b429\b|RESOURCE_EXHAUSTED|quota/i.test(message);
}

/**
 * gemini-3.5* are thinking models on the OpenAI-compat endpoint: thinking
 * spends from max_tokens before any JSON is emitted, so they need headroom
 * beyond the ~900 tokens the four Romanian fields actually take.
 */
function summaryMaxTokensFor(model: string): number {
  return model.startsWith("gemini-3.5") ? 3000 : 1200;
}

/**
 * Run the summary model call with the word-cap retry loop. Throws on quota
 * errors, unusable output, or persistent word-cap violations — the caller
 * decides whether a fallback model gets a shot.
 */
async function generateSummaryWithModel(
  ctx: ActionCtx,
  model: string,
  prompt: { system: string; user: string },
  eventId: Id<"events">,
  eventTitle: string,
  // L3: extra paraphrase instruction injected by the overlap retry loop.
  paraphraseInstruction?: string,
): Promise<{
  summary: EventSummaryOutput;
  inputTokens: number;
  outputTokens: number;
}> {
  let inputTokens = 0;
  let outputTokens = 0;
  let retryInstruction: string | null = null;

  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await callLLM<unknown>({
      kind: "chat",
      model,
      temperature: 0.2,
      maxTokens: summaryMaxTokensFor(model),
      responseFormat: {
        type: "json_schema",
        json_schema: EVENT_SUMMARY_JSON_SCHEMA,
      },
      messages: [
        { role: "system", content: prompt.system },
        { role: "user", content: prompt.user },
        ...(paraphraseInstruction
          ? [{ role: "user" as const, content: paraphraseInstruction }]
          : []),
        ...(retryInstruction
          ? [{ role: "user" as const, content: retryInstruction }]
          : []),
      ],
      context: {
        callType: "event_summary",
        eventId,
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

    const candidate = parseSummaryOutput(content, eventTitle);
    const wordCapViolations = validateSummaryWordCaps(candidate);
    if (wordCapViolations.length === 0) {
      return { summary: candidate, inputTokens, outputTokens };
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

  throw new Error("Model did not produce a usable event summary");
}

async function loadSummarySettings(
  ctx: ActionCtx,
  args: { enqueueLimit?: number; processLimit?: number },
): Promise<SummarySettings> {
  const cfg = (await ctx.runQuery(internal.config.getBatch, {
    keys: [
      "event_summary_model",
      "event_summary_model_fallback",
      "event_summary_enqueue_limit",
      "event_summary_batch_size",
      "event_summary_max_attempts",
      "event_summary_min_articles",
      "event_summary_min_sources",
      "event_summary_max_input_articles",
      "event_summary_body_fetch_enabled",
      "event_summary_body_chars",
      "event_summary_max_verbatim_ngram",
    ],
  })) as Record<string, unknown>;

  const fallbackModel = safeString(
    cfg.event_summary_model_fallback,
    DEFAULT_FALLBACK_MODEL,
  );

  return {
    model: safeString(cfg.event_summary_model, DEFAULT_MODEL),
    fallbackModel: fallbackModel === "none" ? undefined : fallbackModel,
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
    bodyFetchEnabled: safeBoolean(
      cfg.event_summary_body_fetch_enabled,
      DEFAULT_BODY_FETCH_ENABLED,
    ),
    bodyChars: safeInteger(
      cfg.event_summary_body_chars,
      DEFAULT_BODY_CHARS,
      500,
      6000,
    ),
    maxVerbatimNgram: safeInteger(
      cfg.event_summary_max_verbatim_ngram,
      MAX_VERBATIM_NGRAM,
      4,
      20,
    ),
  };
}

/**
 * Fetch article bodies transiently for one summary prompt. Bodies are used
 * in memory and dropped — never persisted (copyright constraint; see
 * fetchArticleBodyText). Any article whose fetch fails or comes back blocked
 * simply contributes its stored summary/rssSnippet, as before.
 */
async function fetchTransientArticleBodies(
  articles: SummaryInputArticle[],
  settings: SummarySettings,
): Promise<Map<string, string>> {
  const bodies = new Map<string, string>();
  if (!settings.bodyFetchEnabled || articles.length === 0) return bodies;

  const perArticleCap = Math.max(
    MIN_BODY_CHARS_PER_ARTICLE,
    Math.min(
      settings.bodyChars,
      Math.floor(TOTAL_BODY_CHARS_BUDGET / articles.length),
    ),
  );

  const deadlineAt = Date.now() + BODY_FETCH_TOTAL_TIMEOUT_MS;
  let nextIndex = 0;
  const workers = Array.from(
    { length: Math.min(BODY_FETCH_CONCURRENCY, articles.length) },
    async () => {
      while (nextIndex < articles.length && Date.now() < deadlineAt) {
        const article = articles[nextIndex++]!;
        try {
          const fetched = await fetchArticleBodyText(article.canonicalUrl);
          if (fetched.body) {
            bodies.set(article._id, fetched.body.slice(0, perArticleCap));
          }
        } catch {
          // Fall back to summary/rssSnippet for this article.
        }
      }
    },
  );

  // Workers write into `bodies` as they finish, so on deadline we can stop
  // waiting and use whatever landed; abandoned in-flight fetches resolve into
  // a Map nobody reads again.
  let deadlineTimer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = await Promise.race([
    Promise.all(workers).then(() => false),
    new Promise<boolean>((resolve) => {
      deadlineTimer = setTimeout(
        () => resolve(true),
        BODY_FETCH_TOTAL_TIMEOUT_MS,
      );
    }),
  ]);
  clearTimeout(deadlineTimer);

  console.log(
    `[summarization] Transient bodies fetched for ${bodies.size}/${articles.length} article(s)${
      timedOut ? " (fan-out deadline hit — proceeding with partial bodies)" : ""
    }`,
  );
  return bodies;
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

    // Stagger the jobs instead of firing them all at once: concurrent
    // summary calls burst past Gemini's rate limit (observed 429s), and each
    // job also fans out its own transient body fetches.
    for (const [index, job] of dueJobs.entries()) {
      await ctx.scheduler.runAfter(
        index * JOB_STAGGER_MS,
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

export const alertOnSummaryQueueHealth = internalAction({
  args: {
    limit: v.optional(v.number()),
    maxQueuedJobs: v.optional(v.number()),
    maxDuplicateRatio: v.optional(v.number()),
  },
  handler: async (
    ctx,
    args,
  ): Promise<
    | { skipped: true; reason: string }
    | {
        healthy: boolean;
        reasons: string[];
        health: SummaryQueueHealthResult;
      }
  > => {
    const paused = await ctx.runQuery(internal.config.isPipelinePaused, {});
    if (paused) {
      console.log(
        "[summarization] Pipeline paused — skipping queue health check",
      );
      return { skipped: true as const, reason: "pipeline_paused" };
    }

    const health = (await ctx.runQuery(
      internal.summarization.getSummaryQueueHealthInternal,
      {
        limit: args.limit ?? 1000,
      },
    )) as SummaryQueueHealthResult;
    const maxQueuedJobs = safeInteger(args.maxQueuedJobs, 500, 1, 10_000);
    const maxDuplicateRatio =
      typeof args.maxDuplicateRatio === "number" &&
      Number.isFinite(args.maxDuplicateRatio)
        ? Math.max(1, args.maxDuplicateRatio)
        : 1.2;

    const unhealthyReasons: string[] = [
      health.duplicateQueuedJobs > 0 ? "duplicate_queued_jobs" : null,
      health.duplicateRatio > maxDuplicateRatio ? "high_duplicate_ratio" : null,
      health.queuedJobs > maxQueuedJobs ? "queue_too_deep" : null,
      health.truncated.queued ? "queue_health_truncated" : null,
    ].filter((reason): reason is string => reason !== null);

    if (unhealthyReasons.length > 0) {
      console.error("[summarization] Queue health warning", {
        reasons: unhealthyReasons,
        health,
      });
      return { healthy: false as const, reasons: unhealthyReasons, health };
    }

    console.log("[summarization] Queue health OK", health);
    return { healthy: true as const, reasons: [], health };
  },
});

export const runPhase5Backfill = internalAction({
  args: {
    coverageLimit: v.optional(v.number()),
    summaryEnqueueLimit: v.optional(v.number()),
    summaryScanLimit: v.optional(v.number()),
    summaryProcessLimit: v.optional(v.number()),
    claimProcessLimit: v.optional(v.number()),
    claimScanLimit: v.optional(v.number()),
    summaryCursor: v.optional(v.string()),
    includeExistingCoverage: v.optional(v.boolean()),
    force: v.optional(v.boolean()),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{
    skipped: boolean;
    reason?: string;
    coverage?: unknown;
    summaryBackfill?: {
      queued: number;
      inspected: number;
      skipped: number;
      scanned: number;
      nextCursor?: string;
      done: boolean;
    };
    scheduledSummaryJobs?: number;
    claims?: unknown;
    nextCursor?: string;
    done?: boolean;
  }> => {
    const paused = await ctx.runQuery(internal.config.isPipelinePaused, {});
    if (paused && !args.force) {
      console.log(
        "[summarization] Pipeline paused — skipping Phase 5 backfill",
      );
      return { skipped: true as const, reason: "pipeline_paused" };
    }
    const backfillCfg = await ctx.runQuery(internal.config.getBatch, {
      keys: ["backfill_enabled"],
    });
    if (backfillCfg.backfill_enabled !== true && !args.force) {
      console.log(
        "[summarization] Phase 5 backfill skipped: backfill_enabled is false",
      );
      return { skipped: true as const, reason: "backfill_disabled" };
    }

    const settings: SummarySettings = await loadSummarySettings(ctx, {
      enqueueLimit: args.summaryEnqueueLimit,
      processLimit: args.summaryProcessLimit,
    });

    const coverage: unknown = await ctx.runMutation(
      internal.claimDivergence.backfillEventClaimCoverage,
      {
        limit: safeInteger(args.coverageLimit, 200, 1, 500),
        includeExisting: args.includeExistingCoverage ?? false,
      },
    );

    const summaryBackfill = (await ctx.runMutation(
      internal.summarization.enqueueEligibleEventSummariesBackfill,
      {
        limit: settings.enqueueLimit,
        scanLimit: safeInteger(
          args.summaryScanLimit,
          Math.max(settings.enqueueLimit * 5, 100),
          settings.enqueueLimit,
          1000,
        ),
        minArticles: settings.minArticles,
        minSources: settings.minSources,
        cursor: args.summaryCursor,
      },
    )) as {
      queued: number;
      inspected: number;
      skipped: number;
      scanned: number;
      nextCursor?: string;
      done: boolean;
    };

    const dueJobs = (await ctx.runQuery(
      internal.summarization.listDueSummaryJobs,
      {
        limit: settings.batchSize,
      },
    )) as Array<{ _id: Id<"eventSummaryJobs"> }>;
    // Staggered like summarizeQueuedEvents: bursts 429 against Gemini.
    for (const [index, job] of dueJobs.entries()) {
      await ctx.scheduler.runAfter(
        index * JOB_STAGGER_MS,
        internal.summarizationNode.processSummaryJob,
        {
          jobId: job._id,
        },
      );
    }

    const claims: unknown = await ctx.runAction(
      internal.claimDivergenceNode.processStaleEventClaims,
      {
        processLimit: safeInteger(args.claimProcessLimit, 4, 1, 10),
        scanLimit: safeInteger(args.claimScanLimit, 120, 1, 250),
      },
    );

    return {
      skipped: false as const,
      coverage,
      summaryBackfill,
      scheduledSummaryJobs: dueJobs.length,
      claims,
      nextCursor: summaryBackfill.nextCursor,
      done: summaryBackfill.done,
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

      const transientBodies = await fetchTransientArticleBodies(
        input.articles,
        settings,
      );

      const prompt = buildEventSummaryPrompt({
        eventTitle: input.event.title,
        articles: input.articles.map((article: SummaryInputArticle) => ({
          title: article.title,
          sourceName: article.source?.name ?? "Unknown source",
          sourceBiasLabel: article.source?.biasLabel ?? "unknown",
          sourceReliability: article.source?.reliabilityScore ?? 0,
          publishedAt: new Date(article.publishedAt).toISOString(),
          summary: article.summary,
          rssSnippet: article.rssSnippet,
          atomicFacts: article.atomicFacts,
          bodyText: transientBodies.get(article._id),
          canonicalUrl: article.canonicalUrl,
        })),
      });

      let generated: {
        summary: EventSummaryOutput;
        inputTokens: number;
        outputTokens: number;
      };
      let modelUsed = settings.model;
      try {
        generated = await generateSummaryWithModel(
          ctx,
          settings.model,
          prompt,
          input.event._id,
          input.event.title,
        );
      } catch (error) {
        // Free-tier quota strategy: the primary model's daily quota covers
        // the first events of the day; once it 429s, the job runs on the
        // fallback model instead of failing.
        if (
          !isQuotaError(error) ||
          !settings.fallbackModel ||
          settings.fallbackModel === settings.model
        ) {
          throw error;
        }
        console.warn(
          `[summarization] ${settings.model} quota/rate limited — falling back to ${settings.fallbackModel} for event ${job.eventId}`,
        );
        generated = await generateSummaryWithModel(
          ctx,
          settings.fallbackModel,
          prompt,
          input.event._id,
          input.event.title,
        );
        modelUsed = settings.fallbackModel;
      }

      // L3 — verbatim-overlap gate: the summary must not reproduce ≥N
      // consecutive source words. On failure regenerate with a stronger
      // paraphrase instruction (max 2 retries), else block publication.
      const overlapSourceTexts: Array<string | undefined> = [
        ...input.articles.flatMap((article: SummaryInputArticle) => [
          article.title,
          article.summary,
          article.rssSnippet,
          ...article.atomicFacts,
        ]),
        ...transientBodies.values(),
      ];
      const overlapFieldsOf = (summary: EventSummaryOutput) => ({
        neutral: summary.neutral,
        reformist: summary.reformist,
        suveranist: summary.suveranist,
        globalImpact: summary.globalImpact,
      });

      let overlap = checkSummaryOverlap(
        overlapFieldsOf(generated.summary),
        overlapSourceTexts,
        settings.maxVerbatimNgram,
      );
      let overlapAttempts = 0;
      while (!overlap.passed && overlapAttempts < 2) {
        overlapAttempts++;
        console.warn(
          `[summarization] Verbatim overlap detected for event ${job.eventId} (attempt ${overlapAttempts}): ${overlap.matchedSpans
            .slice(0, 3)
            .map((span) => `"${span.text}"`)
            .join("; ")}`,
        );
        const paraphraseInstruction = [
          "Răspunsul tău anterior a copiat literal fragmente din articolele sursă, ceea ce este interzis:",
          ...overlap.matchedSpans
            .slice(0, 5)
            .map((span) => `- (${span.field}) „${span.text}”`),
          `Rescrie TOATE câmpurile parafrazând integral în propriile tale cuvinte. Nicio secvență de ${settings.maxVerbatimNgram} sau mai multe cuvinte consecutive nu are voie să coincidă cu textul sursă. Schimbă construcția frazelor, nu doar cuvinte izolate. Citatele scurte sunt permise doar între ghilimele, cu numele sursei.`,
        ].join("\n");
        generated = await generateSummaryWithModel(
          ctx,
          modelUsed,
          prompt,
          input.event._id,
          input.event.title,
          paraphraseInstruction,
        );
        overlap = checkSummaryOverlap(
          overlapFieldsOf(generated.summary),
          overlapSourceTexts,
          settings.maxVerbatimNgram,
        );
      }

      const overlapCheck: OverlapCheckResult = {
        passed: overlap.passed,
        maxNgram: settings.maxVerbatimNgram,
        attempts: overlapAttempts,
        matchedSpans: overlap.matchedSpans.slice(0, 20),
      };

      if (!overlap.passed) {
        console.error(
          `[summarization] Summary blocked_verbatim for event ${job.eventId} after ${overlapAttempts} paraphrase retries`,
        );
        await ctx.runMutation(
          internal.summarization.markSummaryJobBlockedVerbatim,
          {
            jobId: job._id,
            runId,
            overlapCheckJson: JSON.stringify(overlapCheck),
          },
        );
        return {
          processed: true,
          succeeded: false,
          failed: true,
          skipped: false,
          budgetExhausted,
        };
      }

      const { summary, inputTokens, outputTokens } = generated;

      const result = await ctx.runMutation(
        internal.summarization.applyEventSummaryResult,
        {
          jobId: job._id,
          eventId: input.event._id,
          runId,
          neutral: summary.neutral,
          reformist: summary.reformist,
          suveranist: summary.suveranist,
          globalImpact: summary.globalImpact,
          perspectiveApplicable: summary.perspectiveApplicable,
          summarySignature,
          modelUsed,
          overlapCheck,
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
      if (failedResult.updated && !failedResult.attemptsExhausted) {
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
