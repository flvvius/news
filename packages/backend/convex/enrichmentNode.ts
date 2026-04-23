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
import { getOpenAI, shutdownPostHog } from "./lib/openai";
import { randomUUID } from "node:crypto";
import { extractArticleContentForEmbedding } from "./lib/articleExtraction";
import { v } from "convex/values";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** How many articles to enrich per cron run (cost control) */
const BATCH_SIZE = 50;

/** How long a claimed article can remain processing before another run retries it. */
const ARTICLE_LEASE_TTL_MS = 15 * 60 * 1000;

/** OpenAI embedding model — cheap & effective for clustering */
const EMBEDDING_MODEL = "text-embedding-3-small";

/** Embedding dimensions (text-embedding-3-small supports 512 with shortening) */
const EMBEDDING_DIMENSIONS = 512;

/** Bump when switching embedding models or dimensions to enable reprocessing */
const EMBEDDING_VERSION = 4;

/** How many article pages to fetch/extract in parallel inside one batch. */
const EXTRACTION_CONCURRENCY = 5;

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
    sourceBaseBias: number;
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

    const { calculateCost } = await import("./aiBudget");
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

    let enriched = 0;
    let failed = 0;

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
            resolvedUrl: prepared.resolvedUrl,
            version: EMBEDDING_VERSION,
            runId,
          },
        );
        if (result.updated) {
          enriched++;
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
