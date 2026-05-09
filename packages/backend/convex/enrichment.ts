/**
 * Article Enrichment Pipeline — Phase 3.3 (Queries & Mutations)
 *
 * This file runs in the default Convex V8 runtime (no Node.js builtins).
 * The action that calls OpenAI lives in enrichmentNode.ts ("use node").
 */

import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { refreshEventClaimCoverage } from "./lib/eventClaimCoverage";
import { sourceBiasLabel } from "./lib/sourceBias";

const ARTICLE_FACT_STATUS_VALIDATOR = v.union(
  v.literal("pending"),
  v.literal("deferred"),
  v.literal("succeeded"),
  v.literal("succeeded_empty"),
  v.literal("failed"),
  v.literal("skipped"),
);

const ARTICLE_BIAS_STATUS_VALIDATOR = v.union(
  v.literal("deferred"),
  v.literal("succeeded"),
  v.literal("failed"),
  v.literal("skipped"),
);

const MAX_FACT_EXTRACTION_ATTEMPTS = 3;
const MAX_BIAS_DETECTION_ATTEMPTS = 3;

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
    publishedAt: article.publishedAt,
    entities: article.entities ?? [],
    extractionQuality: article.extractionQuality,
    sourceBaseBias: source.baseBias,
    sourceName: source.name,
    sourceLean: sourceBiasLabel(source),
    sourceReliability: source.reliabilityScore,
    previousStatus: article.status,
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

function hasAtomicFacts(article: Pick<Doc<"articles">, "atomicFacts" | "status">) {
  if (article.status === "discarded") return false;
  return (article.atomicFacts ?? []).some((fact) => fact.trim().length > 0);
}

function needsFactExtraction(
  article: Pick<
    Doc<"articles">,
    | "atomicFacts"
    | "status"
    | "factExtractionStatus"
    | "factExtractionAttempts"
  >,
): boolean {
  if (article.status === "discarded") return false;
  if (hasAtomicFacts(article)) return false;
  if (article.factExtractionStatus === "skipped") return false;
  if (article.factExtractionStatus === "deferred") return true;
  if (article.factExtractionStatus === "failed") {
    return (
      (article.factExtractionAttempts ?? 0) < MAX_FACT_EXTRACTION_ATTEMPTS
    );
  }
  if (article.factExtractionStatus === "succeeded") return false;
  if (article.factExtractionStatus === "succeeded_empty") return false;
  return true;
}

function articleNeedsReenrichment(
  article: Doc<"articles">,
  embeddingVersion: number,
  targetVersion: number,
): boolean {
  if (embeddingVersion < targetVersion) return true;
  if ((article.summary ?? "").trim().length < 120) return true;
  if (
    article.atomicFacts === undefined &&
    article.factExtractionStatus !== "skipped" &&
    article.factExtractionStatus !== "succeeded_empty"
  ) {
    return true;
  }
  if (
    article.factExtractionStatus === "failed" &&
    (article.factExtractionAttempts ?? 0) < MAX_FACT_EXTRACTION_ATTEMPTS
  ) {
    return true;
  }
  if (article.factExtractionStatus === "deferred") return true;
  if (
    article.biasAnalyzedAt === undefined &&
    article.biasDetectionStatus !== "skipped"
  ) {
    return true;
  }
  if (
    article.biasDetectionStatus === "failed" ||
    article.biasDetectionStatus === "deferred"
  ) {
    return (article.biasDetectionAttempts ?? 0) < MAX_BIAS_DETECTION_ATTEMPTS;
  }
  if (article.url.includes("news.google.com")) return true;
  if (article.canonicalUrl.includes("news.google.com")) return true;
  return false;
}

function deriveArticleMaintenanceFields(
  article: Doc<"articles">,
  overrides: Partial<Doc<"articles">>,
) {
  const nextArticle = {
    ...article,
    ...overrides,
  } as Doc<"articles">;

  return {
    needsFactExtraction: needsFactExtraction(nextArticle),
    needsReenrichment: articleNeedsReenrichment(
      nextArticle,
      nextArticle.latestEmbeddingVersion ?? 0,
      nextArticle.latestEmbeddingVersion ?? 0,
    ),
  };
}

async function getLatestEmbeddingVersion(
  ctx: MutationCtx,
  articleId: Doc<"articles">["_id"],
): Promise<number> {
  const latest = await ctx.db
    .query("articleEmbeddings")
    .withIndex("by_article_version", (q) => q.eq("articleId", articleId))
    .order("desc")
    .first();
  return latest?.version ?? 0;
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

    const candidateMap = new Map<string, Doc<"articles">>();
    const addCandidates = (rows: Doc<"articles">[]) => {
      for (const row of rows) {
        if (!candidateMap.has(row._id)) {
          candidateMap.set(row._id, row);
        }
      }
    };

    for (const status of ["enriched", "clustered"] as const) {
      addCandidates(
        await ctx.db
          .query("articles")
          .withIndex("by_status_latest_embedding_version", (q) =>
            q.eq("status", status).lt("latestEmbeddingVersion", targetVersion),
          )
          .take(batchSize * 2),
      );
      addCandidates(
        await ctx.db
          .query("articles")
          .withIndex("by_needs_reenrichment_status_published", (q) =>
            q.eq("needsReenrichment", true).eq("status", status),
          )
          .order("desc")
          .take(batchSize * 2),
      );
      // Compatibility path until all legacy rows have denormalized fields.
      addCandidates(
        await ctx.db
          .query("articles")
          .withIndex("by_status_published", (q) => q.eq("status", status))
          .order("desc")
          .take(batchSize),
      );
    }

    const claimed = [];
    for (const article of candidateMap.values()) {
      if (claimed.length >= batchSize) break;

      const latestVersion =
        article.latestEmbeddingVersion ??
        (await getLatestEmbeddingVersion(ctx, article._id));

      if (!articleNeedsReenrichment(article, latestVersion, targetVersion)) {
        continue;
      }

      const enriched = await toClaimedArticle(ctx, article);
      if (!enriched) continue;

      await ctx.db.patch(article._id, {
        latestEmbeddingVersion: latestVersion,
        ...deriveArticleMaintenanceFields(article, {
          latestEmbeddingVersion: latestVersion,
        }),
        status: "processing",
        enrichmentRunId: runId,
        enrichmentLeaseExpiresAt: leaseExpiresAt,
      });
      claimed.push(enriched);
    }

    return claimed;
  },
});

export const claimArticlesNeedingFactExtraction = internalMutation({
  args: {
    limit: v.number(),
    runId: v.string(),
    leaseExpiresAt: v.number(),
    beforePublishedAt: v.optional(v.number()),
    includeFailed: v.optional(v.boolean()),
    includeSucceededEmpty: v.optional(v.boolean()),
  },
  handler: async (
    ctx,
    {
      limit,
      runId,
      leaseExpiresAt,
      beforePublishedAt,
      includeFailed,
      includeSucceededEmpty,
    },
  ) => {
    const batchSize = Math.max(0, Math.floor(limit));
    if (batchSize === 0) return [];

    const now = Date.now();
    const candidateMap = new Map<string, Doc<"articles">>();
    const addCandidates = (rows: Doc<"articles">[]) => {
      for (const row of rows) {
        if (!candidateMap.has(row._id)) {
          candidateMap.set(row._id, row);
        }
      }
    };

    for (const status of ["unprocessed", "enriched", "clustered"] as const) {
      addCandidates(
        await ctx.db
          .query("articles")
          .withIndex("by_needs_fact_extraction_status_published", (q) => {
            const base = q.eq("needsFactExtraction", true).eq("status", status);
            return beforePublishedAt
              ? base.lt("publishedAt", beforePublishedAt)
              : base;
          })
          .order("desc")
          .take(batchSize),
      );
    }

    const factStatuses: Array<
      | "deferred"
      | "failed"
      | "succeeded_empty"
      | "succeeded"
    > = ["deferred"];
    if (includeFailed) {
      factStatuses.push("failed");
    }
    if (includeSucceededEmpty) {
      factStatuses.push("succeeded_empty", "succeeded");
    }

    for (const factStatus of factStatuses) {
      addCandidates(
        await ctx.db
          .query("articles")
          .withIndex("by_fact_extraction_status_published", (q) => {
            const base = q.eq("factExtractionStatus", factStatus);
            return beforePublishedAt
              ? base.lt("publishedAt", beforePublishedAt)
              : base;
          })
          .order("desc")
          .take(batchSize),
      );
    }

    // Compatibility path for legacy rows without derived fields.
    addCandidates(
      await ctx.db
        .query("articles")
        .withIndex("by_published", (q) =>
          beforePublishedAt ? q.lt("publishedAt", beforePublishedAt) : q,
        )
        .order("desc")
        .take(batchSize),
    );

    const claimed = [];
    for (const article of candidateMap.values()) {
      if (claimed.length >= batchSize) break;
      if (article.status === "discarded") continue;
      if (
        article.status === "processing" &&
        (article.enrichmentLeaseExpiresAt ?? 0) > now
      ) {
        continue;
      }
      if ((article.atomicFacts ?? []).some((fact) => fact.trim().length > 0)) {
        continue;
      }
      if (article.factExtractionStatus === "skipped") continue;
      if (article.factExtractionStatus === "deferred") {
        // Deferred rows are first-class retry candidates.
      } else if (article.factExtractionStatus === "succeeded_empty") {
        if (!includeSucceededEmpty) continue;
      } else if (article.factExtractionStatus === "succeeded") {
        if (!includeSucceededEmpty) continue;
      }
      if (article.factExtractionStatus === "failed" && !includeFailed) {
        continue;
      }
      if (
        article.factExtractionStatus === "failed" &&
        (article.factExtractionAttempts ?? 0) >= MAX_FACT_EXTRACTION_ATTEMPTS
      ) {
        continue;
      }

      const enriched = await toClaimedArticle(ctx, article);
      if (!enriched) continue;

      await ctx.db.patch(article._id, {
        ...deriveArticleMaintenanceFields(article, {}),
        status: "processing",
        enrichmentRunId: runId,
        enrichmentLeaseExpiresAt: leaseExpiresAt,
      });
      claimed.push(enriched);
    }

    return claimed;
  },
});

export const deferArticleFactExtraction = internalMutation({
  args: {
    articleId: v.id("articles"),
    runId: v.string(),
    previousStatus: v.union(
      v.literal("unprocessed"),
      v.literal("processing"),
      v.literal("enriched"),
      v.literal("clustered"),
      v.literal("discarded"),
    ),
    reason: v.string(),
    attemptedAt: v.number(),
  },
  handler: async (ctx, { articleId, runId, previousStatus, reason, attemptedAt }) => {
    const article = await ctx.db.get(articleId);
    if (
      !article ||
      article.status !== "processing" ||
      article.enrichmentRunId !== runId
    ) {
      return { updated: false, eventId: undefined };
    }

    const nextStatus =
      previousStatus === "processing" ? "unprocessed" : previousStatus;
    await ctx.db.patch(articleId, {
      ...deriveArticleMaintenanceFields(article, {
        status: nextStatus,
        factExtractionStatus: "deferred",
        factExtractionAttempts: (article.factExtractionAttempts ?? 0) + 1,
      }),
      status: nextStatus,
      enrichmentRunId: undefined,
      enrichmentLeaseExpiresAt: undefined,
      factExtractionStatus: "deferred",
      factExtractionError: reason.slice(0, 500),
      factExtractionAttempts: (article.factExtractionAttempts ?? 0) + 1,
      factExtractionLastAttemptAt: attemptedAt,
    });

    if (article.eventId) {
      await refreshEventClaimCoverage(ctx, article.eventId);
    }

    return { updated: true, eventId: article.eventId };
  },
});

export const deferArticleBiasDetection = internalMutation({
  args: {
    articleId: v.id("articles"),
    runId: v.string(),
    previousStatus: v.union(
      v.literal("unprocessed"),
      v.literal("processing"),
      v.literal("enriched"),
      v.literal("clustered"),
      v.literal("discarded"),
    ),
    reason: v.string(),
  },
  handler: async (ctx, { articleId, runId, previousStatus, reason }) => {
    const article = await ctx.db.get(articleId);
    if (
      !article ||
      article.status !== "processing" ||
      article.enrichmentRunId !== runId
    ) {
      return { updated: false, eventId: undefined };
    }

    const nextStatus =
      previousStatus === "processing" ? "unprocessed" : previousStatus;
    await ctx.db.patch(articleId, {
      ...deriveArticleMaintenanceFields(article, {
        status: nextStatus,
        biasDetectionStatus: "deferred",
        biasDetectionAttempts: (article.biasDetectionAttempts ?? 0) + 1,
      }),
      status: nextStatus,
      enrichmentRunId: undefined,
      enrichmentLeaseExpiresAt: undefined,
      biasDetectionStatus: "deferred",
      biasDetectionError: reason.slice(0, 500),
      biasDetectionAttempts: (article.biasDetectionAttempts ?? 0) + 1,
      biasDetectionLastAttemptAt: Date.now(),
    });

    return { updated: true, eventId: article.eventId };
  },
});

export const claimEventArticlesForReenrichment = internalMutation({
  args: {
    eventId: v.id("events"),
    limit: v.number(),
    runId: v.string(),
    leaseExpiresAt: v.number(),
  },
  handler: async (ctx, { eventId, limit, runId, leaseExpiresAt }) => {
    const batchSize = Math.max(0, Math.floor(limit));
    if (batchSize === 0) return [];

    const articles = await ctx.db
      .query("articles")
      .withIndex("by_event_published", (q) => q.eq("eventId", eventId))
      .order("desc")
      .take(batchSize * 3);

    const claimed = [];
    for (const article of articles) {
      if (claimed.length >= batchSize) break;
      if (article.status === "processing" || article.status === "discarded") {
        continue;
      }

      const enriched = await toClaimedArticle(ctx, article);
      if (!enriched) continue;

      await ctx.db.patch(article._id, {
        ...deriveArticleMaintenanceFields(article, {}),
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
    aiBiasScore: v.optional(v.number()),
    biasComponents: v.optional(
      v.object({
        politicalLean: v.number(),
        emotionalLanguage: v.number(),
        sourceDiversity: v.number(),
        factOpinionRatio: v.number(),
        rationale: v.string(),
      }),
    ),
    sourceBiasDelta: v.optional(v.number()),
    sourceBiasOutlierFlag: v.optional(v.boolean()),
    biasAnalyzedAt: v.optional(v.number()),
    biasDetectionStatus: v.optional(ARTICLE_BIAS_STATUS_VALIDATOR),
    biasDetectionError: v.optional(v.string()),
    summary: v.optional(v.string()),
    atomicFacts: v.optional(v.array(v.string())),
    factExtractionStatus: v.optional(ARTICLE_FACT_STATUS_VALIDATOR),
    factExtractionError: v.optional(v.string()),
    factExtractedAt: v.optional(v.number()),
    resolvedUrl: v.optional(v.string()),
    imageUrl: v.optional(v.string()),
    imageWidth: v.optional(v.number()),
    imageHeight: v.optional(v.number()),
    imageAlt: v.optional(v.string()),
    imageSource: v.optional(
      v.union(
        v.literal("og"),
        v.literal("twitter"),
        v.literal("jsonld"),
        v.literal("inline"),
      ),
    ),
    entities: v.optional(v.array(v.string())),
    extractionQuality: v.optional(
      v.union(v.literal("strong"), v.literal("weak")),
    ),
    version: v.number(),
    runId: v.string(),
  },
  handler: async (
    ctx,
    {
      articleId,
      embedding,
      aiBiasScore,
      biasComponents,
      sourceBiasDelta,
      sourceBiasOutlierFlag,
      biasAnalyzedAt,
      biasDetectionStatus,
      biasDetectionError,
      summary,
      atomicFacts,
      factExtractionStatus,
      factExtractionError,
      factExtractedAt,
      resolvedUrl,
      imageUrl,
      imageWidth,
      imageHeight,
      imageAlt,
      imageSource,
      entities,
      extractionQuality,
      version,
      runId,
    },
  ) => {
    const article = await ctx.db.get(articleId);
    if (
      !article ||
      article.status !== "processing" ||
      article.enrichmentRunId !== runId
    ) {
      return { updated: false, eventId: undefined };
    }

    const embeddingRows = await ctx.db
      .query("articleEmbeddings")
      .withIndex("by_article_version", (q) => q.eq("articleId", articleId))
      .collect();
    const latestEmbeddingRow = embeddingRows.reduce<
      Doc<"articleEmbeddings"> | null
    >((latest, row) => {
      if (!latest) return row;
      if (row.version !== latest.version) {
        return row.version > latest.version ? row : latest;
      }
      return row._creationTime > latest._creationTime ? row : latest;
    }, null);

    const shouldRecordFactAttempt =
      factExtractionStatus !== undefined &&
      factExtractionStatus !== "skipped" &&
      !(
        article.factExtractionStatus === "succeeded_empty" &&
        factExtractionStatus === "succeeded_empty"
      );
    const shouldRecordBiasAttempt =
      biasDetectionStatus !== undefined && biasDetectionStatus !== "skipped";

    // Keep a single hot embedding row per article in steady state.
    let keptEmbeddingId;
    if (latestEmbeddingRow) {
      await ctx.db.patch(latestEmbeddingRow._id, {
        embedding,
        version,
      });
      keptEmbeddingId = latestEmbeddingRow._id;
    } else {
      keptEmbeddingId = await ctx.db.insert("articleEmbeddings", {
        articleId,
        embedding,
        version,
      });
    }

    for (const row of embeddingRows) {
      if (row._id !== keptEmbeddingId) {
        await ctx.db.delete(row._id);
      }
    }

    // Update article status & bias score (no embedding on the article itself)
    const nextArticlePatch = {
      aiBiasScore: aiBiasScore ?? article.aiBiasScore,
      biasComponents: biasComponents ?? article.biasComponents,
      sourceBiasDelta: sourceBiasDelta ?? article.sourceBiasDelta,
      sourceBiasOutlierFlag:
        sourceBiasOutlierFlag ?? article.sourceBiasOutlierFlag,
      biasAnalyzedAt: biasAnalyzedAt ?? article.biasAnalyzedAt,
      ...(biasDetectionStatus !== undefined
        ? {
            biasDetectionStatus,
            biasDetectionError,
            biasDetectionAttempts: shouldRecordBiasAttempt
              ? (article.biasDetectionAttempts ?? 0) + 1
              : article.biasDetectionAttempts,
            biasDetectionLastAttemptAt: biasAnalyzedAt ?? Date.now(),
          }
        : {}),
      summary: summary ?? article.summary,
      atomicFacts: atomicFacts ?? article.atomicFacts,
      ...(factExtractionStatus !== undefined
        ? {
            factExtractionStatus,
            factExtractionError,
            factExtractedAt: factExtractedAt ?? article.factExtractedAt,
            factExtractionAttempts: shouldRecordFactAttempt
              ? (article.factExtractionAttempts ?? 0) + 1
              : article.factExtractionAttempts,
            factExtractionLastAttemptAt: factExtractedAt ?? Date.now(),
          }
        : {}),
      url: resolvedUrl ?? article.url,
      canonicalUrl: resolvedUrl ?? article.canonicalUrl,
      imageUrl: imageUrl ?? article.imageUrl,
      imageWidth: imageWidth ?? article.imageWidth,
      imageHeight: imageHeight ?? article.imageHeight,
      imageAlt: imageAlt ?? article.imageAlt ?? article.title,
      imageSource: imageSource ?? article.imageSource,
      entities: entities ?? article.entities,
      extractionQuality: extractionQuality ?? article.extractionQuality,
      latestEmbeddingVersion: version,
      status: "enriched",
      enrichmentRunId: undefined,
      enrichmentLeaseExpiresAt: undefined,
    } satisfies Partial<Doc<"articles">>;

    await ctx.db.patch(articleId, {
      ...deriveArticleMaintenanceFields(article, nextArticlePatch),
      ...nextArticlePatch,
    });

    if (article.eventId) {
      await refreshEventClaimCoverage(ctx, article.eventId);
    }

    return { updated: true, eventId: article.eventId };
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
      ...deriveArticleMaintenanceFields(article, {
        status: "discarded",
      }),
      status: "discarded",
      enrichmentRunId: undefined,
      enrichmentLeaseExpiresAt: undefined,
    });
    if (article.eventId) {
      await refreshEventClaimCoverage(ctx, article.eventId);
    }
    return { updated: true };
  },
});
