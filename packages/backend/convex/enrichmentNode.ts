"use node";

/**
 * Article Enrichment Pipeline — Phase 3.3 (Node.js Action)
 *
 * This file runs in the Node.js runtime because it imports posthog-node
 * (via lib/openai) which depends on Node.js builtins.
 *
 * Queries & mutations live in enrichment.ts (default V8 runtime).
 *
 * Environment variables:
 *  - OPENAI_API_KEY:  Your OpenAI API key
 *  - POSTHOG_API_KEY: PostHog project key (optional; enables LLM analytics)
 */

import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import type { ActionCtx } from "./_generated/server";
import { shutdownPostHog } from "./lib/openai";
import { randomUUID } from "node:crypto";
import {
  demoteRepeatedSourceBodies,
  extractArticleContentForEmbedding,
  rssOnlyArticleContent,
} from "./lib/articleExtraction";
import { v } from "convex/values";
import { callLLM } from "./lib/aiCall";
import {
  buildArticleBiasScoringPrompt,
  buildArticleFactExtractionPrompt,
} from "./prompts";
import {
  DEFAULT_CHAT_MODEL,
  DEFAULT_EMBEDDING_MODEL,
} from "./lib/modelRouting";
import { extractionAllowed, normalizeDomain } from "./lib/tdmPolicy";
import { ensureDomainPermissions } from "./domainPermissionsNode";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** How many articles to enrich per cron run (cost control). */
const BATCH_SIZE = 40;

/** How long a claimed article can remain processing before another run retries it. */
const ARTICLE_LEASE_TTL_MS = 15 * 60 * 1000;

/** OpenAI embedding model — cheap & effective for clustering */
const EMBEDDING_MODEL = DEFAULT_EMBEDDING_MODEL;
const DEFAULT_FACT_EXTRACTION_MODEL = DEFAULT_CHAT_MODEL;
// Atomic-fact extraction is paused with claim analysis (BIV-602); flip the
// article_fact_extraction_enabled config key to re-enable.
const DEFAULT_FACT_EXTRACTION_ENABLED = false;
const DEFAULT_FACT_EXTRACTION_MAX_ARTICLES = 20;
const DEFAULT_FACT_EXTRACTION_MAX_FACTS = 8;
const DEFAULT_FACT_EXTRACTION_MAX_INPUT_CHARS = 2600;
// Per-article bias detection is paused with claim analysis (BIV-602); flip the
// article_bias_detection_enabled config key to re-enable.
const DEFAULT_BIAS_DETECTION_ENABLED = false;
const DEFAULT_BIAS_DETECTION_MODEL = DEFAULT_CHAT_MODEL;
const DEFAULT_BIAS_DETECTION_MAX_ARTICLES = 20;
const DEFAULT_BIAS_DETECTION_MAX_INPUT_CHARS = 6000;
const DEFAULT_BIAS_SOURCE_DELTA_THRESHOLD = 2;

/** Embedding dimensions (text-embedding-3-small supports 512 with shortening) */
const EMBEDDING_DIMENSIONS = 512;

/** Bump when switching embedding models or dimensions to enable reprocessing */
const EMBEDDING_VERSION = 4;

/** How many article pages to fetch/extract in parallel inside one batch. */
const EXTRACTION_CONCURRENCY = 5;

const ARTICLE_FACTS_JSON_SCHEMA = {
  name: "ArticleAtomicFacts",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      articles: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            id: { type: "string" },
            facts: {
              type: "array",
              items: { type: "string" },
            },
          },
          required: ["id", "facts"],
        },
      },
    },
    required: ["articles"],
  },
} as const;

const ARTICLE_BIAS_JSON_SCHEMA = {
  name: "ArticleBiasScores",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      articles: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            id: { type: "string" },
            bias: {
              type: "object",
              additionalProperties: false,
              properties: {
                axis: { type: "string", enum: ["reformist_suveranist"] },
                score: { type: "integer", minimum: -5, maximum: 5 },
              },
              required: ["axis", "score"],
            },
            emotionalLanguage: { type: "integer", minimum: 0, maximum: 5 },
            sourceDiversity: { type: "integer", minimum: 0, maximum: 5 },
            factOpinionRatio: { type: "integer", minimum: 0, maximum: 5 },
            rationale: { type: "string" },
          },
          required: [
            "id",
            "bias",
            "emotionalLanguage",
            "sourceDiversity",
            "factOpinionRatio",
            "rationale",
          ],
        },
      },
    },
    required: ["articles"],
  },
} as const;

type BiasComponents = {
  politicalLean: number;
  emotionalLanguage: number;
  sourceDiversity: number;
  factOpinionRatio: number;
  rationale: string;
};

type ArticleBiasResult = {
  aiBiasScore: number;
  biasComponents: BiasComponents;
  sourceBiasDelta: number;
  sourceBiasOutlierFlag: boolean;
  biasAnalyzedAt: number;
};

type ArticleAiStatus = {
  status:
    | "pending"
    | "deferred"
    | "succeeded"
    | "succeeded_empty"
    | "failed"
    | "skipped";
  error?: string;
  analyzedAt?: number;
};

type ArticleBiasStatus = "deferred" | "succeeded" | "failed" | "skipped";

function toArticleBiasStatus(
  status: ArticleAiStatus["status"] | undefined,
): ArticleBiasStatus | undefined {
  if (
    status === "deferred" ||
    status === "succeeded" ||
    status === "failed" ||
    status === "skipped"
  ) {
    return status;
  }
  return undefined;
}

type FactExtractionResult = {
  factsByArticleId: Map<string, string[]>;
  statusByArticleId: Map<Id<"articles">, ArticleAiStatus>;
};

type BiasScoringResult = {
  biasByArticleId: Map<Id<"articles">, ArticleBiasResult>;
  statusByArticleId: Map<Id<"articles">, ArticleAiStatus>;
};

type PreparedArticle = {
  _id: Id<"articles">;
  title: string;
  url: string;
  canonicalUrl: string;
  rssSnippet?: string | null;
  publishedAt: number;
  entities?: string[];
  extractionQuality?: "strong" | "weak";
  sourceBaseBias: number;
  sourceName?: string;
  embeddingText: string;
  extractedSummary?: string;
  extractionMethod: string;
  bodyChars: number;
  fetchSucceeded: boolean;
  resolvedUrl?: string;
  sourceLean: string;
  sourceReliability: number;
  previousStatus:
    | "unprocessed"
    | "processing"
    | "enriched"
    | "clustered"
    | "discarded"
    | "archived";
  imageUrl?: string;
  imageWidth?: number;
  imageHeight?: number;
  imageAlt?: string;
  imageSource?: "og" | "twitter" | "jsonld" | "inline";
};

type FactExtractionSettings = {
  enabled: boolean;
  model: string;
  maxArticles: number;
  maxFactsPerArticle: number;
  maxInputChars: number;
};

type BiasDetectionSettings = {
  enabled: boolean;
  model: string;
  maxArticles: number;
  maxInputChars: number;
  sourceDeltaThreshold: number;
};

// ---------------------------------------------------------------------------
// OpenAI Embedding Generation (via PostHog-instrumented client)
// ---------------------------------------------------------------------------

/**
 * Generate embeddings for a batch of texts via OpenAI SDK.
 * When POSTHOG_API_KEY is set, token usage, cost, and latency are
 * automatically tracked in PostHog LLM Analytics.
 */
async function generateEmbeddings(
  ctx: ActionCtx,
  texts: string[],
): Promise<{ embeddings: Array<number[] | null>; tokensUsed: number }> {
  const response = await callLLM<
    Array<{ index: number; embedding: number[] }>
  >({
    kind: "embedding",
    model: EMBEDDING_MODEL,
    input: texts,
    dimensions: EMBEDDING_DIMENSIONS,
    context: { callType: "embedding" },
    runtime: ctx,
  });
  if (!response.result) {
    throw new Error(response.error ?? "Embedding generation failed");
  }

  // Map back to input order
  const embeddings: Array<number[] | null> = new Array(texts.length).fill(null);
  for (const item of response.result) {
    embeddings[item.index] = item.embedding;
  }

  return { embeddings, tokensUsed: response.usage.inputTokens };
}

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

function sanitizeAtomicFacts(
  rawFacts: unknown,
  maxFactsPerArticle: number,
): string[] {
  if (!Array.isArray(rawFacts)) return [];

  const seen = new Set<string>();
  const facts: string[] = [];
  for (const rawFact of rawFacts) {
    if (typeof rawFact !== "string") continue;
    const fact = rawFact.replace(/\s+/g, " ").trim();
    if (fact.length < 12) continue;
    const normalized = fact.toLowerCase();
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    facts.push(fact.slice(0, 260));
    if (facts.length >= maxFactsPerArticle) break;
  }

  return facts;
}

function parseAtomicFactsResponse(
  raw: unknown,
  articleIds: Set<string>,
  maxFactsPerArticle: number,
): Map<string, string[]> {
  let parsed: unknown = raw;
  if (typeof raw === "string") {
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      throw new Error(
        `Fact extraction returned invalid JSON: ${error instanceof Error ? error.message : "unknown parse error"}`,
      );
    }
  }

  if (!parsed || typeof parsed !== "object") {
    throw new Error("Fact extraction returned a non-object JSON payload");
  }

  const rows = (parsed as { articles?: unknown }).articles;
  if (!Array.isArray(rows)) {
    throw new Error("Fact extraction JSON is missing an articles array");
  }

  const result = new Map<string, string[]>();
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const id = (row as { id?: unknown }).id;
    if (typeof id !== "string" || !articleIds.has(id)) continue;
    result.set(
      id,
      sanitizeAtomicFacts(
        (row as { facts?: unknown }).facts,
        maxFactsPerArticle,
      ),
    );
  }

  return result;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function roundScore(value: number): number {
  return Math.round(value * 100) / 100;
}

function combineBiasScore(components: BiasComponents): number {
  const politicalLean = clamp(Math.round(components.politicalLean), -5, 5);
  if (politicalLean === 0) return 0;

  const emotionalLanguage = clamp(
    Math.round(components.emotionalLanguage),
    0,
    5,
  );
  const factOpinionRatio = clamp(Math.round(components.factOpinionRatio), 0, 5);
  const sourceDiversity = clamp(Math.round(components.sourceDiversity), 0, 5);

  const intensity = (emotionalLanguage + factOpinionRatio) / 2;
  const diversityCounterweight = sourceDiversity * 0.3;
  const raw =
    politicalLean * (1 + intensity * 0.15) -
    Math.sign(politicalLean) * diversityCounterweight;

  return roundScore(clamp(raw, -5, 5));
}

function sanitizeBiasComponents(raw: unknown): BiasComponents | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const rationale = safeString(row.rationale, "").replace(/\s+/g, " ");
  if (rationale.length === 0) return null;

  // The model outputs the named-axis object { axis, score } (BIV-302). The
  // score is stored under the legacy biasComponents.politicalLean field name,
  // which now carries the reformist(−)↔suveranist(+) axis score.
  const biasObject =
    row.bias && typeof row.bias === "object"
      ? (row.bias as Record<string, unknown>)
      : null;
  const axisScore =
    biasObject !== null ? biasObject.score : row.politicalLean;

  return {
    politicalLean: safeInteger(axisScore, 0, -5, 5),
    emotionalLanguage: safeInteger(row.emotionalLanguage, 0, 0, 5),
    sourceDiversity: safeInteger(row.sourceDiversity, 0, 0, 5),
    factOpinionRatio: safeInteger(row.factOpinionRatio, 0, 0, 5),
    rationale: rationale.slice(0, 500),
  };
}

function parseBiasScoringResponse(
  raw: unknown,
  selectedArticles: PreparedArticle[],
  sourceDeltaThreshold: number,
): Map<Id<"articles">, ArticleBiasResult> {
  let parsed: unknown = raw;
  if (typeof raw === "string") {
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      throw new Error(
        `Bias scoring returned invalid JSON: ${error instanceof Error ? error.message : "unknown parse error"}`,
      );
    }
  }

  if (!parsed || typeof parsed !== "object") {
    throw new Error("Bias scoring returned a non-object JSON payload");
  }

  const rows = (parsed as { articles?: unknown }).articles;
  if (!Array.isArray(rows)) {
    throw new Error("Bias scoring JSON is missing an articles array");
  }

  const byArticleId = new Map(
    selectedArticles.map((article) => [article._id, article]),
  );
  const results = new Map<Id<"articles">, ArticleBiasResult>();
  const analyzedAt = Date.now();

  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const id = (row as { id?: unknown }).id;
    if (typeof id !== "string") continue;
    const article = byArticleId.get(id as Id<"articles">);
    if (!article) continue;

    const biasComponents = sanitizeBiasComponents(row);
    if (!biasComponents) continue;

    const aiBiasScore = combineBiasScore(biasComponents);
    const sourceBiasDelta = roundScore(aiBiasScore - article.sourceBaseBias);
    results.set(article._id, {
      aiBiasScore,
      biasComponents,
      sourceBiasDelta,
      sourceBiasOutlierFlag: Math.abs(sourceBiasDelta) >= sourceDeltaThreshold,
      biasAnalyzedAt: analyzedAt,
    });
  }

  return results;
}

function chunkArray<T>(items: T[], chunkSize: number): T[][] {
  const size = Math.max(1, Math.floor(chunkSize));
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

async function scoreBiasForArticles(
  ctx: ActionCtx,
  articles: PreparedArticle[],
  settings: BiasDetectionSettings,
): Promise<BiasScoringResult> {
  const selectedArticles = articles
    .filter(
      (article) =>
        article.embeddingText.trim().length > 0 ||
        article.extractedSummary?.trim() ||
        article.rssSnippet?.trim(),
    );
  const statusByArticleId = new Map<Id<"articles">, ArticleAiStatus>();
  const biasByArticleId = new Map<Id<"articles">, ArticleBiasResult>();
  const markArticles = (
    targetArticles: PreparedArticle[],
    status: ArticleAiStatus["status"],
    error?: string,
    analyzedAt?: number,
  ) => {
    const nextStatus: ArticleAiStatus = { status };
    if (error !== undefined) nextStatus.error = error;
    if (analyzedAt !== undefined) nextStatus.analyzedAt = analyzedAt;
    for (const article of targetArticles) {
      statusByArticleId.set(article._id, nextStatus);
    }
  };

  if (selectedArticles.length === 0) {
    return { biasByArticleId: new Map(), statusByArticleId };
  }

  if (!settings.enabled) {
    markArticles(selectedArticles, "skipped", "Article bias detection is disabled");
    return { biasByArticleId: new Map(), statusByArticleId };
  }

  for (const chunk of chunkArray(selectedArticles, settings.maxArticles)) {
    const budget = await ctx.runQuery(internal.aiBudget.checkBudget, {});
    if (!budget.allowed) {
      console.warn(
        `[enrichment] AI budget exhausted before bias scoring ($${budget.spentUsd}/$${budget.dailyLimitUsd}); skipping remaining article bias detection`,
      );
      markArticles(chunk, "deferred", "AI budget exhausted", Date.now());
      continue;
    }

    const prompt = buildArticleBiasScoringPrompt({
      maxInputChars: settings.maxInputChars,
      articles: chunk.map((article) => ({
        id: article._id,
        title: article.title,
        sourceName: article.sourceName,
        sourceLean: article.sourceLean,
        sourceReliability: article.sourceReliability,
        publishedAt: new Date(article.publishedAt).toISOString(),
        summary: article.extractedSummary,
        rssSnippet: article.rssSnippet ?? undefined,
        bodyText: article.embeddingText.slice(0, settings.maxInputChars),
      })),
    });

    try {
      const response = await callLLM<unknown>({
        kind: "chat",
        model: settings.model,
        temperature: 0,
        maxTokens: Math.min(2500, 220 + chunk.length * 120),
        responseFormat: {
          type: "json_schema",
          json_schema: ARTICLE_BIAS_JSON_SCHEMA,
        },
        messages: [
          { role: "system", content: prompt.system },
          { role: "user", content: prompt.user },
        ],
        context: { callType: "bias_scoring" },
        runtime: ctx,
      });

      const content = response.result;
      if (!content) {
        throw new Error(
          response.error ?? "Bias scoring returned an empty response",
        );
      }

      const results = parseBiasScoringResponse(
        content,
        chunk,
        settings.sourceDeltaThreshold,
      );
      const analyzedAt = Date.now();
      for (const [articleId, result] of results) {
        biasByArticleId.set(articleId, result);
      }
      for (const article of chunk) {
        statusByArticleId.set(
          article._id,
          results.has(article._id)
            ? { status: "succeeded", analyzedAt }
            : {
                status: "deferred",
                error: "Bias scoring omitted this article",
                analyzedAt,
              },
        );
      }

      console.log(
        `[enrichment] Scored bias for ${results.size}/${chunk.length} articles (${response.usage.inputTokens}/${response.usage.outputTokens} tokens)`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      console.error(`[enrichment] Article bias scoring failed: ${message}`);
      markArticles(chunk, "failed", message.slice(0, 500));
    }
  }

  return { biasByArticleId, statusByArticleId };
}

async function extractAtomicFactsForArticles(
  ctx: ActionCtx,
  articles: PreparedArticle[],
  settings: FactExtractionSettings,
): Promise<FactExtractionResult> {
  const selectedArticles = articles
    .filter(
      (article) =>
        article.embeddingText.trim().length > 0 ||
        article.extractedSummary?.trim() ||
        article.rssSnippet?.trim(),
    );
  const statusByArticleId = new Map<Id<"articles">, ArticleAiStatus>();
  const factsByArticleId = new Map<string, string[]>();
  const markArticles = (
    targetArticles: PreparedArticle[],
    status: ArticleAiStatus["status"],
    error?: string,
    analyzedAt?: number,
  ) => {
    const nextStatus: ArticleAiStatus = { status };
    if (error !== undefined) nextStatus.error = error;
    if (analyzedAt !== undefined) nextStatus.analyzedAt = analyzedAt;
    for (const article of targetArticles) {
      statusByArticleId.set(article._id, nextStatus);
    }
  };

  if (selectedArticles.length === 0) {
    return { factsByArticleId: new Map(), statusByArticleId };
  }

  if (!settings.enabled) {
    markArticles(selectedArticles, "skipped", "Atomic fact extraction is disabled");
    return { factsByArticleId: new Map(), statusByArticleId };
  }

  for (const chunk of chunkArray(selectedArticles, settings.maxArticles)) {
    const budget = await ctx.runQuery(internal.aiBudget.checkBudget, {});
    if (!budget.allowed) {
      console.warn(
        `[enrichment] AI budget exhausted before fact extraction ($${budget.spentUsd}/$${budget.dailyLimitUsd}); skipping remaining atomic facts`,
      );
      markArticles(chunk, "deferred", "AI budget exhausted", Date.now());
      continue;
    }

    const prompt = buildArticleFactExtractionPrompt({
      maxFactsPerArticle: settings.maxFactsPerArticle,
      articles: chunk.map((article) => ({
        id: article._id,
        title: article.title,
        sourceName: article.sourceName,
        publishedAt: new Date(article.publishedAt).toISOString(),
        entities: article.entities,
        summary: article.extractedSummary,
        rssSnippet: article.rssSnippet ?? undefined,
        bodyText: article.embeddingText.slice(0, settings.maxInputChars),
      })),
    });

    try {
      const response = await callLLM<unknown>({
        kind: "chat",
        model: settings.model,
        temperature: 0,
        maxTokens: Math.min(
          3000,
          250 + chunk.length * settings.maxFactsPerArticle * 32,
        ),
        responseFormat: {
          type: "json_schema",
          json_schema: ARTICLE_FACTS_JSON_SCHEMA,
        },
        messages: [
          { role: "system", content: prompt.system },
          { role: "user", content: prompt.user },
        ],
        context: { callType: "fact_extraction" },
        runtime: ctx,
      });

      const content = response.result;
      if (!content) {
        throw new Error(
          response.error ?? "Fact extraction returned an empty response",
        );
      }

      const chunkFacts = parseAtomicFactsResponse(
        content,
        new Set(chunk.map((article) => article._id)),
        settings.maxFactsPerArticle,
      );
      for (const [articleId, facts] of chunkFacts) {
        factsByArticleId.set(articleId, facts);
      }
      const analyzedAt = Date.now();
      for (const article of chunk) {
        if (!chunkFacts.has(article._id)) {
          statusByArticleId.set(article._id, {
            status: "deferred",
            error: "Fact extraction omitted this article",
            analyzedAt,
          });
          continue;
        }
        const facts = chunkFacts.get(article._id) ?? [];
        statusByArticleId.set(article._id, {
          status: facts.length > 0 ? "succeeded" : "succeeded_empty",
          analyzedAt,
        });
      }

      const factCount = Array.from(chunkFacts.values()).reduce(
        (sum, facts) => sum + facts.length,
        0,
      );
      console.log(
        `[enrichment] Extracted ${factCount} atomic facts across ${chunkFacts.size} articles (${response.usage.inputTokens}/${response.usage.outputTokens} tokens)`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      console.error(`[enrichment] Atomic fact extraction failed: ${message}`);
      markArticles(chunk, "failed", message.slice(0, 500));
    }
  }

  return { factsByArticleId, statusByArticleId };
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;

  const workers = Array.from({
    length: Math.max(1, Math.min(concurrency, items.length)),
  }).map(async () => {
    while (true) {
      const currentIndex = nextIndex;
      nextIndex++;
      if (currentIndex >= items.length) break;
      results[currentIndex] = await mapper(items[currentIndex]!, currentIndex);
    }
  });

  await Promise.all(workers);
  return results;
}

async function runEnrichmentBatch(
  ctx: ActionCtx,
  articles: Array<{
    _id: Id<"articles">;
    title: string;
    url: string;
    canonicalUrl: string;
    rssSnippet?: string | null;
    publishedAt: number;
    entities?: string[];
    extractionQuality?: "strong" | "weak";
    sourceBaseBias: number;
    sourceName?: string;
    sourceLean: string;
    sourceReliability: number;
    previousStatus:
      | "unprocessed"
      | "processing"
      | "enriched"
      | "clustered"
      | "discarded"
      | "archived";
  }>,
  runId: string,
): Promise<{
  enriched: number;
  failed: number;
  tokensUsed?: number;
  error?: string;
}> {
  console.log(`[enrichment] Processing ${articles.length} articles`);

  // L5 — TDM permission gate: extraction requires the domain's permission
  // state to be `full`; anything else contributes RSS metadata only.
  const permissionStates = await ensureDomainPermissions(
    ctx,
    articles.map((article) => article.canonicalUrl),
  );
  const restrictedCount = articles.filter(
    (article) =>
      !extractionAllowed(
        permissionStates.get(normalizeDomain(article.canonicalUrl)) ??
          "rss_only",
      ),
  ).length;
  if (restrictedCount > 0) {
    console.log(
      `[enrichment] L5 gate: ${restrictedCount}/${articles.length} article(s) restricted to RSS metadata (TDM opt-out)`,
    );
  }

  const preparedArticles = await mapWithConcurrency(
    articles,
    EXTRACTION_CONCURRENCY,
    async (article) => {
      const permissionState =
        permissionStates.get(normalizeDomain(article.canonicalUrl)) ??
        "rss_only";
      const extracted = extractionAllowed(permissionState)
        ? await extractArticleContentForEmbedding({
            title: article.title,
            url: article.url,
            rssSnippet: article.rssSnippet ?? "",
          })
        : rssOnlyArticleContent({
            title: article.title,
            rssSnippet: article.rssSnippet ?? "",
          });

      return {
        ...article,
        embeddingText: extracted.embeddingText,
        extractedSummary: extracted.summary,
        extractionMethod: extracted.method,
        bodyChars: extracted.bodyChars,
        fetchSucceeded: extracted.fetchSucceeded,
        resolvedUrl: extracted.resolvedUrl,
        imageUrl: extracted.imageUrl,
        imageWidth: extracted.imageWidth,
        imageHeight: extracted.imageHeight,
        imageAlt: extracted.imageAlt,
        imageSource: extracted.imageSource,
        entities: extracted.entities,
        extractionQuality: extracted.extractionQuality,
      };
    },
  ).then(demoteRepeatedSourceBodies);
  const texts = preparedArticles.map((article) => article.embeddingText);
  const extractedCount = preparedArticles.filter(
    (article) => article.extractionMethod !== "rss_fallback",
  ).length;
  const fetchSuccessCount = preparedArticles.filter(
    (article) => article.fetchSucceeded,
  ).length;
  const resolvedUrlCount = preparedArticles.filter(
    (article) => article.resolvedUrl && article.resolvedUrl !== article.url,
  ).length;

  try {
    const { embeddings, tokensUsed } = await generateEmbeddings(ctx, texts);

    console.log(
      `[enrichment] Generated embeddings, ${tokensUsed} tokens used (${extractedCount}/${articles.length} extracted, ${fetchSuccessCount}/${articles.length} fetches succeeded, ${resolvedUrlCount}/${articles.length} URLs resolved)`,
    );

    const factConfig = await ctx.runQuery(internal.config.getBatch, {
      keys: [
        "article_fact_extraction_enabled",
        "article_fact_extraction_model",
        "article_fact_extraction_max_articles_per_run",
        "article_fact_extraction_max_facts_per_article",
        "article_fact_extraction_max_input_chars",
        "article_bias_detection_enabled",
        "article_bias_detection_model",
        "article_bias_detection_max_articles_per_run",
        "article_bias_detection_max_input_chars",
        "article_bias_source_delta_threshold",
      ],
    });
    const factSettings: FactExtractionSettings = {
      enabled: safeBoolean(
        factConfig.article_fact_extraction_enabled,
        DEFAULT_FACT_EXTRACTION_ENABLED,
      ),
      model: safeString(
        factConfig.article_fact_extraction_model,
        DEFAULT_FACT_EXTRACTION_MODEL,
      ),
      maxArticles: safeInteger(
        factConfig.article_fact_extraction_max_articles_per_run,
        DEFAULT_FACT_EXTRACTION_MAX_ARTICLES,
        1,
        BATCH_SIZE,
      ),
      maxFactsPerArticle: safeInteger(
        factConfig.article_fact_extraction_max_facts_per_article,
        DEFAULT_FACT_EXTRACTION_MAX_FACTS,
        1,
        16,
      ),
      maxInputChars: safeInteger(
        factConfig.article_fact_extraction_max_input_chars,
        DEFAULT_FACT_EXTRACTION_MAX_INPUT_CHARS,
        500,
        6000,
      ),
    };
    const biasSettings: BiasDetectionSettings = {
      enabled: safeBoolean(
        factConfig.article_bias_detection_enabled,
        DEFAULT_BIAS_DETECTION_ENABLED,
      ),
      model: safeString(
        factConfig.article_bias_detection_model,
        DEFAULT_BIAS_DETECTION_MODEL,
      ),
      maxArticles: safeInteger(
        factConfig.article_bias_detection_max_articles_per_run,
        DEFAULT_BIAS_DETECTION_MAX_ARTICLES,
        1,
        BATCH_SIZE,
      ),
      maxInputChars: safeInteger(
        factConfig.article_bias_detection_max_input_chars,
        DEFAULT_BIAS_DETECTION_MAX_INPUT_CHARS,
        500,
        10000,
      ),
      sourceDeltaThreshold: safeNumber(
        factConfig.article_bias_source_delta_threshold,
        DEFAULT_BIAS_SOURCE_DELTA_THRESHOLD,
        0.25,
        5,
      ),
    };

    const factResult = await extractAtomicFactsForArticles(
      ctx,
      preparedArticles,
      factSettings,
    );
    const biasEligibleArticles = preparedArticles.filter(
      (article) =>
        factResult.statusByArticleId.get(article._id)?.status !== "deferred",
    );
    const biasResult = await scoreBiasForArticles(
      ctx,
      biasEligibleArticles,
      biasSettings,
    );
    const factsByArticleId = factResult.factsByArticleId;
    const biasByArticleId = biasResult.biasByArticleId;

    let enriched = 0;
    let failed = 0;
    const touchedEventIds = new Set<Id<"events">>();

    for (let i = 0; i < articles.length; i++) {
      const article = articles[i]!;
      const prepared = preparedArticles[i]!;
      const embedding = embeddings[i];

      if (embedding) {
        const bias = biasByArticleId.get(article._id);
        const factStatus = factResult.statusByArticleId.get(article._id);
        const biasStatus = biasResult.statusByArticleId.get(article._id);
        if (factStatus?.status === "deferred") {
          const result = await ctx.runMutation(
            internal.enrichment.deferArticleFactExtraction,
            {
              articleId: article._id,
              runId,
              previousStatus: article.previousStatus,
              reason: factStatus.error ?? "Atomic fact extraction deferred",
              attemptedAt: factStatus.analyzedAt ?? Date.now(),
            },
          );
          if (result.updated) {
            failed++;
            if (result.eventId) {
              touchedEventIds.add(result.eventId);
            }
          } else {
            console.warn(
              `[enrichment] Article ${article._id} lease no longer belongs to run ${runId}; leaving it unchanged`,
            );
          }
          continue;
        }
        if (biasStatus?.status === "deferred") {
          const result = await ctx.runMutation(
            internal.enrichment.deferArticleBiasDetection,
            {
              articleId: article._id,
              runId,
              previousStatus: article.previousStatus,
              reason: biasStatus.error ?? "Article bias detection deferred",
            },
          );
          if (result.updated) {
            failed++;
            if (result.eventId) {
              touchedEventIds.add(result.eventId);
            }
          } else {
            console.warn(
              `[enrichment] Article ${article._id} lease no longer belongs to run ${runId}; leaving it unchanged`,
            );
          }
          continue;
        }
        const result = await ctx.runMutation(
          internal.enrichment.markArticleEnriched,
          {
            articleId: article._id,
            embedding,
            aiBiasScore: bias?.aiBiasScore,
            biasComponents: bias?.biasComponents,
            sourceBiasDelta: bias?.sourceBiasDelta,
            sourceBiasOutlierFlag: bias?.sourceBiasOutlierFlag,
            biasAnalyzedAt: bias?.biasAnalyzedAt,
            biasDetectionStatus: toArticleBiasStatus(biasStatus?.status),
            biasDetectionError: biasStatus?.error,
            summary: prepared.extractedSummary,
            atomicFacts: factsByArticleId.get(article._id),
            factExtractionStatus: factStatus?.status,
            factExtractionError: factStatus?.error,
            factExtractedAt: factStatus?.analyzedAt,
            resolvedUrl: prepared.resolvedUrl,
            imageUrl: prepared.imageUrl,
            imageWidth: prepared.imageWidth,
            imageHeight: prepared.imageHeight,
            imageAlt: prepared.imageAlt,
            imageSource: prepared.imageSource,
            entities: prepared.entities,
            extractionQuality: prepared.extractionQuality,
            version: EMBEDDING_VERSION,
            runId,
          },
        );
        if (result.updated) {
          enriched++;
          if (result.eventId) {
            touchedEventIds.add(result.eventId);
          }
        } else {
          console.warn(
            `[enrichment] Article ${article._id} lease no longer belongs to run ${runId}; leaving it unchanged`,
          );
        }
      } else {
        const result = await ctx.runMutation(
          internal.enrichment.markArticleDiscarded,
          {
            articleId: article._id,
            runId,
          },
        );
        if (result.updated) {
          failed++;
        } else {
          console.warn(
            `[enrichment] Article ${article._id} lease no longer belongs to run ${runId}; leaving it unchanged`,
          );
        }
        console.warn(
          `[enrichment] No embedding for article ${article._id}, discarded`,
        );
      }
    }

    for (const eventId of touchedEventIds) {
      await ctx.runMutation(internal.clustering.refreshEventPresentationById, {
        eventId,
      });
    }

    console.log(
      `[enrichment] Done: ${enriched} enriched, ${failed} failed, ${tokensUsed} tokens, ${extractedCount} extracted`,
    );

    return { enriched, failed, tokensUsed };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error(`[enrichment] Batch embedding failed: ${message}`);
    return {
      enriched: 0,
      failed: articles.length,
      error: message,
    };
  }
}

// ---------------------------------------------------------------------------
// Main Enrichment Action
// ---------------------------------------------------------------------------

/**
 * Enrich a batch of unprocessed articles with embeddings.
 * Called by the cron job every 30 minutes.
 */
export const enrichUnprocessedArticles = internalAction({
  args: {},
  handler: async (
    ctx,
  ): Promise<{
    enriched: number;
    failed: number;
    tokensUsed?: number;
    error?: string;
    skipped: boolean;
  }> => {
    const startedAt = Date.now();
    const runId = randomUUID();
    // Kill-switch: skip entire run when pipeline is paused
    const paused = await ctx.runQuery(internal.config.isPipelinePaused, {});
    if (paused) {
      console.log("[enrichment] Pipeline paused — skipping enrichment");
      await ctx.runMutation(internal.pipeline.insertRunLog, {
        jobName: "enrichUnprocessedArticles",
        runId,
        startedAt,
        finishedAt: Date.now(),
        durationMs: Date.now() - startedAt,
        status: "skipped",
        counters: {},
        gauges: { reason: "pipeline_paused" },
        metadata: {},
      });
      return { enriched: 0, failed: 0, skipped: true };
    }

    // 0. Check AI budget before making any API calls
    const budget = await ctx.runQuery(internal.aiBudget.checkBudget, {});
    if (!budget.allowed) {
      console.warn(
        `[enrichment] AI budget exhausted ($${budget.spentUsd}/$${budget.dailyLimitUsd}). Skipping.`,
      );
      await ctx.runMutation(internal.pipeline.insertRunLog, {
        jobName: "enrichUnprocessedArticles",
        runId,
        startedAt,
        finishedAt: Date.now(),
        durationMs: Date.now() - startedAt,
        status: "skipped",
        counters: {},
        gauges: {
          reason: "ai_budget_exhausted",
          spentUsd: budget.spentUsd,
          dailyLimitUsd: budget.dailyLimitUsd,
        },
        metadata: {},
      });
      return { enriched: 0, failed: 0, skipped: true };
    }

    // 1. Atomically claim unprocessed or expired-lease articles for this run.
    const articles = await ctx.runMutation(
      internal.enrichment.claimUnprocessedArticles,
      {
        limit: BATCH_SIZE,
        runId,
        leaseExpiresAt: Date.now() + ARTICLE_LEASE_TTL_MS,
      },
    );

    if (articles.length === 0) {
      console.log("[enrichment] No unprocessed articles to enrich");
      await ctx.runMutation(internal.pipeline.insertRunLog, {
        jobName: "enrichUnprocessedArticles",
        runId,
        startedAt,
        finishedAt: Date.now(),
        durationMs: Date.now() - startedAt,
        status: "ok",
        counters: { claimedArticles: 0, enrichedArticles: 0, failedArticles: 0 },
        gauges: { scheduledClustering: false },
        metadata: {},
      });
      return { enriched: 0, failed: 0, skipped: false };
    }

    try {
      const result = await runEnrichmentBatch(ctx, articles, runId);
      if (result.enriched > 0) {
        await ctx.scheduler.runAfter(
          90_000,
          internal.clustering.clusterEnrichedArticles,
          {},
        );
      }
      const finishedAt = Date.now();
      await ctx.runMutation(internal.pipeline.insertRunLog, {
        jobName: "enrichUnprocessedArticles",
        runId,
        startedAt,
        finishedAt,
        durationMs: finishedAt - startedAt,
        status:
          result.error !== undefined
            ? "error"
            : result.failed > 0
              ? "degraded"
              : "ok",
        errorMessage: result.error,
        counters: {
          claimedArticles: articles.length,
          enrichedArticles: result.enriched,
          failedArticles: result.failed,
          tokensUsed: result.tokensUsed ?? 0,
        },
        gauges: {
          scheduledClustering: result.enriched > 0,
          failureRatio:
            articles.length > 0 ? result.failed / articles.length : 0,
        },
        metadata: {},
      });
      return { ...result, skipped: false };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      console.error(`[enrichment] Batch embedding failed: ${message}`);
      await ctx.runMutation(internal.pipeline.insertRunLog, {
        jobName: "enrichUnprocessedArticles",
        runId,
        startedAt,
        finishedAt: Date.now(),
        durationMs: Date.now() - startedAt,
        status: "error",
        errorMessage: message,
        counters: {
          claimedArticles: articles.length,
          enrichedArticles: 0,
          failedArticles: articles.length,
        },
        gauges: { scheduledClustering: false },
        metadata: {},
      });

      // Don't discard articles on transient API errors — they'll be retried next run
      return {
        enriched: 0,
        failed: articles.length,
        error: message,
        skipped: false,
      };
    } finally {
      // Flush PostHog events before the action returns
      await shutdownPostHog();
    }
  },
});

export const reenrichArticlesBackfill = internalAction({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { limit }) => {
    const paused = await ctx.runQuery(internal.config.isPipelinePaused, {});
    if (paused) {
      console.log(
        "[enrichment] Pipeline paused — skipping re-enrichment backfill",
      );
      return { enriched: 0, failed: 0, skipped: true };
    }

    const budget = await ctx.runQuery(internal.aiBudget.checkBudget, {});
    if (!budget.allowed) {
      console.warn(
        `[enrichment] AI budget exhausted ($${budget.spentUsd}/$${budget.dailyLimitUsd}). Skipping re-enrichment.`,
      );
      return { enriched: 0, failed: 0, skipped: true };
    }

    const runId = randomUUID();
    const articles = await ctx.runMutation(
      internal.enrichment.claimArticlesForReenrichment,
      {
        limit: limit ?? BATCH_SIZE,
        runId,
        leaseExpiresAt: Date.now() + ARTICLE_LEASE_TTL_MS,
        targetVersion: EMBEDDING_VERSION,
      },
    );

    if (articles.length === 0) {
      console.log("[enrichment] No articles currently need re-enrichment");
      return { enriched: 0, failed: 0, skipped: false };
    }

    try {
      const result = await runEnrichmentBatch(ctx, articles, runId);
      return { ...result, skipped: false };
    } finally {
      await shutdownPostHog();
    }
  },
});

export const backfillAtomicFacts = internalAction({
  args: {
    limit: v.optional(v.number()),
    batchSize: v.optional(v.number()),
    beforePublishedAt: v.optional(v.number()),
    includeFailed: v.optional(v.boolean()),
    includeSucceededEmpty: v.optional(v.boolean()),
    force: v.optional(v.boolean()),
  },
  handler: async (
    ctx,
    {
      limit,
      batchSize,
      beforePublishedAt,
      includeFailed,
      includeSucceededEmpty,
      force,
    },
  ): Promise<{
    processed: number;
    enriched: number;
    failed: number;
    skipped: boolean;
    budgetExhausted: boolean;
    nextBeforePublishedAt?: number;
  }> => {
    const paused = await ctx.runQuery(internal.config.isPipelinePaused, {});
    if (paused && !force) {
      console.log(
        "[enrichment] Pipeline paused — skipping atomic facts backfill",
      );
      return {
        processed: 0,
        enriched: 0,
        failed: 0,
        skipped: true,
        budgetExhausted: false,
      };
    }
    const backfillCfg = await ctx.runQuery(internal.config.getBatch, {
      keys: ["backfill_enabled"],
    });
    if (backfillCfg.backfill_enabled !== true && !force) {
      console.log(
        "[enrichment] Atomic facts backfill skipped: backfill_enabled is false",
      );
      return {
        processed: 0,
        enriched: 0,
        failed: 0,
        skipped: true,
        budgetExhausted: false,
      };
    }

    const totalLimit = safeInteger(limit, 100, 1, 500);
    const perBatch = safeInteger(batchSize, 20, 1, BATCH_SIZE);
    let processed = 0;
    let enriched = 0;
    let failed = 0;
    let cursor = beforePublishedAt;

    try {
      while (processed < totalLimit) {
        const budget = await ctx.runQuery(internal.aiBudget.checkBudget, {});
        if (!budget.allowed) {
          console.warn(
            `[enrichment] AI budget exhausted ($${budget.spentUsd}/$${budget.dailyLimitUsd}). Stopping atomic facts backfill.`,
          );
          return {
            processed,
            enriched,
            failed,
            skipped: false,
            budgetExhausted: true,
            nextBeforePublishedAt: cursor,
          };
        }

        const runId = randomUUID();
        const articles = await ctx.runMutation(
          internal.enrichment.claimArticlesNeedingFactExtraction,
          {
            limit: Math.min(perBatch, totalLimit - processed),
            runId,
            leaseExpiresAt: Date.now() + ARTICLE_LEASE_TTL_MS,
            beforePublishedAt: cursor,
            includeFailed: includeFailed ?? true,
            includeSucceededEmpty: includeSucceededEmpty ?? false,
          },
        );

        if (articles.length === 0) break;
        const oldestPublishedAt = articles.reduce(
          (oldest: number | undefined, article: { publishedAt: number }) =>
            oldest === undefined
              ? article.publishedAt
              : Math.min(oldest, article.publishedAt),
          undefined,
        );

        const result = await runEnrichmentBatch(ctx, articles, runId);
        processed += articles.length;
        enriched += result.enriched;
        failed += result.failed;
        cursor = oldestPublishedAt;
      }

      return {
        processed,
        enriched,
        failed,
        skipped: false,
        budgetExhausted: false,
        nextBeforePublishedAt: cursor,
      };
    } finally {
      await shutdownPostHog();
    }
  },
});

export const reenrichEventArticles = internalAction({
  args: {
    eventId: v.id("events"),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { eventId, limit }) => {
    const paused = await ctx.runQuery(internal.config.isPipelinePaused, {});
    if (paused) {
      console.log(
        "[enrichment] Pipeline paused — skipping event re-enrichment",
      );
      return { enriched: 0, failed: 0, skipped: true };
    }

    const budget = await ctx.runQuery(internal.aiBudget.checkBudget, {});
    if (!budget.allowed) {
      console.warn(
        `[enrichment] AI budget exhausted ($${budget.spentUsd}/$${budget.dailyLimitUsd}). Skipping event re-enrichment.`,
      );
      return { enriched: 0, failed: 0, skipped: true };
    }

    const runId = randomUUID();
    const articles = await ctx.runMutation(
      internal.enrichment.claimEventArticlesForReenrichment,
      {
        eventId,
        limit: Math.max(1, Math.min(30, Math.floor(limit ?? 12))),
        runId,
        leaseExpiresAt: Date.now() + ARTICLE_LEASE_TTL_MS,
      },
    );

    if (articles.length === 0) {
      console.log("[enrichment] No articles found for event re-enrichment");
      return { enriched: 0, failed: 0, skipped: false };
    }

    try {
      const result = await runEnrichmentBatch(ctx, articles, runId);
      return { ...result, skipped: false };
    } finally {
      await shutdownPostHog();
    }
  },
});
