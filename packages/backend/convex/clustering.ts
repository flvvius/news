/**
 * Basic article clustering pipeline — Phase 3.5
 *
 * Goal:
 *  - Take `enriched` articles with embeddings
 *  - Match them against recent events using embedding similarity + title overlap
 *  - Create or update published events
 *  - Attach `eventId` to articles and move them to `clustered`
 *
 * This is intentionally a minimal first pass:
 *  - No AI summarization yet
 *  - No claim extraction yet
 *  - No topic inference yet
 *  - Center summary falls back to RSS snippet when present
 */

import { v } from "convex/values";
import {
  internalAction,
  internalMutation,
  internalQuery,
} from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

const CLUSTER_LOCK_KEY = "clusterEnrichedArticles";
const CLUSTER_LOCK_TTL_MS = 20 * 60 * 1000;
const CLUSTER_BATCH_SIZE = 40;
const RECENT_EVENT_WINDOW_MS = 72 * 60 * 60 * 1000;
const MAX_CANDIDATE_EVENTS = 150;
const EVENT_EMBEDDING_DIMENSIONS = 1536;
const MIN_CLUSTER_SIMILARITY = 0.82;
const STRONG_CLUSTER_SIMILARITY = 0.9;
const MIN_TITLE_TOKEN_OVERLAP = 2;

const STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "by",
  "for",
  "from",
  "in",
  "into",
  "is",
  "it",
  "of",
  "on",
  "or",
  "that",
  "the",
  "their",
  "this",
  "to",
  "with",
]);

function toEventEmbedding(articleEmbedding: number[]): number[] {
  const padded = new Array(EVENT_EMBEDDING_DIMENSIONS).fill(0);
  const limit = Math.min(articleEmbedding.length, EVENT_EMBEDDING_DIMENSIONS);
  for (let i = 0; i < limit; i++) {
    padded[i] = articleEmbedding[i]!;
  }
  return padded;
}

function cosineSimilarity(a: number[], b: number[]): number {
  const length = Math.min(a.length, b.length);
  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < length; i++) {
    const av = a[i] ?? 0;
    const bv = b[i] ?? 0;
    dot += av * bv;
    normA += av * av;
    normB += bv * bv;
  }

  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

function normalizeTitleTokens(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .map((token) => token.trim())
      .filter((token) => token.length >= 3 && !STOPWORDS.has(token)),
  );
}

function countTokenOverlap(a: Set<string>, b: Set<string>): number {
  let overlap = 0;
  for (const token of a) {
    if (b.has(token)) overlap++;
  }
  return overlap;
}

function slugify(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 80);
  return slug.length > 0 ? slug : "event";
}

function buildEventSlug(
  title: string,
  publishedAt: number,
  articleId: Id<"articles">,
): string {
  const ymd = new Date(publishedAt).toISOString().slice(0, 10);
  const suffix = String(articleId).replace(/[^a-zA-Z0-9]/g, "").slice(-6);
  return `${slugify(title)}-${ymd}-${suffix}`.toLowerCase();
}

type ClusterCandidate = {
  eventId: Id<"events">;
  title: string;
  firstPublishedAt: number;
  articleCount: number;
  embedding: number[];
  titleTokens: Set<string>;
};

function findBestCandidate(
  article: {
    title: string;
    publishedAt: number;
    embedding: number[];
  },
  candidates: ClusterCandidate[],
): ClusterCandidate | null {
  const articleEmbedding = toEventEmbedding(article.embedding);
  const articleTokens = normalizeTitleTokens(article.title);

  let best: { candidate: ClusterCandidate; similarity: number } | null = null;

  for (const candidate of candidates) {
    if (
      Math.abs(article.publishedAt - candidate.firstPublishedAt) >
      RECENT_EVENT_WINDOW_MS
    ) {
      continue;
    }

    const similarity = cosineSimilarity(articleEmbedding, candidate.embedding);
    const overlap = countTokenOverlap(articleTokens, candidate.titleTokens);
    const matches =
      similarity >= STRONG_CLUSTER_SIMILARITY ||
      (similarity >= MIN_CLUSTER_SIMILARITY &&
        overlap >= MIN_TITLE_TOKEN_OVERLAP);

    if (!matches) continue;

    if (!best || similarity > best.similarity) {
      best = { candidate, similarity };
    }
  }

  return best?.candidate ?? null;
}

export const getEnrichedArticlesForClustering = internalQuery({
  args: { limit: v.number() },
  handler: async (ctx, { limit }) => {
    const articles = await ctx.db
      .query("articles")
      .withIndex("by_status", (q) => q.eq("status", "enriched"))
      .take(limit);

    const enriched = (
      await Promise.all(
        articles.map(async (article) => {
          const embeddingRow = await ctx.db
            .query("articleEmbeddings")
            .withIndex("by_article", (q) => q.eq("articleId", article._id))
            .first();

          if (!embeddingRow) {
            console.warn(
              `[clustering] Missing embedding for enriched article ${article._id}; skipping`,
            );
            return null;
          }

          return {
            _id: article._id,
            title: article.title,
            rssSnippet: article.rssSnippet ?? "",
            publishedAt: article.publishedAt,
            embedding: embeddingRow.embedding,
          };
        }),
      )
    ).filter((article) => article !== null);

    return enriched;
  },
});

export const getRecentClusterCandidates = internalQuery({
  args: {
    sinceTs: v.number(),
    limit: v.number(),
  },
  handler: async (ctx, { sinceTs, limit }) => {
    const events = await ctx.db
      .query("events")
      .withIndex("by_status_recency", (q) => q.eq("status", "published"))
      .order("desc")
      .take(limit);

    const candidates = (
      await Promise.all(
        events
          .filter((event) => event.firstPublishedAt >= sinceTs)
          .map(async (event) => {
            const embeddingRow = await ctx.db
              .query("eventEmbeddings")
              .withIndex("by_event", (q) => q.eq("eventId", event._id))
              .first();

            if (!embeddingRow) return null;

            const articleCount = (
              await ctx.db
                .query("articles")
                .withIndex("by_event", (q) => q.eq("eventId", event._id))
                .collect()
            ).length;

            return {
              eventId: event._id,
              title: event.title,
              firstPublishedAt: event.firstPublishedAt,
              articleCount,
              embedding: embeddingRow.embedding,
            };
          }),
      )
    ).filter((candidate) => candidate !== null);

    return candidates;
  },
});

export const createEventFromArticle = internalMutation({
  args: {
    articleId: v.id("articles"),
    title: v.string(),
    slug: v.string(),
    publishedAt: v.number(),
    centerSummary: v.optional(v.string()),
    eventEmbedding: v.array(v.number()),
    version: v.number(),
  },
  handler: async (
    ctx,
    { articleId, title, slug, publishedAt, centerSummary, eventEmbedding, version },
  ) => {
    const article = await ctx.db.get(articleId);
    if (!article || article.status !== "enriched") {
      return { created: false as const };
    }

    const eventId = await ctx.db.insert("events", {
      title,
      slug,
      perspectiveSummaries: centerSummary
        ? { center: centerSummary }
        : undefined,
      status: "published",
      firstPublishedAt: publishedAt,
    });

    await ctx.db.insert("eventEmbeddings", {
      eventId,
      embedding: eventEmbedding,
      version,
    });

    await ctx.db.patch(articleId, {
      eventId,
      status: "clustered",
    });

    return {
      created: true as const,
      eventId,
      title,
      slug,
      firstPublishedAt: publishedAt,
      articleCount: 1,
      embedding: eventEmbedding,
    };
  },
});

export const attachArticleToEvent = internalMutation({
  args: {
    articleId: v.id("articles"),
    eventId: v.id("events"),
    publishedAt: v.number(),
    eventEmbedding: v.array(v.number()),
    version: v.number(),
  },
  handler: async (
    ctx,
    { articleId, eventId, publishedAt, eventEmbedding, version },
  ) => {
    const article = await ctx.db.get(articleId);
    const event = await ctx.db.get(eventId);

    if (!article || !event || article.status !== "enriched") {
      return { updated: false as const };
    }

    const existingArticles = await ctx.db
      .query("articles")
      .withIndex("by_event", (q) => q.eq("eventId", eventId))
      .collect();
    const currentCount = existingArticles.length;

    await ctx.db.patch(articleId, {
      eventId,
      status: "clustered",
    });

    const existingEmbeddingRow = await ctx.db
      .query("eventEmbeddings")
      .withIndex("by_event", (q) => q.eq("eventId", eventId))
      .first();

    const nextEmbedding =
      existingEmbeddingRow && currentCount > 0
        ? existingEmbeddingRow.embedding.map(
            (value, index) =>
              (value * currentCount + (eventEmbedding[index] ?? 0)) /
              (currentCount + 1),
          )
        : eventEmbedding;

    if (existingEmbeddingRow) {
      await ctx.db.patch(existingEmbeddingRow._id, {
        embedding: nextEmbedding,
        version,
      });
    } else {
      await ctx.db.insert("eventEmbeddings", {
        eventId,
        embedding: nextEmbedding,
        version,
      });
    }

    const nextFirstPublishedAt = Math.min(event.firstPublishedAt, publishedAt);
    if (nextFirstPublishedAt !== event.firstPublishedAt) {
      await ctx.db.patch(eventId, {
        firstPublishedAt: nextFirstPublishedAt,
      });
    }

    return {
      updated: true as const,
      eventId,
      title: event.title,
      slug: event.slug,
      firstPublishedAt: nextFirstPublishedAt,
      articleCount: currentCount + 1,
      embedding: nextEmbedding,
    };
  },
});

export const clusterEnrichedArticles = internalAction({
  args: {},
  handler: async (
    ctx,
  ): Promise<{
    clusteredIntoExisting: number;
    createdEvents: number;
    skipped: number;
  }> => {
    const paused = await ctx.runQuery(internal.config.isPipelinePaused, {});
    if (paused) {
      console.log("[clustering] Pipeline paused — skipping clustering");
      return {
        clusteredIntoExisting: 0,
        createdEvents: 0,
        skipped: 0,
      };
    }

    const lockOwner = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const lock = await ctx.runMutation(internal.ingestion.acquirePipelineLock, {
      key: CLUSTER_LOCK_KEY,
      owner: lockOwner,
      expiresAt: Date.now() + CLUSTER_LOCK_TTL_MS,
    });

    if (!lock.acquired) {
      console.log(
        `[clustering] clusterEnrichedArticles already running (owner=${lock.owner}, expiresAt=${new Date(lock.expiresAt).toISOString()})`,
      );
      return {
        clusteredIntoExisting: 0,
        createdEvents: 0,
        skipped: 0,
      };
    }

    try {
      const articles = await ctx.runQuery(
        internal.clustering.getEnrichedArticlesForClustering,
        { limit: CLUSTER_BATCH_SIZE },
      );

      if (articles.length === 0) {
        console.log("[clustering] No enriched articles to cluster");
        return {
          clusteredIntoExisting: 0,
          createdEvents: 0,
          skipped: 0,
        };
      }

      const recentCandidatesRaw = await ctx.runQuery(
        internal.clustering.getRecentClusterCandidates,
        {
          sinceTs: Date.now() - RECENT_EVENT_WINDOW_MS,
          limit: MAX_CANDIDATE_EVENTS,
        },
      );

      const candidates: ClusterCandidate[] = recentCandidatesRaw.map(
        (candidate) => ({
          ...candidate,
          titleTokens: normalizeTitleTokens(candidate.title),
        }),
      );

      let clusteredIntoExisting = 0;
      let createdEvents = 0;
      let skipped = 0;

      for (const article of articles) {
        const paddedEmbedding = toEventEmbedding(article.embedding);
        const match = findBestCandidate(article, candidates);

        if (match) {
          const result = await ctx.runMutation(
            internal.clustering.attachArticleToEvent,
            {
              articleId: article._id,
              eventId: match.eventId,
              publishedAt: article.publishedAt,
              eventEmbedding: paddedEmbedding,
              version: 1,
            },
          );

          if (!result.updated) {
            skipped++;
            continue;
          }

          clusteredIntoExisting++;

          const candidate = candidates.find((c) => c.eventId === match.eventId);
          if (candidate) {
            candidate.embedding = result.embedding;
            candidate.articleCount = result.articleCount;
            candidate.firstPublishedAt = result.firstPublishedAt;
          }
          continue;
        }

        const slug = buildEventSlug(article.title, article.publishedAt, article._id);
        const centerSummary =
          article.rssSnippet.trim().length > 0
            ? article.rssSnippet.trim().slice(0, 280)
            : undefined;

        const result = await ctx.runMutation(
          internal.clustering.createEventFromArticle,
          {
            articleId: article._id,
            title: article.title,
            slug,
            publishedAt: article.publishedAt,
            centerSummary,
            eventEmbedding: paddedEmbedding,
            version: 1,
          },
        );

        if (!result.created) {
          skipped++;
          continue;
        }

        createdEvents++;
        candidates.unshift({
          eventId: result.eventId,
          title: result.title,
          firstPublishedAt: result.firstPublishedAt,
          articleCount: result.articleCount,
          embedding: result.embedding,
          titleTokens: normalizeTitleTokens(result.title),
        });
      }

      console.log(
        `[clustering] Done: ${clusteredIntoExisting} attached, ${createdEvents} new events, ${skipped} skipped`,
      );

      return {
        clusteredIntoExisting,
        createdEvents,
        skipped,
      };
    } finally {
      try {
        await ctx.runMutation(internal.ingestion.releasePipelineLock, {
          key: CLUSTER_LOCK_KEY,
          owner: lockOwner,
        });
      } catch (error) {
        console.error(
          `[clustering] Failed to release cluster lock: ${error instanceof Error ? error.message : "Unknown error"}`,
        );
      }
    }
  },
});
