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
import { extractArticleContentForEmbedding } from "./lib/articleExtraction";
import { v } from "convex/values";
import { callOpenAI } from "./lib/aiCall";
import {
  buildArticleBiasScoringPrompt,
  buildArticleFactExtractionPrompt,
} from "./prompts";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** How many articles to enrich per cron run (cost control) */
const BATCH_SIZE = 50;

/** How long a claimed article can remain processing before another run retries it. */
const ARTICLE_LEASE_TTL_MS = 15 * 60 * 1000;

/** OpenAI embedding model — cheap & effective for clustering */
const EMBEDDING_MODEL = "text-embedding-3-small";
const DEFAULT_FACT_EXTRACTION_MODEL = "gpt-4o-mini";
const DEFAULT_FACT_EXTRACTION_ENABLED = true;
const DEFAULT_FACT_EXTRACTION_MAX_ARTICLES = 20;
const DEFAULT_FACT_EXTRACTION_MAX_FACTS = 8;
const DEFAULT_FACT_EXTRACTION_MAX_INPUT_CHARS = 2600;
const DEFAULT_BIAS_DETECTION_ENABLED = true;
const DEFAULT_BIAS_DETECTION_MODEL = "gpt-4o-mini";
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
            politicalLean: { type: "integer", minimum: -5, maximum: 5 },
            emotionalLanguage: { type: "integer", minimum: 0, maximum: 5 },
            sourceDiversity: { type: "integer", minimum: 0, maximum: 5 },
            factOpinionRatio: { type: "integer", minimum: 0, maximum: 5 },
            rationale: { type: "string" },
          },
          required: [
            "id",
            "politicalLean",
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
  status: "succeeded" | "failed" | "skipped";
  error?: string;
  analyzedAt?: number;
};

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
  const response = await callOpenAI<
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

  for (const id of articleIds) {
    if (!result.has(id)) result.set(id, []);
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

  return {
    politicalLean: safeInteger(row.politicalLean, 0, -5, 5),
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
    )
    .slice(0, settings.maxArticles);
  const statusByArticleId = new Map<Id<"articles">, ArticleAiStatus>();
  const markSelected = (
    status: ArticleAiStatus["status"],
    error?: string,
    analyzedAt?: number,
  ) => {
    const nextStatus: ArticleAiStatus = { status };
    if (error !== undefined) nextStatus.error = error;
    if (analyzedAt !== undefined) nextStatus.analyzedAt = analyzedAt;
    for (const article of selectedArticles) {
      statusByArticleId.set(article._id, nextStatus);
    }
  };

  if (selectedArticles.length === 0) {
    return { biasByArticleId: new Map(), statusByArticleId };
  }

  if (!settings.enabled) {
    markSelected("skipped", "Article bias detection is disabled");
    return { biasByArticleId: new Map(), statusByArticleId };
  }

  const budget = await ctx.runQuery(internal.aiBudget.checkBudget, {});
  if (!budget.allowed) {
    console.warn(
      `[enrichment] AI budget exhausted before bias scoring ($${budget.spentUsd}/$${budget.dailyLimitUsd}); skipping article bias detection`,
    );
    markSelected("failed", "AI budget exhausted");
    return { biasByArticleId: new Map(), statusByArticleId };
  }

  const prompt = buildArticleBiasScoringPrompt({
    maxInputChars: settings.maxInputChars,
    articles: selectedArticles.map((article) => ({
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
    const response = await callOpenAI<unknown>({
      kind: "chat",
      model: settings.model,
      temperature: 0,
      maxTokens: Math.min(2500, 220 + selectedArticles.length * 120),
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
      selectedArticles,
      settings.sourceDeltaThreshold,
    );
    const analyzedAt = Date.now();
    for (const article of selectedArticles) {
      statusByArticleId.set(
        article._id,
        results.has(article._id)
          ? { status: "succeeded", analyzedAt }
          : { status: "failed", error: "Bias scoring omitted this article" },
      );
    }

    const inputTokens = response.usage.inputTokens;
    const outputTokens = response.usage.outputTokens;

    console.log(
      `[enrichment] Scored bias for ${results.size}/${selectedArticles.length} articles (${inputTokens}/${outputTokens} tokens)`,
    );

    return { biasByArticleId: results, statusByArticleId };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error(
      `[enrichment] Article bias scoring failed: ${message}`,
    );
    markSelected("failed", message.slice(0, 500));
    return { biasByArticleId: new Map(), statusByArticleId };
  }
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
    )
    .slice(0, settings.maxArticles);
  const statusByArticleId = new Map<Id<"articles">, ArticleAiStatus>();
  const markSelected = (
    status: ArticleAiStatus["status"],
    error?: string,
    analyzedAt?: number,
  ) => {
    const nextStatus: ArticleAiStatus = { status };
    if (error !== undefined) nextStatus.error = error;
    if (analyzedAt !== undefined) nextStatus.analyzedAt = analyzedAt;
    for (const article of selectedArticles) {
      statusByArticleId.set(article._id, nextStatus);
    }
  };

  if (selectedArticles.length === 0) {
    return { factsByArticleId: new Map(), statusByArticleId };
  }

  if (!settings.enabled) {
    markSelected("skipped", "Atomic fact extraction is disabled");
    return { factsByArticleId: new Map(), statusByArticleId };
  }

  const budget = await ctx.runQuery(internal.aiBudget.checkBudget, {});
  if (!budget.allowed) {
    console.warn(
      `[enrichment] AI budget exhausted before fact extraction ($${budget.spentUsd}/$${budget.dailyLimitUsd}); skipping atomic facts`,
    );
    markSelected("failed", "AI budget exhausted");
    return { factsByArticleId: new Map(), statusByArticleId };
  }

  const prompt = buildArticleFactExtractionPrompt({
    maxFactsPerArticle: settings.maxFactsPerArticle,
    articles: selectedArticles.map((article) => ({
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
    const response = await callOpenAI<unknown>({
      kind: "chat",
      model: settings.model,
      temperature: 0,
      maxTokens: Math.min(
        3000,
        250 + selectedArticles.length * settings.maxFactsPerArticle * 32,
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

    const factsByArticleId = parseAtomicFactsResponse(
      content,
      new Set(selectedArticles.map((article) => article._id)),
      settings.maxFactsPerArticle,
    );
    const analyzedAt = Date.now();
    for (const article of selectedArticles) {
      statusByArticleId.set(article._id, {
        status: "succeeded",
        analyzedAt,
      });
    }

    const inputTokens = response.usage.inputTokens;
    const outputTokens = response.usage.outputTokens;

    const factCount = Array.from(factsByArticleId.values()).reduce(
      (sum, facts) => sum + facts.length,
      0,
    );
    console.log(
      `[enrichment] Extracted ${factCount} atomic facts across ${factsByArticleId.size} articles (${inputTokens}/${outputTokens} tokens)`,
    );

    return { factsByArticleId, statusByArticleId };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error(
      `[enrichment] Atomic fact extraction failed: ${message}`,
    );
    markSelected("failed", message.slice(0, 500));
    return { factsByArticleId: new Map(), statusByArticleId };
  }
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
  }>,
  runId: string,
): Promise<{
  enriched: number;
  failed: number;
  tokensUsed?: number;
  error?: string;
}> {
  console.log(`[enrichment] Processing ${articles.length} articles`);

  const preparedArticles = await mapWithConcurrency(
    articles,
    EXTRACTION_CONCURRENCY,
    async (article) => {
      const extracted = await extractArticleContentForEmbedding({
        title: article.title,
        url: article.url,
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
  );
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

    const [factResult, biasResult] = await Promise.all([
      extractAtomicFactsForArticles(ctx, preparedArticles, factSettings),
      scoreBiasForArticles(ctx, preparedArticles, biasSettings),
    ]);
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
            biasDetectionStatus: biasStatus?.status,
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
    // Kill-switch: skip entire run when pipeline is paused
    const paused = await ctx.runQuery(internal.config.isPipelinePaused, {});
    if (paused) {
      console.log("[enrichment] Pipeline paused — skipping enrichment");
      return { enriched: 0, failed: 0, skipped: true };
    }

    // 0. Check AI budget before making any API calls
    const budget = await ctx.runQuery(internal.aiBudget.checkBudget, {});
    if (!budget.allowed) {
      console.warn(
        `[enrichment] AI budget exhausted ($${budget.spentUsd}/$${budget.dailyLimitUsd}). Skipping.`,
      );
      return { enriched: 0, failed: 0, skipped: true };
    }

    const runId = randomUUID();

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
      return { enriched: 0, failed: 0, skipped: false };
    }

    try {
      const result = await runEnrichmentBatch(ctx, articles, runId);
      return { ...result, skipped: false };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      console.error(`[enrichment] Batch embedding failed: ${message}`);

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
