/**
 * Article Enrichment Pipeline — Phase 3.3 (Queries & Mutations)
 *
 * This file runs in the default Convex V8 runtime (no Node.js builtins).
 * The action that calls OpenAI lives in enrichmentNode.ts ("use node").
 */

import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";

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
    const enriched = (
      await Promise.all(
        articles.map(async (article) => {
          const source = await ctx.db.get(article.sourceId);
          if (!source) {
            console.error(
              `[enrichment] Missing source ${article.sourceId} for article ${article._id} — skipping`,
            );
            return null;
          }
          return {
            _id: article._id,
            title: article.title,
            url: article.url,
            canonicalUrl: article.canonicalUrl,
            rssSnippet: article.rssSnippet ?? "",
            sourceBaseBias: source.baseBias,
          };
        }),
      )
    ).filter((a) => a !== null);

    return enriched;
  },
});

// ---------------------------------------------------------------------------
// Internal Mutations
// ---------------------------------------------------------------------------

async function toClaimedArticle(
  ctx: MutationCtx,
  article: Doc<"articles">,
) {
  const source = await ctx.db.get(article.sourceId);
  if (!source) {
    console.error(
      `[enrichment] Missing source ${article.sourceId} for article ${article._id} — skipping`,
    );
    return null;
  }

  return {
    _id: article._id,
    title: article.title,
    url: article.url,
    canonicalUrl: article.canonicalUrl,
    rssSnippet: article.rssSnippet ?? "",
    sourceBaseBias: source.baseBias,
  };
}

/** Atomically claim unprocessed or expired-lease articles for one enrichment run. */
export const claimUnprocessedArticles = internalMutation({
  args: {
    limit: v.number(),
    runId: v.string(),
    leaseExpiresAt: v.number(),
  },
  handler: async (ctx, { limit, runId, leaseExpiresAt }) => {
    const now = Date.now();
    const batchSize = Math.max(0, Math.floor(limit));
    if (batchSize === 0) return [];

    const freshArticles = await ctx.db
      .query("articles")
      .withIndex("by_status", (q) => q.eq("status", "unprocessed"))
      .take(batchSize);

    const remaining = batchSize - freshArticles.length;
    const expiredLeases =
      remaining > 0
        ? await ctx.db
            .query("articles")
            .withIndex("by_status_enrichment_lease", (q) =>
              q
                .eq("status", "processing")
                .lte("enrichmentLeaseExpiresAt", now),
            )
            .take(remaining)
        : [];

    const candidates = [...freshArticles, ...expiredLeases];
    const claimed = [];

    for (const article of candidates) {
      const enriched = await toClaimedArticle(ctx, article);
      if (!enriched) continue;

      await ctx.db.patch(article._id, {
        status: "processing",
        enrichmentRunId: runId,
        enrichmentLeaseExpiresAt: leaseExpiresAt,
      });
      claimed.push(enriched);
    }

    return claimed;
  },
});

function articleNeedsReenrichment(
  article: Doc<"articles">,
  embeddingVersion: number,
  targetVersion: number,
): boolean {
  if (embeddingVersion < targetVersion) return true;
  if ((article.summary ?? "").trim().length < 120) return true;
  if (article.url.includes("news.google.com")) return true;
  if (article.canonicalUrl.includes("news.google.com")) return true;
  return false;
}

export const claimArticlesForReenrichment = internalMutation({
  args: {
    limit: v.number(),
    runId: v.string(),
    leaseExpiresAt: v.number(),
    targetVersion: v.number(),
  },
  handler: async (ctx, { limit, runId, leaseExpiresAt, targetVersion }) => {
    const batchSize = Math.max(0, Math.floor(limit));
    if (batchSize === 0) return [];

    const candidates: Doc<"articles">[] = [];
    for (const status of ["enriched", "clustered"] as const) {
      const rows = await ctx.db
        .query("articles")
        .withIndex("by_status", (q) => q.eq("status", status))
        .take(batchSize * 4);
      candidates.push(...rows);
      if (candidates.length >= batchSize * 4) break;
    }

    const claimed = [];
    for (const article of candidates) {
      if (claimed.length >= batchSize) break;

      const embeddingRows = await ctx.db
        .query("articleEmbeddings")
        .withIndex("by_article", (q) => q.eq("articleId", article._id))
        .collect();
      const latestVersion = embeddingRows.reduce(
        (maxVersion, row) => Math.max(maxVersion, row.version),
        0,
      );

      if (!articleNeedsReenrichment(article, latestVersion, targetVersion)) {
        continue;
      }

      const enriched = await toClaimedArticle(ctx, article);
      if (!enriched) continue;

      await ctx.db.patch(article._id, {
        status: "processing",
        enrichmentRunId: runId,
        enrichmentLeaseExpiresAt: leaseExpiresAt,
      });
      claimed.push(enriched);
    }

    return claimed;
  },
});

/** Update an article's bias score, mark as enriched, and store embedding in separate table. */
export const markArticleEnriched = internalMutation({
  args: {
    articleId: v.id("articles"),
    embedding: v.array(v.number()),
    aiBiasScore: v.number(),
    summary: v.optional(v.string()),
    resolvedUrl: v.optional(v.string()),
    version: v.number(),
    runId: v.string(),
  },
  handler: async (
    ctx,
    { articleId, embedding, aiBiasScore, summary, resolvedUrl, version, runId },
  ) => {
    const article = await ctx.db.get(articleId);
    if (
      !article ||
      article.status !== "processing" ||
      article.enrichmentRunId !== runId
    ) {
      return { updated: false };
    }

    const existingEmbeddings = await ctx.db
      .query("articleEmbeddings")
      .withIndex("by_article", (q) => q.eq("articleId", articleId))
      .collect();
    for (const row of existingEmbeddings) {
      await ctx.db.delete(row._id);
    }

    // Store embedding in dedicated table (hot/cold split)
    await ctx.db.insert("articleEmbeddings", {
      articleId,
      embedding,
      version,
    });

    // Update article status & bias score (no embedding on the article itself)
    await ctx.db.patch(articleId, {
      aiBiasScore,
      summary: summary ?? article.summary,
      url: resolvedUrl ?? article.url,
      canonicalUrl: resolvedUrl ?? article.canonicalUrl,
      status: "enriched",
      enrichmentRunId: undefined,
      enrichmentLeaseExpiresAt: undefined,
    });

    return { updated: true };
  },
});

/** Mark an article as discarded (e.g. if embedding fails repeatedly). */
export const markArticleDiscarded = internalMutation({
  args: { articleId: v.id("articles"), runId: v.string() },
  handler: async (ctx, { articleId, runId }) => {
    const article = await ctx.db.get(articleId);
    if (
      !article ||
      article.status !== "processing" ||
      article.enrichmentRunId !== runId
    ) {
      return { updated: false };
    }

    await ctx.db.patch(articleId, {
      status: "discarded",
      enrichmentRunId: undefined,
      enrichmentLeaseExpiresAt: undefined,
    });
    return { updated: true };
  },
});
