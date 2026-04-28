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
import { getOpenAI, shutdownPostHog } from "./lib/openai";
import { randomUUID } from "node:crypto";
import { extractArticleContentForEmbedding } from "./lib/articleExtraction";
import { v } from "convex/values";
import { calculateCost } from "./aiBudget";
import { buildArticleFactExtractionPrompt } from "./prompts";

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

type PreparedArticle = {
  _id: string;
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

// ---------------------------------------------------------------------------
// OpenAI Embedding Generation (via PostHog-instrumented client)
// ---------------------------------------------------------------------------

/**
 * Generate embeddings for a batch of texts via OpenAI SDK.
 * When POSTHOG_API_KEY is set, token usage, cost, and latency are
 * automatically tracked in PostHog LLM Analytics.
 */
async function generateEmbeddings(
  texts: string[],
): Promise<{ embeddings: Array<number[] | null>; tokensUsed: number }> {
  const openai = await getOpenAI();

  const response = await openai.embeddings.create({
    model: EMBEDDING_MODEL,
    input: texts,
    dimensions: EMBEDDING_DIMENSIONS,
  });

  // Map back to input order
  const embeddings: Array<number[] | null> = new Array(texts.length).fill(null);
  for (const item of response.data) {
    embeddings[item.index] = item.embedding;
  }

  return { embeddings, tokensUsed: response.usage.total_tokens };
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

function safeBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
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
  raw: string,
  articleIds: Set<string>,
  maxFactsPerArticle: number,
): Map<string, string[]> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripJsonFences(raw));
  } catch (error) {
    throw new Error(
      `Fact extraction returned invalid JSON: ${error instanceof Error ? error.message : "unknown parse error"}`,
    );
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

async function extractAtomicFactsForArticles(
  ctx: any,
  articles: PreparedArticle[],
  settings: FactExtractionSettings,
): Promise<Map<string, string[]>> {
  const selectedArticles = articles
    .filter(
      (article) =>
        article.embeddingText.trim().length > 0 ||
        article.extractedSummary?.trim() ||
        article.rssSnippet?.trim(),
    )
    .slice(0, settings.maxArticles);

  if (!settings.enabled || selectedArticles.length === 0) {
    return new Map();
  }

  const budget = await ctx.runQuery(internal.aiBudget.checkBudget, {});
  if (!budget.allowed) {
    console.warn(
      `[enrichment] AI budget exhausted before fact extraction ($${budget.spentUsd}/$${budget.dailyLimitUsd}); skipping atomic facts`,
    );
    return new Map();
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
    const openai = await getOpenAI();
    const response = await openai.chat.completions.create({
      model: settings.model,
      temperature: 0,
      max_tokens: Math.min(
        3000,
        250 + selectedArticles.length * settings.maxFactsPerArticle * 32,
      ),
      response_format: {
        type: "json_schema",
        json_schema: ARTICLE_FACTS_JSON_SCHEMA,
      },
      messages: [
        { role: "system", content: prompt.system },
        { role: "user", content: prompt.user },
      ],
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error("Fact extraction returned an empty response");
    }

    const factsByArticleId = parseAtomicFactsResponse(
      content,
      new Set(selectedArticles.map((article) => article._id)),
      settings.maxFactsPerArticle,
    );

    const inputTokens = response.usage?.prompt_tokens ?? 0;
    const outputTokens = response.usage?.completion_tokens ?? 0;
    const costUsd = calculateCost(settings.model, inputTokens, outputTokens);
    const usage = await ctx.runMutation(internal.aiBudget.logUsage, {
      model: settings.model,
      operation: "extract_atomic_facts",
      inputTokens,
      outputTokens,
      costUsd,
    });
    if (!usage.allowed) {
      console.warn(
        `[enrichment] Atomic fact usage log rejected because budget would be exceeded ($${usage.spentUsd}/$${usage.dailyLimitUsd})`,
      );
    }

    const factCount = Array.from(factsByArticleId.values()).reduce(
      (sum, facts) => sum + facts.length,
      0,
    );
    console.log(
      `[enrichment] Extracted ${factCount} atomic facts across ${factsByArticleId.size} articles (${inputTokens}/${outputTokens} tokens)`,
    );

    return factsByArticleId;
  } catch (error) {
    console.error(
      `[enrichment] Atomic fact extraction failed: ${error instanceof Error ? error.message : "Unknown error"}`,
    );
    return new Map();
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
  ctx: any,
  articles: Array<{
    _id: string;
    title: string;
    url: string;
    canonicalUrl: string;
    rssSnippet?: string | null;
    publishedAt: number;
    entities?: string[];
    extractionQuality?: "strong" | "weak";
    sourceBaseBias: number;
    sourceName?: string;
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
    const { embeddings, tokensUsed } = await generateEmbeddings(texts);

    console.log(
      `[enrichment] Generated embeddings, ${tokensUsed} tokens used (${extractedCount}/${articles.length} extracted, ${fetchSuccessCount}/${articles.length} fetches succeeded, ${resolvedUrlCount}/${articles.length} URLs resolved)`,
    );

    const cost = calculateCost(EMBEDDING_MODEL, tokensUsed, 0);
    const usage = await ctx.runMutation(internal.aiBudget.logUsage, {
      model: EMBEDDING_MODEL,
      operation: "generate_embedding",
      inputTokens: tokensUsed,
      outputTokens: 0,
      costUsd: cost,
    });
    if (!usage.allowed) {
      console.warn(
        `[enrichment] AI budget would be exceeded by this run ($${usage.spentUsd}/$${usage.dailyLimitUsd}); usage was not recorded.`,
      );
    }

    const factConfig = await ctx.runQuery(internal.config.getBatch, {
      keys: [
        "article_fact_extraction_enabled",
        "article_fact_extraction_model",
        "article_fact_extraction_max_articles_per_run",
        "article_fact_extraction_max_facts_per_article",
        "article_fact_extraction_max_input_chars",
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
    const factsByArticleId = await extractAtomicFactsForArticles(
      ctx,
      preparedArticles,
      factSettings,
    );

    let enriched = 0;
    let failed = 0;
    const touchedEventIds = new Set<Id<"events">>();

    for (let i = 0; i < articles.length; i++) {
      const article = articles[i]!;
      const prepared = preparedArticles[i]!;
      const embedding = embeddings[i];

      if (embedding) {
        const result = await ctx.runMutation(
          internal.enrichment.markArticleEnriched,
          {
            articleId: article._id,
            embedding,
            aiBiasScore: article.sourceBaseBias,
            summary: prepared.extractedSummary,
            atomicFacts: factsByArticleId.get(article._id),
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
      console.log("[enrichment] Pipeline paused — skipping re-enrichment backfill");
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
