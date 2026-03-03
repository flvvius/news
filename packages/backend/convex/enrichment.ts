/**
 * Article Enrichment Pipeline — Phase 3.3 (Queries & Mutations)
 *
 * This file runs in the default Convex V8 runtime (no Node.js builtins).
 * The action that calls OpenAI lives in enrichmentNode.ts ("use node").
 */

import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";

// ---------------------------------------------------------------------------
// Internal Queries
// ---------------------------------------------------------------------------

/** Fetch a batch of unprocessed articles, oldest first. */
export const getUnprocessedArticles = internalQuery({
  args: { limit: v.number() },
  handler: async (ctx, { limit }) => {
    const articles = await ctx.db
      .query("articles")
      .withIndex("by_status", (q) => q.eq("status", "unprocessed"))
      .take(limit);

    // Also fetch source data for each article (for bias score)
    const enriched = await Promise.all(
      articles.map(async (article) => {
        const source = await ctx.db.get(article.sourceId);
        return {
          _id: article._id,
          title: article.title,
          rssSnippet: article.rssSnippet ?? "",
          sourceBaseBias: source?.baseBias ?? 0,
        };
      }),
    );

    return enriched;
  },
});

// ---------------------------------------------------------------------------
// Internal Mutations
// ---------------------------------------------------------------------------

/** Update an article's bias score, mark as enriched, and store embedding in separate table. */
export const markArticleEnriched = internalMutation({
  args: {
    articleId: v.id("articles"),
    embedding: v.array(v.number()),
    aiBiasScore: v.number(),
    version: v.number(),
  },
  handler: async (ctx, { articleId, embedding, aiBiasScore, version }) => {
    // Store embedding in dedicated table (hot/cold split)
    await ctx.db.insert("articleEmbeddings", {
      articleId,
      embedding,
      version,
    });

    // Update article status & bias score (no embedding on the article itself)
    await ctx.db.patch(articleId, {
      aiBiasScore,
      status: "enriched",
    });
  },
});

/** Mark an article as discarded (e.g. if embedding fails repeatedly). */
export const markArticleDiscarded = internalMutation({
  args: { articleId: v.id("articles") },
  handler: async (ctx, { articleId }) => {
    await ctx.db.patch(articleId, { status: "discarded" });
  },
});
