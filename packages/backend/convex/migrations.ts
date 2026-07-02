/**
 * One-time migrations. Run manually:
 *   npx convex run migrations:<functionName>
 *
 * Safe to run multiple times (idempotent — patches existing rows).
 * Can be deleted after running.
 *
 * All legacy migrations were removed after the dev DB wipe on 2026-03-05.
 */

import { mutation } from "./_generated/server";
import { api, internal } from "./_generated/api";
import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { TOPIC_CATALOG } from "./topicCatalog";
import { normalizeArticleSnippet, normalizeArticleTitle } from "./ingestion";
import { buildEventShareRenderSignature } from "./shareAssets";
import { namedAxisBias, normalizedPerspectives } from "./lib/biasAxis";

const MAX_FACT_EXTRACTION_ATTEMPTS = 3;
const MAX_BIAS_DETECTION_ATTEMPTS = 3;
const EVENT_EMBEDDING_DIMENSIONS = 512;
const MIGRATION_CONTINUATION_DELAY_MS = 500;
const DEFAULT_MIGRATION_REMAINING_PAGES = 20;

function articleHasAtomicFacts(article: {
  atomicFacts?: string[];
  status?: string;
}): boolean {
  if (article.status === "discarded") return false;
  return (article.atomicFacts ?? []).some((fact) => fact.trim().length > 0);
}

function articleNeedsFactExtraction(article: Doc<"articles">): boolean {
  if (article.status === "discarded") return false;
  if (articleHasAtomicFacts(article)) return false;
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

function articleNeedsReenrichmentForBackfill(
  article: Doc<"articles">,
  _latestEmbeddingVersion: number,
): boolean {
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

function pickLatestArticleEmbeddingRow(rows: Doc<"articleEmbeddings">[]) {
  return rows.reduce<Doc<"articleEmbeddings"> | null>((latest, row) => {
    if (!latest) return row;
    if (row.version !== latest.version) {
      return row.version > latest.version ? row : latest;
    }
    return row._creationTime > latest._creationTime ? row : latest;
  }, null);
}

export const syncTopicCatalogMigration = mutation({
  args: {},
  handler: async (ctx) => {
    const sameStringArray = (
      a: string[] | undefined,
      b: string[] | undefined,
    ): boolean =>
      (a ?? []).length === (b ?? []).length &&
      (a ?? []).every((value, index) => value === (b ?? [])[index]);

    let created = 0;
    let updated = 0;

    for (const topic of TOPIC_CATALOG) {
      const existing = await ctx.db
        .query("topics")
        .withIndex("by_slug", (q) => q.eq("slug", topic.slug))
        .unique();

      const nextValues = {
        slug: topic.slug,
        displayName: topic.displayName,
        description: topic.description,
        aliases: topic.aliases,
        keywords: topic.keywords,
        keyPhrases: topic.keyPhrases,
        excludePhrases: topic.excludePhrases,
      };

      if (!existing) {
        await ctx.db.insert("topics", nextValues);
        created++;
        continue;
      }

      const hasChanges =
        existing.displayName !== nextValues.displayName ||
        existing.description !== nextValues.description ||
        !sameStringArray(existing.aliases, nextValues.aliases) ||
        !sameStringArray(existing.keywords, nextValues.keywords) ||
        !sameStringArray(existing.keyPhrases, nextValues.keyPhrases) ||
        !sameStringArray(existing.excludePhrases, nextValues.excludePhrases);

      if (hasChanges) {
        await ctx.db.patch(existing._id, nextValues);
        updated++;
      }
    }

    return {
      created,
      updated,
      totalCatalogTopics: TOPIC_CATALOG.length,
    };
  },
});

export const normalizeStoredArticleText = mutation({
  args: {},
  handler: async (ctx) => {
    const articles = await ctx.db.query("articles").collect();
    const events = await ctx.db.query("events").collect();

    let updatedArticles = 0;
    let updatedEvents = 0;

    for (const article of articles) {
      const nextTitle = normalizeArticleTitle(article.title);
      const nextSnippet = article.rssSnippet
        ? normalizeArticleSnippet(article.rssSnippet)
        : undefined;
      const nextSummary = article.summary
        ? normalizeArticleSnippet(article.summary)
        : undefined;
      const nextAtomicFacts = article.atomicFacts?.map((fact) =>
        normalizeArticleSnippet(fact),
      );

      const atomicFactsChanged =
        (article.atomicFacts ?? []).length !== (nextAtomicFacts ?? []).length ||
        (article.atomicFacts ?? []).some(
          (fact, index) => fact !== nextAtomicFacts?.[index],
        );

      if (
        nextTitle !== article.title ||
        nextSnippet !== article.rssSnippet ||
        nextSummary !== article.summary ||
        atomicFactsChanged
      ) {
        await ctx.db.patch(article._id, {
          title: nextTitle,
          rssSnippet: nextSnippet,
          summary: nextSummary,
          atomicFacts: nextAtomicFacts,
        });
        updatedArticles++;
      }
    }

    for (const event of events) {
      const nextTitle = normalizeArticleTitle(event.title);
      // Fall back to legacy center/left/right keys so pre-BIV-303 rows keep
      // their summaries when this migration rewrites the object.
      const perspectives = normalizedPerspectives(event.perspectiveSummaries);
      const nextCenter = perspectives?.neutral
        ? normalizeArticleSnippet(perspectives.neutral)
        : undefined;
      const nextLeft = perspectives?.reformist
        ? normalizeArticleSnippet(perspectives.reformist)
        : undefined;
      const nextRight = perspectives?.suveranist
        ? normalizeArticleSnippet(perspectives.suveranist)
        : undefined;
      const nextGlobalImpact = event.globalImpact
        ? normalizeArticleSnippet(event.globalImpact)
        : undefined;

      if (
        nextTitle !== event.title ||
        nextCenter !== perspectives?.neutral ||
        nextLeft !== perspectives?.reformist ||
        nextRight !== perspectives?.suveranist ||
        nextGlobalImpact !== event.globalImpact
      ) {
        await ctx.db.patch(event._id, {
          title: nextTitle,
          perspectiveSummaries: event.perspectiveSummaries
            ? {
                neutral: nextCenter,
                reformist: nextLeft,
                suveranist: nextRight,
              }
            : undefined,
          globalImpact: nextGlobalImpact,
        });
        updatedEvents++;
      }
    }

    return {
      updatedArticles,
      updatedEvents,
    };
  },
});

export const backfillLogoUrls = mutation({
  args: {},
  handler: async (ctx) => {
    const sources = await ctx.db.query("sources").collect();
    let updated = 0;

    for (const source of sources) {
      // Skip sources that already have a curated SVG/PNG (anything not pointing at clearbit/duckduckgo/google)
      const isAutoLogo =
        !source.logoUrl ||
        source.logoUrl.includes("logo.clearbit.com") ||
        source.logoUrl.includes("icons.duckduckgo.com") ||
        source.logoUrl.includes("google.com/s2/favicons");

      if (!isAutoLogo) continue;
      if (!source.domain) continue;

      const newUrl = `https://icons.duckduckgo.com/ip3/${source.domain}.ico`;
      await ctx.db.patch(source._id, { logoUrl: newUrl });
      updated++;
    }

    return { totalSources: sources.length, updated };
  },
});

export const dedupeWaitlistByEmail = mutation({
  args: {},
  handler: async (ctx) => {
    const entries = await ctx.db.query("waitlist").collect();
    const grouped = new Map<string, typeof entries>();

    for (const entry of entries) {
      const existing = grouped.get(entry.email) ?? [];
      existing.push(entry);
      grouped.set(entry.email, existing);
    }

    const statusRank: Record<
      "pending" | "invited" | "converted" | "bounced" | "unsubscribed",
      number
    > = {
      converted: 5,
      invited: 4,
      pending: 3,
      bounced: 2,
      unsubscribed: 1,
    };

    let groupsDeduped = 0;
    let rowsDeleted = 0;

    for (const duplicates of grouped.values()) {
      if (duplicates.length < 2) continue;

      const sorted = [...duplicates].sort((a, b) => {
        const rankDiff = statusRank[b.status] - statusRank[a.status];
        if (rankDiff !== 0) return rankDiff;
        return a.createdAt - b.createdAt;
      });

      const keeper = sorted[0]!;
      const rest = sorted.slice(1);

      const merged = {
        name: keeper.name ?? rest.find((row) => row.name)?.name,
        referralSource:
          keeper.referralSource ??
          rest.find((row) => row.referralSource)?.referralSource,
        invitedAt:
          keeper.invitedAt ??
          rest.map((row) => row.invitedAt).find((value) => value !== undefined),
        convertedAt:
          keeper.convertedAt ??
          rest
            .map((row) => row.convertedAt)
            .find((value) => value !== undefined),
        lastEmailSentAt:
          keeper.lastEmailSentAt ??
          rest
            .map((row) => row.lastEmailSentAt)
            .find((value) => value !== undefined),
        inviteCode:
          keeper.inviteCode ??
          rest
            .map((row) => row.inviteCode)
            .find((value) => value !== undefined),
      };

      await ctx.db.patch(keeper._id, merged);

      for (const duplicate of rest) {
        await ctx.db.delete(duplicate._id);
        rowsDeleted++;
      }

      groupsDeduped++;
    }

    return {
      totalEntries: entries.length,
      groupsDeduped,
      rowsDeleted,
    };
  },
});

export const backfillEventSearchAndRecency = mutation({
  args: {
    cursor: v.optional(v.string()),
    pageSize: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const safePageSize = Math.min(
      Math.max(Math.floor(args.pageSize ?? 200), 1),
      2000,
    );
    const page = await ctx.db.query("events").paginate({
      cursor: args.cursor ?? null,
      numItems: safePageSize,
    });
    let updated = 0;

    for (const event of page.page) {
      const articles = await ctx.db
        .query("articles")
        .withIndex("by_event", (q) => q.eq("eventId", event._id))
        .collect();

      const latestArticlePublishedAt = articles.reduce(
        (max, article) => Math.max(max, article.publishedAt),
        event.firstPublishedAt,
      );

      const nextLastUpdatedAt = Math.max(
        event.lastUpdatedAt ?? 0,
        latestArticlePublishedAt,
      );
      if (nextLastUpdatedAt !== event.lastUpdatedAt) {
        await ctx.db.patch(event._id, {
          lastUpdatedAt: nextLastUpdatedAt,
        });
        updated++;
      }
    }

    return {
      processed: page.page.length,
      updated,
      isDone: page.isDone,
      continueCursor: page.continueCursor,
    };
  },
});

export const backfillArticleEnrichmentMetadata = mutation({
  args: {
    cursor: v.optional(v.string()),
    pageSize: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const safePageSize = Math.min(
      Math.max(Math.floor(args.pageSize ?? 100), 1),
      250,
    );
    const page = await ctx.db.query("articles").paginate({
      cursor: args.cursor ?? null,
      numItems: safePageSize,
    });

    let updatedArticles = 0;
    let dedupedEmbeddings = 0;

    for (const article of page.page) {
      const embeddingRows = await ctx.db
        .query("articleEmbeddings")
        .withIndex("by_article_version", (q) => q.eq("articleId", article._id))
        .collect();
      const latestEmbeddingRow = pickLatestArticleEmbeddingRow(embeddingRows);
      const latestEmbeddingVersion = latestEmbeddingRow?.version ?? 0;

      if (latestEmbeddingRow) {
        for (const row of embeddingRows) {
          if (row._id === latestEmbeddingRow._id) continue;
          await ctx.db.delete(row._id);
          dedupedEmbeddings++;
        }
      }

      const nextNeedsFactExtraction = articleNeedsFactExtraction(article);
      const nextNeedsReenrichment = articleNeedsReenrichmentForBackfill(
        article,
        latestEmbeddingVersion,
      );

      if (
        article.latestEmbeddingVersion !== latestEmbeddingVersion ||
        article.needsFactExtraction !== nextNeedsFactExtraction ||
        article.needsReenrichment !== nextNeedsReenrichment
      ) {
        await ctx.db.patch(article._id, {
          latestEmbeddingVersion,
          needsFactExtraction: nextNeedsFactExtraction,
          needsReenrichment: nextNeedsReenrichment,
        });
        updatedArticles++;
      }
    }

    return {
      processed: page.page.length,
      updatedArticles,
      dedupedEmbeddings,
      isDone: page.isDone,
      continueCursor: page.continueCursor,
    };
  },
});

export const queueEventShareAssetsBackfill = mutation({
  args: {
    cursor: v.optional(v.string()),
    pageSize: v.optional(v.number()),
    autoContinue: v.optional(v.boolean()),
    remainingPages: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const safePageSize = Math.min(
      Math.max(Math.floor(args.pageSize ?? 50), 1),
      200,
    );
    const page = await ctx.db
      .query("events")
      .withIndex("by_status_recency", (q) => q.eq("status", "published"))
      .order("desc")
      .paginate({
        cursor: args.cursor ?? null,
        numItems: safePageSize,
      });

    let queued = 0;

    for (const event of page.page) {
      const renderData = await ctx.runQuery(
        internal.shareAssets.getEventShareRenderData,
        {
          eventId: event._id,
        },
      );
      if (!renderData) continue;

      const result = await ctx.runMutation(
        internal.shareAssets.ensureEventShareAssetQueued,
        {
          eventId: event._id,
          renderSignature: buildEventShareRenderSignature(renderData),
        },
      );
      if (result.queued) {
        queued++;
      }
    }

    const shouldAutoContinue = args.autoContinue ?? true;
    const nextCursor = page.continueCursor ?? undefined;
    const remainingPages = Math.max(
      0,
      Math.floor(args.remainingPages ?? DEFAULT_MIGRATION_REMAINING_PAGES),
    );
    const scheduledContinuation =
      shouldAutoContinue &&
      remainingPages > 0 &&
      !page.isDone &&
      Boolean(nextCursor);

    if (scheduledContinuation && nextCursor) {
      await ctx.scheduler.runAfter(
        MIGRATION_CONTINUATION_DELAY_MS,
        api.migrations.queueEventShareAssetsBackfill,
        {
          cursor: nextCursor,
          pageSize: safePageSize,
          autoContinue: true,
          remainingPages: remainingPages - 1,
        },
      );
    }

    return {
      processed: page.page.length,
      queued,
      isDone: page.isDone,
      continueCursor: page.continueCursor,
      scheduledContinuation,
      remainingPages,
    };
  },
});

/**
 * BIV-202: the bias axis changed from left↔right to reformist↔suveranist,
 * so previously scored articles hold incomparable values. Requeue bias
 * scoring on scored, non-archived articles by flagging them for
 * re-enrichment and resetting the bias detection state. Paginated with
 * auto-continue like the other backfills.
 */
export const requeueBiasScoringForAxisChange = mutation({
  args: {
    cursor: v.optional(v.string()),
    pageSize: v.optional(v.number()),
    autoContinue: v.optional(v.boolean()),
    remainingPages: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const safePageSize = Math.min(
      Math.max(Math.floor(args.pageSize ?? 100), 1),
      200,
    );
    const page = await ctx.db.query("articles").paginate({
      cursor: args.cursor ?? null,
      numItems: safePageSize,
    });

    let requeued = 0;
    for (const article of page.page) {
      if (article.biasAnalyzedAt === undefined) continue;
      if (article.status === "archived" || article.status === "discarded") {
        continue;
      }
      await ctx.db.patch(article._id, {
        needsReenrichment: true,
        biasDetectionStatus: "deferred",
        biasDetectionAttempts: 0,
        biasAnalyzedAt: undefined,
      });
      requeued++;
    }

    const shouldAutoContinue = args.autoContinue ?? true;
    const nextCursor = page.continueCursor ?? undefined;
    const remainingPages = Math.max(
      0,
      Math.floor(args.remainingPages ?? DEFAULT_MIGRATION_REMAINING_PAGES),
    );
    const scheduledContinuation =
      shouldAutoContinue &&
      remainingPages > 0 &&
      !page.isDone &&
      Boolean(nextCursor);

    if (scheduledContinuation && nextCursor) {
      await ctx.scheduler.runAfter(
        MIGRATION_CONTINUATION_DELAY_MS,
        api.migrations.requeueBiasScoringForAxisChange,
        {
          cursor: nextCursor,
          pageSize: safePageSize,
          autoContinue: true,
          remainingPages: remainingPages - 1,
        },
      );
    }

    return {
      processed: page.page.length,
      requeued,
      isDone: page.isDone,
      continueCursor: page.continueCursor,
      scheduledContinuation,
      remainingPages,
    };
  },
});

/**
 * BIV-303: convert perspectiveSummaries from the legacy center/left/right
 * keys to neutral/reformist/suveranist on events and publicEventPreviews.
 * Idempotent — rows already on the new keys are rewritten identically and
 * skipped by the change check.
 */
export const backfillPerspectiveAxisKeys = mutation({
  args: {},
  handler: async (ctx) => {
    let updatedEvents = 0;
    let updatedPreviews = 0;

    const events = await ctx.db.query("events").collect();
    for (const event of events) {
      if (!event.perspectiveSummaries) continue;
      const legacy = event.perspectiveSummaries;
      if (
        legacy.center === undefined &&
        legacy.left === undefined &&
        legacy.right === undefined
      ) {
        continue;
      }
      await ctx.db.patch(event._id, {
        perspectiveSummaries: normalizedPerspectives(legacy),
      });
      updatedEvents++;
    }

    const previews = await ctx.db.query("publicEventPreviews").collect();
    for (const preview of previews) {
      if (!preview.perspectiveSummaries) continue;
      const legacy = preview.perspectiveSummaries;
      if (
        legacy.center === undefined &&
        legacy.left === undefined &&
        legacy.right === undefined
      ) {
        continue;
      }
      await ctx.db.patch(preview._id, {
        perspectiveSummaries: normalizedPerspectives(legacy),
      });
      updatedPreviews++;
    }

    return { updatedEvents, updatedPreviews };
  },
});

/**
 * BIV-302: backfill the named-axis bias objects from the legacy single
 * scores. Sources get `bias` from `baseBias`; articles with an
 * `aiBiasScore` get `aiBias`. Idempotent — rows that already carry the
 * object are skipped.
 */
export const backfillNamedAxisBias = mutation({
  args: {
    cursor: v.optional(v.string()),
    pageSize: v.optional(v.number()),
    autoContinue: v.optional(v.boolean()),
    remainingPages: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    // Sources are a small table — migrate them all on the first page.
    let sourcesPatched = 0;
    if (!args.cursor) {
      const sources = await ctx.db.query("sources").collect();
      for (const source of sources) {
        if (source.bias) continue;
        await ctx.db.patch(source._id, {
          bias: namedAxisBias(source.baseBias),
        });
        sourcesPatched++;
      }
    }

    const safePageSize = Math.min(
      Math.max(Math.floor(args.pageSize ?? 100), 1),
      200,
    );
    const page = await ctx.db.query("articles").paginate({
      cursor: args.cursor ?? null,
      numItems: safePageSize,
    });

    let articlesPatched = 0;
    for (const article of page.page) {
      if (article.aiBias || article.aiBiasScore === undefined) continue;
      await ctx.db.patch(article._id, {
        aiBias: namedAxisBias(article.aiBiasScore),
      });
      articlesPatched++;
    }

    const shouldAutoContinue = args.autoContinue ?? true;
    const nextCursor = page.continueCursor ?? undefined;
    const remainingPages = Math.max(
      0,
      Math.floor(args.remainingPages ?? DEFAULT_MIGRATION_REMAINING_PAGES),
    );
    const scheduledContinuation =
      shouldAutoContinue &&
      remainingPages > 0 &&
      !page.isDone &&
      Boolean(nextCursor);

    if (scheduledContinuation && nextCursor) {
      await ctx.scheduler.runAfter(
        MIGRATION_CONTINUATION_DELAY_MS,
        api.migrations.backfillNamedAxisBias,
        {
          cursor: nextCursor,
          pageSize: safePageSize,
          autoContinue: true,
          remainingPages: remainingPages - 1,
        },
      );
    }

    return {
      sourcesPatched,
      articlesProcessed: page.page.length,
      articlesPatched,
      isDone: page.isDone,
      continueCursor: page.continueCursor,
      scheduledContinuation,
      remainingPages,
    };
  },
});

export const deleteInvalidEventEmbeddingsFor512dVectorIndex = mutation({
  args: {
    cursor: v.optional(v.string()),
    pageSize: v.optional(v.number()),
    autoContinue: v.optional(v.boolean()),
    remainingPages: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const safePageSize = Math.min(
      Math.max(Math.floor(args.pageSize ?? 100), 1),
      250,
    );
    const page = await ctx.db.query("eventEmbeddings").paginate({
      cursor: args.cursor ?? null,
      numItems: safePageSize,
    });

    let deleted = 0;
    let kept = 0;
    let scheduledRecomputes = 0;

    for (const row of page.page) {
      if (row.embedding.length === EVENT_EMBEDDING_DIMENSIONS) {
        kept++;
        continue;
      }
      const eventId = row.eventId;
      await ctx.db.delete(row._id);
      await ctx.scheduler.runAfter(
        MIGRATION_CONTINUATION_DELAY_MS,
        internal.ingestion.recomputeEventEmbeddingForEventInternal,
        { eventId },
      );
      deleted++;
      scheduledRecomputes++;
    }

    const shouldAutoContinue = args.autoContinue ?? true;
    const nextCursor = page.continueCursor ?? undefined;
    const remainingPages = Math.max(
      0,
      Math.floor(args.remainingPages ?? DEFAULT_MIGRATION_REMAINING_PAGES),
    );
    const scheduledContinuation =
      shouldAutoContinue &&
      remainingPages > 0 &&
      !page.isDone &&
      Boolean(nextCursor);

    if (scheduledContinuation && nextCursor) {
      await ctx.scheduler.runAfter(
        MIGRATION_CONTINUATION_DELAY_MS,
        api.migrations.deleteInvalidEventEmbeddingsFor512dVectorIndex,
        {
          cursor: nextCursor,
          pageSize: safePageSize,
          autoContinue: true,
          remainingPages: remainingPages - 1,
        },
      );
    }

    return {
      processed: page.page.length,
      deleted,
      kept,
      scheduledRecomputes,
      isDone: page.isDone,
      continueCursor: page.continueCursor,
      scheduledContinuation,
      remainingPages,
    };
  },
});
