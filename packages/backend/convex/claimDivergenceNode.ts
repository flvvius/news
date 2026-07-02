"use node";

import { createHash } from "node:crypto";
import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import type { ActionCtx } from "./_generated/server";
import { shutdownPostHog } from "./lib/openai";
import { callOpenAI } from "./lib/aiCall";
import {
  buildClaimAnalysisPrompt,
  type ClaimDivergenceStatus,
  type ClaimType,
} from "./prompts";

const DEFAULT_MODEL = "gpt-5-nano";
// Claim analysis is paused for the Romanian launch (BIV-602); flip the
// claim_analysis_enabled config key to re-enable.
const DEFAULT_ENABLED = false;
const DEFAULT_BATCH_SIZE = 4;
const DEFAULT_SCAN_LIMIT = 60;
const DEFAULT_MIN_ARTICLES = 3;
const DEFAULT_MIN_SOURCES = 2;
const DEFAULT_STALE_AFTER_MS = 60 * 60 * 1000;
const DEFAULT_MAX_INPUT_ARTICLES = 12;
const DEFAULT_MAX_FACTS_PER_ARTICLE = 10;
const DEFAULT_MAX_CLAIMS_PER_EVENT = 12;
const DEFAULT_MIN_CONFIDENCE = 0.5;

const CLAIM_STATUS_VALUES = [
  "agreement",
  "divergence",
  "framing",
  "exclusive_left",
  "exclusive_right",
  "exclusive_center",
] as const;

const CLAIM_TYPE_VALUES = [
  "quantitative",
  "event",
  "attribution",
  "policy",
  "characterization",
] as const;

const EVENT_CLAIMS_JSON_SCHEMA = {
  name: "EventClaims",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      claims: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            canonicalStatement: { type: "string" },
            claimType: {
              type: "string",
              enum: CLAIM_TYPE_VALUES,
            },
            status: {
              type: "string",
              enum: CLAIM_STATUS_VALUES,
            },
            importance: {
              type: "integer",
              minimum: 1,
              maximum: 5,
            },
            confidence: {
              type: "number",
              minimum: 0,
              maximum: 1,
            },
            variants: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                properties: {
                  articleIndex: {
                    type: "integer",
                    minimum: 0,
                  },
                  factIndex: {
                    type: "integer",
                    minimum: 0,
                  },
                  value: {
                    type: ["string", "null"],
                  },
                },
                required: ["articleIndex", "factIndex", "value"],
              },
            },
          },
          required: [
            "canonicalStatement",
            "claimType",
            "status",
            "importance",
            "confidence",
            "variants",
          ],
        },
      },
    },
    required: ["claims"],
  },
} as const;

type ClaimAnalysisArticle = {
  _id: Id<"articles">;
  sourceId: Id<"sources">;
  sourceName: string;
  sourceLean: string;
  sourceReliability: number;
  title: string;
  publishedAt: number;
  atomicFacts: string[];
};

type ClaimAnalysisInput = {
  eligible: true;
  event: {
    _id: Id<"events">;
    title: string;
    lastClaimAnalysisSignature?: string;
  };
  articles: ClaimAnalysisArticle[];
};

type RawClaimVariant = {
  articleIndex: number;
  factIndex: number;
  value: string | null;
};

type RawClaim = {
  canonicalStatement: string;
  claimType: ClaimType;
  status: ClaimDivergenceStatus;
  importance: number;
  confidence: number;
  variants: RawClaimVariant[];
};

type ParsedClaimResponse = {
  claims: RawClaim[];
};

type StoredClaim = {
  canonicalStatement: string;
  claimType: ClaimType;
  status: ClaimDivergenceStatus;
  variants: Array<{
    articleId: Id<"articles">;
    sourceId: Id<"sources">;
    sourceLean: string;
    sourceFactIndex?: number;
    statement: string;
    value?: string;
  }>;
  importance: number;
  confidence: number;
};

type DetectEventClaimsResult =
  | {
      skipped: true;
      reason: string;
      spentUsd?: number;
      dailyLimitUsd?: number;
    }
  | {
      skipped: false;
      generated: number;
      replaced: number;
      inputTokens: number;
      outputTokens: number;
      costUsd: number;
    };

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

function safeBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function safeString(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : fallback;
}

function normalizeForComparison(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}$%.\s-]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const CLAIM_DEBUG_ENABLED = process.env.CLAIM_ANALYSIS_DEBUG === "true";
const TOKEN_SYNONYMS: Record<string, string> = {
  rise: "increase",
  rises: "increase",
  increased: "increase",
  grow: "increase",
  grows: "increase",
  drop: "decrease",
  drops: "decrease",
  fell: "decrease",
  fall: "decrease",
  reduce: "decrease",
  reduced: "decrease",
  ban: "prohibit",
  bans: "prohibit",
  banned: "prohibit",
  pass: "approve",
  passed: "approve",
  approve: "approve",
  approved: "approve",
  bill: "law",
  legislation: "law",
  vote: "voting",
  voted: "voting",
};

function stemToken(token: string): string {
  const suffixes = ["ing", "ers", "er", "ed", "es", "s"];
  for (const suffix of suffixes) {
    if (token.endsWith(suffix) && token.length > suffix.length + 2) {
      return token.slice(0, -suffix.length);
    }
  }
  return token;
}

function canonicalizeToken(token: string): string {
  const normalized = token.toLowerCase();
  return TOKEN_SYNONYMS[normalized] ?? stemToken(normalized);
}

function meaningfulTokens(value: string): Set<string> {
  const stopwords = new Set([
    "about",
    "after",
    "also",
    "that",
    "their",
    "there",
    "these",
    "this",
    "with",
    "from",
    "have",
    "made",
    "said",
    "says",
    "were",
    "will",
  ]);
  const tokens = normalizeForComparison(value)
    .split(/\s+/)
    .map((token) => canonicalizeToken(token))
    .filter((token) => token.length > 2 && !stopwords.has(token));
  return new Set(tokens);
}

function statementSupportsClaim(
  canonicalStatement: string,
  statement: string,
  value: string | undefined,
): boolean {
  const canonicalTokens = meaningfulTokens(canonicalStatement);
  const statementTokens = meaningfulTokens(statement);
  if (canonicalTokens.size === 0 || statementTokens.size === 0) {
    if (CLAIM_DEBUG_ENABLED) {
      console.debug("[claimDivergence] Filtered variant", {
        canonicalStatement,
        statement,
        value,
        overlap: 0,
        canonicalTokenCount: canonicalTokens.size,
        reason: "no_tokens",
      });
    }
    return false;
  }

  let overlap = 0;
  for (const token of statementTokens) {
    if (canonicalTokens.has(token)) overlap++;
  }

  const canonicalTokenCount = Math.max(1, canonicalTokens.size);
  const overlapRatio = overlap / canonicalTokenCount;
  const valueMatch =
    value &&
    normalizeForComparison(statement).includes(normalizeForComparison(value));

  if (overlap >= 2 && overlapRatio >= 0.25) return true;
  if (valueMatch) return true;
  if (canonicalTokens.size <= 5 && overlap >= 1) return true;

  if (CLAIM_DEBUG_ENABLED) {
    const reason = valueMatch ? "value_match" : "low_overlap";
    console.debug("[claimDivergence] Filtered variant", {
      canonicalStatement,
      statement,
      value,
      overlap,
      canonicalTokenCount: canonicalTokens.size,
      overlapRatio,
      reason,
    });
  }

  return false;
}

function leanGroup(lean: string): "left" | "center" | "right" | "other" {
  if (lean === "left" || lean === "left-center") return "left";
  if (lean === "right" || lean === "right-center") return "right";
  if (lean === "center") return "center";
  return "other";
}

function exclusiveStatusForVariants(
  variants: StoredClaim["variants"],
): ClaimDivergenceStatus | null {
  const groups = new Set(
    variants.map((variant) => leanGroup(variant.sourceLean)),
  );
  groups.delete("other");
  if (groups.size !== 1) return null;
  const [group] = Array.from(groups);
  if (group === "left") return "exclusive_left";
  if (group === "right") return "exclusive_right";
  if (group === "center") return "exclusive_center";
  return null;
}

function sanitizeClaims(
  rawClaims: RawClaim[],
  articles: ClaimAnalysisArticle[],
  maxClaims: number,
  minConfidence: number,
): StoredClaim[] {
  const sanitized: StoredClaim[] = [];

  for (const rawClaim of rawClaims) {
    const canonicalStatement = rawClaim.canonicalStatement
      .replace(/\s+/g, " ")
      .trim();
    if (!canonicalStatement) continue;
    if (rawClaim.confidence < minConfidence) continue;

    const seenVariantKeys = new Set<string>();
    const variants: StoredClaim["variants"] = [];
    for (const rawVariant of rawClaim.variants) {
      const article = articles[rawVariant.articleIndex];
      const factIndex = Math.floor(rawVariant.factIndex);
      const statement = article?.atomicFacts[factIndex]
        ?.replace(/\s+/g, " ")
        .trim();
      if (!article || !statement) continue;

      const rawValue = rawVariant.value?.replace(/\s+/g, " ").trim();
      const value =
        rawValue && !["null", "none", "n/a"].includes(rawValue.toLowerCase())
          ? rawValue
          : undefined;
      if (!statementSupportsClaim(canonicalStatement, statement, value)) {
        continue;
      }

      const variantKey = `${article._id}:${normalizeForComparison(statement)}:${value ?? ""}`;
      if (seenVariantKeys.has(variantKey)) continue;
      seenVariantKeys.add(variantKey);

      variants.push({
        articleId: article._id,
        sourceId: article.sourceId,
        sourceLean: article.sourceLean,
        sourceFactIndex: factIndex,
        statement,
        value,
      });
    }

    if (variants.length === 0) continue;

    const distinctSources = new Set(
      variants.map((variant) => variant.sourceId),
    );
    const distinctValues = new Set(
      variants
        .map((variant) => normalizeForComparison(variant.value ?? ""))
        .filter(Boolean),
    );
    const distinctStatements = new Set(
      variants.map((variant) => normalizeForComparison(variant.statement)),
    );

    let status = rawClaim.status;
    if (status.startsWith("exclusive_")) {
      status =
        exclusiveStatusForVariants(variants) ??
        (distinctSources.size >= 2 ? "agreement" : status);
    }

    if (
      (status === "divergence" || status === "framing") &&
      distinctSources.size < 2
    ) {
      status = exclusiveStatusForVariants(variants) ?? "agreement";
    }

    if (
      status === "divergence" &&
      distinctValues.size <= 1 &&
      distinctStatements.size <= 1
    ) {
      status = "agreement";
    }

    if (status === "framing" && distinctStatements.size <= 1) {
      status = "agreement";
    }

    if (status === "agreement" && distinctSources.size < 2) {
      status = exclusiveStatusForVariants(variants) ?? status;
    }

    sanitized.push({
      canonicalStatement: canonicalStatement.slice(0, 500),
      claimType: rawClaim.claimType,
      status,
      variants,
      importance: Math.max(1, Math.min(5, Math.round(rawClaim.importance))),
      confidence: Math.max(0, Math.min(1, rawClaim.confidence)),
    });
  }

  return sanitized
    .sort((a, b) => b.importance - a.importance || b.confidence - a.confidence)
    .slice(0, maxClaims);
}

function parseClaimResponse(raw: unknown): ParsedClaimResponse {
  const parsed = typeof raw === "string" ? (JSON.parse(raw) as unknown) : raw;
  if (
    !parsed ||
    typeof parsed !== "object" ||
    !Array.isArray((parsed as { claims?: unknown }).claims)
  ) {
    throw new Error("Model returned an invalid claim response shape");
  }
  return parsed as ParsedClaimResponse;
}

function buildClaimAnalysisSignature(input: ClaimAnalysisInput): string {
  const payload = {
    eventId: input.event._id,
    title: input.event.title,
    articles: input.articles
      .map((article) => ({
        id: article._id,
        sourceId: article.sourceId,
        sourceLean: article.sourceLean,
        publishedAt: article.publishedAt,
        atomicFacts: article.atomicFacts,
      }))
      .sort((a, b) => a.id.localeCompare(b.id)),
  };
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

async function detectEventClaimsForInput(
  ctx: ActionCtx,
  input: ClaimAnalysisInput,
  settings: {
    model: string;
    maxClaims: number;
    minConfidence: number;
  },
): Promise<{
  claims: StoredClaim[];
  rawClaimCount: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}> {
  const prompt = buildClaimAnalysisPrompt({
    eventTitle: input.event.title,
    articles: input.articles.map((article) => ({
      title: article.title,
      sourceName: article.sourceName,
      sourceLean: article.sourceLean,
      sourceReliability: article.sourceReliability,
      publishedAt: new Date(article.publishedAt).toISOString(),
      atomicFacts: article.atomicFacts,
    })),
  });

  const response = await callOpenAI<ParsedClaimResponse>({
    kind: "chat",
    model: settings.model,
    temperature: 0.1,
    maxTokens: 2200,
    responseFormat: {
      type: "json_schema",
      json_schema: EVENT_CLAIMS_JSON_SCHEMA,
    },
    messages: [
      { role: "system", content: prompt.system },
      { role: "user", content: prompt.user },
    ],
    context: {
      callType: "claim_divergence",
      eventId: input.event._id,
    },
    runtime: ctx,
  });

  if (!response.result) {
    throw new Error(
      response.error ?? "Model returned an empty claim analysis response",
    );
  }

  const parsed = parseClaimResponse(response.result);
  return {
    rawClaimCount: parsed.claims.length,
    claims: sanitizeClaims(
      parsed.claims,
      input.articles,
      settings.maxClaims,
      settings.minConfidence,
    ),
    inputTokens: response.usage.inputTokens,
    outputTokens: response.usage.outputTokens,
    costUsd: response.usage.costUsd,
  };
}

async function detectEventClaimsForEvent(
  ctx: ActionCtx,
  eventId: Id<"events">,
): Promise<DetectEventClaimsResult> {
  const cfg = await ctx.runQuery(internal.config.getBatch, {
    keys: [
      "claim_analysis_enabled",
      "claim_analysis_model",
      "claim_analysis_min_articles",
      "claim_analysis_min_sources",
      "claim_analysis_max_input_articles",
      "claim_analysis_max_facts_per_article",
      "claim_analysis_max_claims_per_event",
      "claim_analysis_min_confidence",
    ],
  });

  const settings = {
    enabled: safeBoolean(cfg.claim_analysis_enabled, DEFAULT_ENABLED),
    model: safeString(cfg.claim_analysis_model, DEFAULT_MODEL),
    minArticles: safeInteger(
      cfg.claim_analysis_min_articles,
      DEFAULT_MIN_ARTICLES,
      1,
      20,
    ),
    minSources: safeInteger(
      cfg.claim_analysis_min_sources,
      DEFAULT_MIN_SOURCES,
      1,
      20,
    ),
    maxInputArticles: safeInteger(
      cfg.claim_analysis_max_input_articles,
      DEFAULT_MAX_INPUT_ARTICLES,
      3,
      30,
    ),
    maxFactsPerArticle: safeInteger(
      cfg.claim_analysis_max_facts_per_article,
      DEFAULT_MAX_FACTS_PER_ARTICLE,
      1,
      15,
    ),
    maxClaims: safeInteger(
      cfg.claim_analysis_max_claims_per_event,
      DEFAULT_MAX_CLAIMS_PER_EVENT,
      1,
      24,
    ),
    minConfidence: safeNumber(
      cfg.claim_analysis_min_confidence,
      DEFAULT_MIN_CONFIDENCE,
      0,
      1,
    ),
  };

  if (!settings.enabled) {
    return { skipped: true as const, reason: "disabled" };
  }

  const budget = await ctx.runQuery(internal.aiBudget.checkBudget, {});
  if (!budget.allowed) {
    return {
      skipped: true as const,
      reason: "budget_exhausted",
      spentUsd: budget.spentUsd,
      dailyLimitUsd: budget.dailyLimitUsd,
    };
  }

  const input = await ctx.runQuery(
    internal.claimDivergence.getClaimAnalysisInput,
    {
      eventId,
      minArticles: settings.minArticles,
      minSources: settings.minSources,
      maxArticles: settings.maxInputArticles,
      maxFactsPerArticle: settings.maxFactsPerArticle,
    },
  );

  if (!input.eligible) {
    if (input.reason !== "event_missing") {
      await ctx.runMutation(
        internal.claimDivergence.markEventClaimAnalysisSkipped,
        { eventId },
      );
    }
    return { skipped: true as const, reason: input.reason };
  }

  try {
    const analysisSignature = buildClaimAnalysisSignature(input);
    if (input.event.lastClaimAnalysisSignature === analysisSignature) {
      await ctx.runMutation(
        internal.claimDivergence.markEventClaimAnalysisSkipped,
        {
          eventId: input.event._id,
          analysisSignature,
        },
      );
      return { skipped: true as const, reason: "no_change_since_last_run" };
    }

    const { claims, rawClaimCount, inputTokens, outputTokens, costUsd } =
      await detectEventClaimsForInput(ctx, input, settings);

    if (claims.length === 0 && rawClaimCount > 0) {
      console.warn(
        `[claimDivergence] All variants filtered for ${input.event._id}, skipping replace`,
      );
      await ctx.runMutation(
        internal.claimDivergence.markEventClaimAnalysisSkipped,
        {
          eventId: input.event._id,
          analysisSignature,
        },
      );
      return { skipped: true as const, reason: "post_filter_empty" };
    }

    const result = await ctx.runMutation(
      internal.claimDivergence.replaceEventClaims,
      {
        eventId: input.event._id,
        claims,
        analysisSignature,
      },
    );

    return {
      skipped: false as const,
      generated: result.inserted,
      replaced: result.replaced,
      inputTokens,
      outputTokens,
      costUsd,
    };
  } finally {
    await shutdownPostHog();
  }
}

export const detectEventClaims = internalAction({
  args: {
    eventId: v.id("events"),
  },
  handler: async (ctx, args): Promise<DetectEventClaimsResult> => {
    return detectEventClaimsForEvent(ctx, args.eventId);
  },
});

export const processStaleEventClaims = internalAction({
  args: {
    processLimit: v.optional(v.number()),
    scanLimit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const paused = await ctx.runQuery(internal.config.isPipelinePaused, {});
    if (paused) {
      console.log(
        "[claimDivergence] Pipeline paused - skipping claim analysis",
      );
      return {
        processed: 0,
        succeeded: 0,
        failed: 0,
        skipped: 0,
        budgetExhausted: false,
      };
    }

    const cfg = await ctx.runQuery(internal.config.getBatch, {
      keys: [
        "claim_analysis_enabled",
        "claim_analysis_batch_size",
        "claim_analysis_scan_limit",
        "claim_analysis_min_articles",
        "claim_analysis_min_sources",
        "claim_analysis_stale_after_ms",
        "claim_analysis_backfill_enabled",
      ],
    });

    const settings = {
      enabled: safeBoolean(cfg.claim_analysis_enabled, DEFAULT_ENABLED),
      batchSize: safeInteger(
        args.processLimit ?? cfg.claim_analysis_batch_size,
        DEFAULT_BATCH_SIZE,
        1,
        10,
      ),
      scanLimit: safeInteger(
        args.scanLimit ?? cfg.claim_analysis_scan_limit,
        DEFAULT_SCAN_LIMIT,
        1,
        1000,
      ),
      minArticles: safeInteger(
        cfg.claim_analysis_min_articles,
        DEFAULT_MIN_ARTICLES,
        1,
        20,
      ),
      minSources: safeInteger(
        cfg.claim_analysis_min_sources,
        DEFAULT_MIN_SOURCES,
        1,
        20,
      ),
      staleAfterMs: safeInteger(
        cfg.claim_analysis_stale_after_ms,
        DEFAULT_STALE_AFTER_MS,
        5 * 60 * 1000,
        24 * 60 * 60 * 1000,
      ),
    };

    if (!settings.enabled) {
      return {
        processed: 0,
        succeeded: 0,
        failed: 0,
        skipped: 0,
        budgetExhausted: false,
      };
    }

    if (safeBoolean(cfg.claim_analysis_backfill_enabled, false)) {
      await ctx.runMutation(internal.claimDivergence.backfillEventClaimCoverage, {
        limit: settings.scanLimit,
        includeExisting: false,
      });
    }

    const candidateScan = await ctx.runQuery(
      internal.claimDivergence.getStaleEventsForClaimAnalysis,
      {
        limit: settings.batchSize,
        scanLimit: settings.scanLimit,
        minArticles: settings.minArticles,
        minSources: settings.minSources,
        staleAfterMs: settings.staleAfterMs,
      },
    );
    const candidates = candidateScan.candidates;

    console.log("[claimDivergence] Run start", {
      batchSize: settings.batchSize,
      scanLimit: settings.scanLimit,
      scanned: candidateScan.scanned,
      candidatesFound: candidates.length,
    });

    let processed = 0;
    let succeeded = 0;
    let failed = 0;
    let skipped = 0;
    let budgetExhausted = false;

    for (const candidate of candidates) {
      processed++;
      try {
        const result = await detectEventClaimsForEvent(ctx, candidate._id);
        if (result.skipped) {
          skipped++;
          if (result.reason === "budget_exhausted") {
            budgetExhausted = true;
            break;
          }
        } else {
          succeeded++;
        }
      } catch (error) {
        failed++;
        console.error(
          `[claimDivergence] Failed to analyze event ${candidate._id}: ${
            error instanceof Error ? error.message : "Unknown error"
          }`,
        );
      }
    }

    console.log(
      `[claimDivergence] Done: ${succeeded} succeeded, ${failed} failed, ${skipped} skipped`,
    );

    return {
      processed,
      succeeded,
      failed,
      skipped,
      budgetExhausted,
    };
  },
});
