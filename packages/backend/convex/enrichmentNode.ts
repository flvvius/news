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

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** How many articles to enrich per cron run (cost control) */
const BATCH_SIZE = 50;

/** OpenAI embedding model — cheap & effective for clustering */
const EMBEDDING_MODEL = "text-embedding-3-small";

/** Embedding dimensions (text-embedding-3-small supports 512 with shortening) */
const EMBEDDING_DIMENSIONS = 512;

/** Bump when switching embedding models or dimensions to enable reprocessing */
const EMBEDDING_VERSION = 2;

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
    // 0. Check AI budget before making any API calls
    const budget = await ctx.runQuery(internal.aiBudget.checkBudget, {});
    if (!budget.allowed) {
      console.warn(
        `[enrichment] AI budget exhausted ($${budget.spentUsd}/$${budget.dailyLimitUsd}). Skipping.`,
      );
      return { enriched: 0, failed: 0, skipped: true };
    }

    // 1. Fetch unprocessed articles
    const articles = await ctx.runQuery(
      internal.enrichment.getUnprocessedArticles,
      { limit: BATCH_SIZE },
    );

    if (articles.length === 0) {
      console.log("[enrichment] No unprocessed articles to enrich");
      return { enriched: 0, failed: 0, skipped: false };
    }

    console.log(`[enrichment] Processing ${articles.length} articles`);

    // 2. Build embedding input: "Title: ... | Snippet: ..."
    const texts = articles.map((a) => {
      const snippet = (a.rssSnippet ?? "").slice(0, 500); // Cap snippet length for token budget
      return `${a.title} | ${snippet}`.trim();
    });

    try {
      // 3. Generate embeddings in batch
      const { embeddings, tokensUsed } = await generateEmbeddings(texts);

      console.log(
        `[enrichment] Generated embeddings, ${tokensUsed} tokens used`,
      );

      // 3.5 Log AI usage for cost tracking
      const { calculateCost } = await import("./aiBudget");
      const cost = calculateCost(EMBEDDING_MODEL, tokensUsed, 0);
      await ctx.runMutation(internal.aiBudget.logUsage, {
        model: EMBEDDING_MODEL,
        operation: "generate_embedding",
        inputTokens: tokensUsed,
        outputTokens: 0,
        costUsd: cost,
      });

      // 4. Update each article
      let enriched = 0;
      let failed = 0;

      for (let i = 0; i < articles.length; i++) {
        const article = articles[i]!;
        const embedding = embeddings[i];

        if (embedding) {
          await ctx.runMutation(internal.enrichment.markArticleEnriched, {
            articleId: article._id,
            embedding,
            aiBiasScore: article.sourceBaseBias,
            version: EMBEDDING_VERSION,
          });
          enriched++;
        } else {
          // Embedding generation failed for this article — discard it
          await ctx.runMutation(internal.enrichment.markArticleDiscarded, {
            articleId: article._id,
          });
          failed++;
          console.warn(
            `[enrichment] No embedding for article ${article._id}, discarded`,
          );
        }
      }

      console.log(
        `[enrichment] Done: ${enriched} enriched, ${failed} failed, ${tokensUsed} tokens`,
      );

      return { enriched, failed, tokensUsed, skipped: false };
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
