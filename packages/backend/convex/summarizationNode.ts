"use node";

import { createHash, randomUUID } from "node:crypto";
import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import type { ActionCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import { shutdownPostHog } from "./lib/openai";
import { callLLM, isRateLimitError } from "./lib/aiCall";
import { fetchArticleBodyText } from "./lib/articleExtraction";
import {
  buildEventSummaryPrompt,
  buildGroundingVerificationPrompt,
  GLOBAL_IMPACT_FALLBACK,
  SUMMARY_PROMPT_VERSION,
  type EventSummaryOutput,
} from "./prompts";

import { DEFAULT_CHAT_MODEL, DEFAULT_EMBEDDING_MODEL } from "./lib/modelRouting";
import {
  checkSummaryOverlap,
  MAX_VERBATIM_NGRAM,
  type OverlapCheckResult,
} from "./lib/verbatimOverlap";
import {
  collectSummarySentences,
  cosineSimilarity,
  DEFAULT_ACCUSATION_LEXICON,
  findRiskySentences,
  type SentenceGroundingResult,
  type SummaryFieldName,
} from "./lib/grounding";
import { extractionAllowed, normalizeDomain } from "./lib/tdmPolicy";
import { ensureDomainPermissions } from "./domainPermissionsNode";

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
// Trimmed 12 -> 8 to shrink data egress: every extra article means another
// full body fetched (downloaded) and another chunk sent out in the LLM prompt
// (and re-embedded/re-checked by the L4 grounding gate). 8 sources still gives
// broad multi-perspective coverage. Overridable via config.
const DEFAULT_MAX_INPUT_ARTICLES = 8;
const DEFAULT_BODY_FETCH_ENABLED = true;
const DEFAULT_BODY_CHARS = 2600;
// Total prompt budget for transient bodies across all articles; the
// per-article cap scales down as more articles are selected. Trimmed
// 24000 -> 18000 to reduce prompt egress (and token cost) per summary call.
const TOTAL_BODY_CHARS_BUDGET = 18000;
const MIN_BODY_CHARS_PER_ARTICLE = 1200;
const DEFAULT_BODY_FETCH_CONCURRENCY = 8;
// Hard deadline for the whole body-fetch fan-out. Each fetch attempt is
// individually 8s-capped, but a slow publisher can still chain resolve +
// several header-profile attempts per article; past this budget the job
// proceeds with whatever bodies have already landed. Kept tight (and paired
// with higher concurrency) because this fan-out runs inside a Node action and
// its entire wall-clock is billed as action compute — including every second
// spent blocked on slow publisher servers. A 60s hold per job was the single
// largest action-compute drain; 12s + more parallelism lands most bodies for a
// fraction of the held time. Both are overridable via config.
const DEFAULT_BODY_FETCH_TIMEOUT_MS = 12_000;
const JOB_LEASE_TTL_MS = 10 * 60 * 1000;
// How long a rate-limited (429) job waits before it is eligible again. Free-tier
// quota windows are per-minute *and* per-day, so retrying in seconds just burns
// billed action time on another 429; wait out the window instead.
const RATE_LIMIT_DEFER_MS = 45 * 60 * 1000;
// Ceiling on how long a job may keep deferring on rate limits before it is
// allowed to fail normally. Deferral refunds the attempt, so without this a
// permanently rate-limited job retries forever and never shows up in any
// failure metric. ~24h is well past any daily quota reset: still rate limited
// after a full day means the quota is genuinely too small, which is exactly the
// thing an operator needs told.
const RATE_LIMIT_DEFER_CEILING_MS = 24 * 60 * 60 * 1000;
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
  bodyFetchConcurrency: number;
  bodyFetchTimeoutMs: number;
  // L3 — verbatim-overlap gate threshold (shared contiguous words).
  maxVerbatimNgram: number;
  // L4 — grounding + NER risk gate.
  groundingEnabled: boolean;
  groundingModel: string;
  groundingEmbeddingThreshold: number;
  maxUnsupportedRatio: number;
  accusationLexicon: string[];
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

// v7: a perspective side is intentionally empty when its coverage does not
// diverge from neutral (or in CASE D). Preserve that empty value — never
// substitute filler — so the UI hides the tab instead of showing repetitive
// "no distinct perspective" boilerplate. Same cleaning as cleanSummaryField
// but empty in → empty out.
function cleanOptionalField(value: unknown): string {
  if (typeof value !== "string") return "";
  return value
    .replace(/\s+/g, " ")
    .replace(/^\s*CAZUL\s+[A-D]\s*[:—-]\s*/i, "")
    .trim()
    .slice(0, 1200);
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
  // Missing/invalid flag defaults to true (legacy behavior). When the model
  // declares CASE D, the side fields are force-cleared even if it wrote
  // something into them. v7: an empty side under perspectiveApplicable=true is
  // also intentional (no divergence from neutral) and is preserved as empty.
  const perspectiveApplicable = record.perspectiveApplicable !== false;

  return {
    neutral: cleanSummaryField(record.neutral, neutralFallback),
    reformist: perspectiveApplicable
      ? cleanOptionalField(record.reformist)
      : "",
    suveranist: perspectiveApplicable
      ? cleanOptionalField(record.suveranist)
      : "",
    globalImpact: cleanSummaryField(record.globalImpact, GLOBAL_IMPACT_FALLBACK),
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
  return isRateLimitError(error);
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
      // COST: callLLM's default retry loop sleeps in-process between attempts,
      // and Convex bills that sleep as action compute. A 429 here is not a
      // transient blip we can wait out inside the job — the free-tier quota is
      // gone for minutes to hours. Let it bubble out on the first attempt so
      // processSummaryJob can defer the job (backpressure) instead of paying
      // to sit in a sleep. Other callLLM callers keep the default maxRetries.
      maxRetries: 1,
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
      "event_summary_body_fetch_concurrency",
      "event_summary_body_fetch_timeout_ms",
      "event_summary_max_verbatim_ngram",
      "event_grounding_enabled",
      "event_grounding_model",
      "event_grounding_embedding_threshold",
      "event_grounding_max_unsupported_ratio",
      "accusation_lexicon",
    ],
  })) as Record<string, unknown>;

  let accusationLexicon = DEFAULT_ACCUSATION_LEXICON;
  if (typeof cfg.accusation_lexicon === "string") {
    try {
      const parsed = JSON.parse(cfg.accusation_lexicon) as unknown;
      if (
        Array.isArray(parsed) &&
        parsed.every((term) => typeof term === "string")
      ) {
        accusationLexicon = parsed;
      }
    } catch {
      // Keep the built-in lexicon on malformed config.
    }
  } else if (
    Array.isArray(cfg.accusation_lexicon) &&
    (cfg.accusation_lexicon as unknown[]).every(
      (term) => typeof term === "string",
    )
  ) {
    accusationLexicon = cfg.accusation_lexicon as string[];
  }

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
      // Hard-capped at 15 so the per-article floor (MIN_BODY_CHARS_PER_ARTICLE)
      // can never push total transient body text past TOTAL_BODY_CHARS_BUDGET
      // (15 * 1200 = 18000).
      15,
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
    bodyFetchConcurrency: safeInteger(
      cfg.event_summary_body_fetch_concurrency,
      DEFAULT_BODY_FETCH_CONCURRENCY,
      1,
      16,
    ),
    bodyFetchTimeoutMs: safeInteger(
      cfg.event_summary_body_fetch_timeout_ms,
      DEFAULT_BODY_FETCH_TIMEOUT_MS,
      2_000,
      60_000,
    ),
    maxVerbatimNgram: safeInteger(
      cfg.event_summary_max_verbatim_ngram,
      MAX_VERBATIM_NGRAM,
      4,
      20,
    ),
    groundingEnabled: safeBoolean(cfg.event_grounding_enabled, true),
    groundingModel: safeString(
      cfg.event_grounding_model,
      DEFAULT_FALLBACK_MODEL,
    ),
    groundingEmbeddingThreshold: safeNumber(
      cfg.event_grounding_embedding_threshold,
      0.5,
      0,
      1,
    ),
    maxUnsupportedRatio: safeNumber(
      cfg.event_grounding_max_unsupported_ratio,
      0.34,
      0,
      1,
    ),
    accusationLexicon,
  };
}

function safeNumber(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

/**
 * Fetch article bodies transiently for one summary prompt. Bodies are used
 * in memory and dropped — never persisted (copyright constraint; see
 * fetchArticleBodyText). Any article whose fetch fails or comes back blocked
 * simply contributes its stored summary/rssSnippet, as before.
 *
 * L5: gated on the per-domain TDM permission state — the summarizer refuses
 * full-text input from any domain that is not `full`.
 */
async function fetchTransientArticleBodies(
  ctx: ActionCtx,
  articles: SummaryInputArticle[],
  settings: SummarySettings,
): Promise<{
  bodies: Map<string, string>;
  permissionStates: Map<string, string>;
}> {
  const bodies = new Map<string, string>();
  if (!settings.bodyFetchEnabled || articles.length === 0) {
    return { bodies, permissionStates: new Map() };
  }

  // L5 — resolve permission state per source domain and log it for the run.
  const permissionStates = await ensureDomainPermissions(
    ctx,
    articles.map((article) => article.canonicalUrl),
  );
  console.log(
    `[summarization] Domain permission states for this run: ${Array.from(
      permissionStates.entries(),
    )
      .map(([domain, state]) => `${domain}=${state}`)
      .join(", ")}`,
  );
  const allowedArticles = articles.filter((article) =>
    extractionAllowed(
      permissionStates.get(normalizeDomain(article.canonicalUrl)) ??
        "rss_only",
    ),
  );
  if (allowedArticles.length < articles.length) {
    console.log(
      `[summarization] L5 gate: ${articles.length - allowedArticles.length}/${articles.length} article(s) restricted to RSS metadata (no full-text input)`,
    );
  }
  articles = allowedArticles;
  if (articles.length === 0) return { bodies, permissionStates };

  const perArticleCap = Math.max(
    MIN_BODY_CHARS_PER_ARTICLE,
    Math.min(
      settings.bodyChars,
      Math.floor(TOTAL_BODY_CHARS_BUDGET / articles.length),
    ),
  );

  const deadlineAt = Date.now() + settings.bodyFetchTimeoutMs;
  let nextIndex = 0;
  const workers = Array.from(
    { length: Math.min(settings.bodyFetchConcurrency, articles.length) },
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
        settings.bodyFetchTimeoutMs,
      );
    }),
  ]);
  clearTimeout(deadlineTimer);

  console.log(
    `[summarization] Transient bodies fetched for ${bodies.size}/${articles.length} article(s)${
      timedOut ? " (fan-out deadline hit — proceeding with partial bodies)" : ""
    }`,
  );
  return { bodies, permissionStates };
}

type GroundingOutcome =
  | { action: "publish"; fields: SummaryFields; grounding: GroundingRecord }
  | { action: "blocked"; grounding: GroundingRecord };

type SummaryFields = Record<SummaryFieldName, string>;

type GroundingRecord = {
  model: string;
  passed: boolean;
  results: Array<{
    field: string;
    sentence: string;
    supported: boolean;
    supportingArticleIds: Id<"articles">[];
  }>;
  strippedSentences: Array<{ field: string; sentence: string }>;
};

const GROUNDING_JSON_SCHEMA = {
  name: "GroundingVerification",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      results: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            index: { type: "number" },
            supported: { type: "boolean" },
            articleIndexes: { type: "array", items: { type: "number" } },
          },
          required: ["index", "supported", "articleIndexes"],
        },
      },
    },
    required: ["results"],
  },
} as const;

/**
 * L4 — verify every summary sentence against the event's source texts.
 * First pass: embedding cosine similarity shortlists candidate articles per
 * sentence. Decisive pass: one LLM entailment call marks each sentence
 * supported/unsupported with its supporting article indexes. Unsupported
 * sentences are stripped; too many failures (or an empty neutral) block the
 * summary entirely.
 */
async function verifySummaryGrounding(
  ctx: ActionCtx,
  settings: SummarySettings,
  eventId: Id<"events">,
  articles: SummaryInputArticle[],
  transientBodies: Map<string, string>,
  fields: SummaryFields,
): Promise<GroundingOutcome> {
  const sentences = collectSummarySentences(fields);
  const emptyRecord: GroundingRecord = {
    model: settings.groundingModel,
    passed: true,
    results: [],
    strippedSentences: [],
  };
  if (sentences.length === 0) {
    return { action: "publish", fields, grounding: emptyRecord };
  }

  const excerpts = articles.map((article) =>
    [
      article.summary ?? "",
      article.rssSnippet ?? "",
      article.atomicFacts.join(" "),
      (transientBodies.get(article._id) ?? "").slice(0, 1600),
    ]
      .filter(Boolean)
      .join(" "),
  );

  // First pass — embedding similarity (advisory: shortlists supporting
  // articles and feeds the fallback attribution; the LLM pass is decisive).
  let candidateIndexes: number[][] = sentences.map(() =>
    articles.map((_, index) => index),
  );
  try {
    const embeddingResponse = await callLLM<number[][]>({
      kind: "embedding",
      model: DEFAULT_EMBEDDING_MODEL,
      dimensions: 512,
      input: [
        ...sentences.map(({ sentence }) => sentence),
        ...articles.map(
          (article, index) =>
            `${article.title} ${excerpts[index] ?? ""}`.slice(0, 2000),
        ),
      ],
      context: { callType: "event_summary", eventId },
      runtime: ctx,
      // Advisory pass — on failure we fall through to full-candidate
      // entailment, so an in-process retry sleep buys nothing but billed time.
      maxRetries: 1,
    });
    const vectors = embeddingResponse.result;
    if (vectors && vectors.length === sentences.length + articles.length) {
      const sentenceVectors = vectors.slice(0, sentences.length);
      const articleVectors = vectors.slice(sentences.length);
      candidateIndexes = sentenceVectors.map((sentenceVector) => {
        const scored = articleVectors
          .map((articleVector, index) => ({
            index,
            score: cosineSimilarity(sentenceVector, articleVector),
          }))
          .sort((a, b) => b.score - a.score);
        const aboveThreshold = scored.filter(
          (entry) => entry.score >= settings.groundingEmbeddingThreshold,
        );
        return (aboveThreshold.length > 0 ? aboveThreshold : scored)
          .slice(0, 3)
          .map((entry) => entry.index);
      });
    }
  } catch (error) {
    console.warn(
      `[grounding] Embedding first pass failed for event ${eventId} — falling back to full-candidate entailment: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  // Decisive pass — LLM entailment over all sentences in one call.
  const prompt = buildGroundingVerificationPrompt({
    sentences: sentences.map(({ index, sentence }) => ({ index, sentence })),
    articles: articles.map((article, index) => ({
      index,
      sourceName: article.source?.name ?? "Sursă necunoscută",
      title: article.title,
      excerpt: excerpts[index] ?? "",
    })),
  });
  const entailment = await callLLM<unknown>({
    kind: "chat",
    model: settings.groundingModel,
    temperature: 0,
    maxTokens: 2000,
    responseFormat: {
      type: "json_schema",
      json_schema: GROUNDING_JSON_SCHEMA,
    },
    messages: [
      { role: "system", content: prompt.system },
      { role: "user", content: prompt.user },
    ],
    context: { callType: "event_summary", eventId },
    runtime: ctx,
    // Same reasoning as the summary call: a 429 should defer the job, not be
    // slept through on Convex's billed clock.
    maxRetries: 1,
  });
  if (!entailment.result) {
    throw new Error(
      entailment.error ?? "Grounding entailment returned no result",
    );
  }
  let parsed: {
    results: Array<{
      index: number;
      supported: boolean;
      articleIndexes: number[];
    }>;
  };
  try {
    parsed =
      typeof entailment.result === "string"
        ? JSON.parse(entailment.result)
        : (entailment.result as typeof parsed);
  } catch (error) {
    throw new Error(
      `Grounding entailment returned invalid JSON: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  const byIndex = new Map(
    (parsed.results ?? []).map((entry) => [entry.index, entry]),
  );

  const results: SentenceGroundingResult[] = sentences.map(
    ({ field, index, sentence }) => {
      const verdict = byIndex.get(index);
      // A sentence the verifier did not return is treated as unsupported —
      // fail closed, per the Munich ruling's allocation of liability.
      const supported = verdict?.supported === true;
      const indexes =
        verdict && verdict.articleIndexes.length > 0
          ? verdict.articleIndexes
          : (candidateIndexes[index] ?? []);
      return {
        field,
        sentence,
        supported,
        supportingArticleIds: supported
          ? indexes
              .filter((i) => i >= 0 && i < articles.length)
              .map((i) => articles[i]!._id)
          : [],
      };
    },
  );

  const unsupported = results.filter((entry) => !entry.supported);
  const grounding: GroundingRecord = {
    model: settings.groundingModel,
    passed: true,
    results: results
      .filter((entry) => entry.supported)
      .map((entry) => ({
        field: entry.field,
        sentence: entry.sentence,
        supported: true,
        supportingArticleIds: entry.supportingArticleIds as Id<"articles">[],
      })),
    strippedSentences: unsupported.map((entry) => ({
      field: entry.field,
      sentence: entry.sentence,
    })),
  };

  if (unsupported.length / results.length > settings.maxUnsupportedRatio) {
    return { action: "blocked", grounding: { ...grounding, passed: false } };
  }

  if (unsupported.length === 0) {
    return { action: "publish", fields, grounding };
  }

  // Strip unsupported sentences; keep field text = supported sentences only.
  const strippedFields: SummaryFields = { ...fields };
  for (const fieldName of [
    "neutral",
    "reformist",
    "suveranist",
    "globalImpact",
  ] as const) {
    const fieldSentences = results.filter(
      (entry) => entry.field === fieldName,
    );
    if (fieldSentences.length === 0) continue;
    strippedFields[fieldName] = fieldSentences
      .filter((entry) => entry.supported)
      .map((entry) => entry.sentence)
      .join(" ");
  }
  if (!strippedFields.neutral.trim()) {
    // The factual core itself is unsupported — nothing publishable remains.
    return { action: "blocked", grounding: { ...grounding, passed: false } };
  }
  return { action: "publish", fields: strippedFields, grounding };
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
    // COST: every runQuery is a billed round trip that extends this action's
    // wall clock. These three are side-effect-free reads whose results are all
    // needed before any work starts, so they run concurrently — one round trip
    // of latency instead of three. Short-circuit precedence below is unchanged
    // (paused > budget > lease).
    const [paused, settings, budget] = await Promise.all([
      ctx.runQuery(internal.config.isPipelinePaused, {}),
      loadSummarySettings(ctx, {}),
      ctx.runQuery(internal.aiBudget.checkBudget, {}),
    ]);

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

    const runId = randomUUID();
    let budgetExhausted = false;

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

      const { bodies: transientBodies, permissionStates } =
        await fetchTransientArticleBodies(ctx, input.articles, settings);
      const bodyFetchedAt = Date.now();

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

      // L4 — grounding verification (embedding first pass + LLM entailment).
      let finalFields: SummaryFields = overlapFieldsOf(summary);
      let groundingRecord: GroundingRecord | undefined;
      if (settings.groundingEnabled) {
        const outcome = await verifySummaryGrounding(
          ctx,
          settings,
          input.event._id,
          input.articles,
          transientBodies,
          finalFields,
        );
        if (outcome.action === "blocked") {
          console.error(
            `[summarization] Summary blocked_ungrounded for event ${job.eventId}: ${outcome.grounding.strippedSentences.length} unsupported sentence(s)`,
          );
          await ctx.runMutation(internal.summarization.recordSummaryGrounding, {
            eventId: input.event._id,
            jobId: job._id,
            grounding: outcome.grounding,
          });
          await ctx.runMutation(internal.summarization.markSummaryJobFailed, {
            jobId: job._id,
            runId,
            error: "blocked_ungrounded",
            retryAfterMs: Number.MAX_SAFE_INTEGER,
            maxAttempts: 0,
          });
          return {
            processed: true,
            succeeded: false,
            failed: true,
            skipped: false,
            budgetExhausted,
          };
        }
        finalFields = outcome.fields;
        groundingRecord = outcome.grounding;
        if (outcome.grounding.strippedSentences.length > 0) {
          console.warn(
            `[summarization] Stripped ${outcome.grounding.strippedSentences.length} unsupported sentence(s) for event ${job.eventId}`,
          );
        }
      }

      // L4 — NER risk gate: named person/org + accusation term → hold for
      // human review, never auto-publish.
      const riskFlags = findRiskySentences(
        finalFields,
        settings.accusationLexicon,
      );
      if (riskFlags.length > 0) {
        console.warn(
          `[summarization] Summary held for review (event ${job.eventId}): ${riskFlags
            .map((flag) => `${flag.entity}+"${flag.term}"`)
            .join("; ")}`,
        );
        await ctx.runMutation(internal.summarization.holdSummaryForReview, {
          jobId: job._id,
          eventId: input.event._id,
          runId,
          proposed: {
            neutral: finalFields.neutral,
            reformist: finalFields.reformist,
            suveranist: finalFields.suveranist,
            globalImpact: finalFields.globalImpact,
            perspectiveApplicable: summary.perspectiveApplicable,
            modelUsed,
            summarySignature,
          },
          flaggedSentences: riskFlags,
          overlapCheckJson: JSON.stringify(overlapCheck),
          groundingJson: groundingRecord
            ? JSON.stringify(groundingRecord)
            : undefined,
        });
        return {
          processed: true,
          succeeded: false,
          failed: false,
          skipped: true,
          budgetExhausted,
        };
      }

      // L7: source provenance for the audit record — content hash of the
      // exact material each article contributed, fetch timestamp, and the
      // TDM permission state at fetch time (L5).
      const auditSources = input.articles.map(
        (article: SummaryInputArticle) => ({
          articleId: article._id as Id<"articles">,
          canonicalUrl: article.canonicalUrl,
          contentHash: createHash("sha256")
            .update(
              [
                article.title,
                article.summary ?? "",
                article.rssSnippet ?? "",
                article.atomicFacts.join("\n"),
                transientBodies.get(article._id) ?? "",
              ].join("\n "),
            )
            .digest("hex"),
          fetchedAt: bodyFetchedAt,
          permissionState:
            permissionStates.get(normalizeDomain(article.canonicalUrl)) ??
            "unknown",
        }),
      );

      const result = await ctx.runMutation(
        internal.summarization.applyEventSummaryResult,
        {
          jobId: job._id,
          eventId: input.event._id,
          runId,
          neutral: finalFields.neutral,
          reformist: finalFields.reformist,
          suveranist: finalFields.suveranist,
          globalImpact: finalFields.globalImpact,
          perspectiveApplicable: summary.perspectiveApplicable,
          summarySignature,
          modelUsed,
          overlapCheck,
          grounding: groundingRecord,
          auditSources,
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

      // Backpressure, not failure: a provider 429 means the request never
      // reached the model, so nothing about this event is wrong. Failing it
      // burned one of only `maxAttempts` tries and was the main reason most
      // events never got summarized at all. Defer well past the quota window
      // and refund the attempt this run consumed.
      //
      // Bounded, though: because the deferral refunds the attempt, a job that is
      // rate limited forever would retry forever and never appear in any failure
      // metric — an invisible stall rather than a visible problem. Past the
      // ceiling, stop refunding and let it fail through the normal path so queue
      // health and error-rate alerting can see it.
      const rateLimitedForMs = Date.now() - job.requestedAt;
      if (
        isRateLimitError(error) &&
        rateLimitedForMs < RATE_LIMIT_DEFER_CEILING_MS
      ) {
        console.warn(
          `[summarization] Rate limited on event ${job.eventId} — deferring (attempt refunded): ${message}`,
        );
        await ctx.runMutation(internal.summarization.deferSummaryJob, {
          jobId: job._id,
          runId,
          refundAttempt: true,
          reason: `rate_limited: ${message}`,
          retryAfterMs: RATE_LIMIT_DEFER_MS,
        });
        return {
          processed: true,
          succeeded: false,
          failed: false,
          skipped: true,
          budgetExhausted,
        };
      }

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
