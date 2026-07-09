/**
 * One-time migrations. Run manually:
 *   npx convex run migrations:<functionName>
 *
 * Safe to run multiple times (idempotent — patches existing rows).
 * Can be deleted after running.
 *
 * All legacy migrations were removed after the dev DB wipe on 2026-03-05.
 */

import { internalMutation, mutation } from "./_generated/server";
import { api, components, internal } from "./_generated/api";
import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { syncTopicCatalogRows } from "./topics";
import { normalizeArticleSnippet, normalizeArticleTitle } from "./ingestion";
import { buildEventShareRenderSignature } from "./shareAssets";
import { namedAxisBias, normalizedPerspectives } from "./lib/biasAxis";
import { foldDiacriticsToAscii } from "./lib/romanian";
import {
  ensureUserProfileForAuthUser,
  getUserProfileByAuthUserId,
  type AuthUserForProfile,
} from "./lib/userProfile";
import { deleteByEventIndex, EVENT_CHILD_TABLES } from "./singletonCleanup";
import { syncPublicEventPreview } from "./lib/publicEventPreviews";

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

/**
 * BIV-814: create the missing app `users` (+ `userStats`) rows for Better
 * Auth users that predate the user onCreate trigger. Without the row,
 * `getCurrentUser` returns null for a fully valid session and every
 * profile-gated page renders as signed out. The session onCreate trigger in
 * auth.ts heals accounts on their next sign-in; this backfill heals accounts
 * with live sessions that won't sign in again.
 *
 *   npx convex run migrations:backfillMissingUserProfiles
 *
 * Internal (unlike the older migrations here) because it walks the auth
 * component's user table — `npx convex run` can invoke internal functions.
 */
export const backfillMissingUserProfiles = internalMutation({
  args: {
    cursor: v.optional(v.union(v.string(), v.null())),
    numItems: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const result = (await ctx.runQuery(components.betterAuth.adapter.findMany, {
      model: "user",
      paginationOpts: {
        numItems: args.numItems ?? 200,
        cursor: args.cursor ?? null,
      },
    })) as {
      page: AuthUserForProfile[];
      isDone: boolean;
      continueCursor: string;
    };

    let created = 0;
    for (const authUser of result.page) {
      const existing = await getUserProfileByAuthUserId(ctx, authUser._id);
      if (existing) continue;
      await ensureUserProfileForAuthUser(ctx, authUser);
      created++;
    }

    return {
      scanned: result.page.length,
      created,
      isDone: result.isDone,
      continueCursor: result.isDone ? null : result.continueCursor,
    };
  },
});

/**
 * BIV-813: dissolve an event whose articles were false-merged (the zf.ro
 * boilerplate-body bug) and requeue its articles for full re-enrichment, so
 * the fixed extractor rebuilds their embeddings/entities and clustering
 * re-assigns them to correct, separate events.
 *
 * Operational notes:
 * - Enrichment claims articles newest-first (by publishedAt), so requeued
 *   older articles can sit behind fresh intake. After dissolving, run
 *   enrichmentNode:enrichUnprocessedArticles repeatedly until the queue is
 *   drained, then trigger clustering.
 * - Teardown also deletes the event's userInsights and interactions rows
 *   (user saves/reads on the merged event). For a false-merged event those
 *   rows point at a meaningless mixture, so deleting them is correct — but
 *   it IS user-visible; don't reuse this for legitimate events.
 *
 *   npx convex run migrations:dissolveMisclusteredEvent '{"eventId": "..."}'
 */
export const dissolveMisclusteredEvent = internalMutation({
  args: { eventId: v.id("events") },
  handler: async (ctx, { eventId }) => {
    const event = await ctx.db.get(eventId);
    if (!event) {
      return { dissolved: false, requeuedArticles: 0 };
    }

    const articles = await ctx.db
      .query("articles")
      .withIndex("by_event", (q) => q.eq("eventId", eventId))
      .collect();

    for (const article of articles) {
      await ctx.db.patch(article._id, {
        status: "unprocessed",
        eventId: undefined,
        archivedAt: undefined,
        archivedReason: undefined,
        // Drop the summary derived from the bad extraction: re-enrichment
        // keeps the previous summary when the new run produces none
        // (storeArticleEnrichment: `summary ?? article.summary`), which
        // would leave boilerplate teaser text on screen indefinitely.
        summary: undefined,
      });
    }

    // Same child-row teardown as singletonCleanup's event dissolution.
    for (const table of EVENT_CHILD_TABLES) {
      await deleteByEventIndex(ctx, table, eventId);
    }

    await ctx.db.delete(eventId);

    return { dissolved: true, requeuedArticles: articles.length };
  },
});

/**
 * BIV-813 cleanup: articles that extracted the zf.ro teaser widget as their
 * body kept that text as their stored summary even after re-enrichment
 * (storeArticleEnrichment retains the old summary when the new run has
 * none). Clear summaries matching the boilerplate prefix so the UI stops
 * showing an unrelated teaser.
 *
 *   npx convex run migrations:clearArticleSummariesByPrefix '{"prefix": "..."}'
 */
export const clearArticleSummariesByPrefix = internalMutation({
  args: {
    prefix: v.string(),
    cursor: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    if (args.prefix.trim().length < 20) {
      throw new Error("Refusing to clear with a short/ambiguous prefix");
    }
    const page = await ctx.db.query("articles").paginate({
      cursor: args.cursor ?? null,
      numItems: 500,
    });

    let cleared = 0;
    for (const article of page.page) {
      if (article.summary?.startsWith(args.prefix)) {
        await ctx.db.patch(article._id, { summary: undefined });
        cleared++;
      }
    }

    return {
      cleared,
      isDone: page.isDone,
      continueCursor: page.isDone ? null : page.continueCursor,
    };
  },
});

export const syncTopicCatalogMigration = mutation({
  args: {},
  handler: async (ctx) => {
    return await syncTopicCatalogRows(ctx);
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

// Known image URLs that are actually HTML pages: Agerpres articles without a
// photo emit og:image pointing at their photo-detail page, which the
// extractor stored verbatim before image-byte verification existed
// (fixed in lib/imageVerification.ts).
const HTML_PAGE_IMAGE_URL_PATTERNS = ["foto.agerpres.ro/foto/detaliu/"];

function isHtmlPageImageUrl(url: string | undefined): boolean {
  if (!url) return false;
  return HTML_PAGE_IMAGE_URL_PATTERNS.some((pattern) => url.includes(pattern));
}

export const clearHtmlPageImageUrls = internalMutation({
  args: {
    cursor: v.optional(v.string()),
    pageSize: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const safePageSize = Math.min(
      Math.max(Math.floor(args.pageSize ?? 200), 1),
      1000,
    );
    const page = await ctx.db.query("articles").paginate({
      cursor: args.cursor ?? null,
      numItems: safePageSize,
    });

    let clearedArticles = 0;
    const affectedEventIds = new Set<Doc<"articles">["eventId"]>();

    for (const article of page.page) {
      if (!isHtmlPageImageUrl(article.imageUrl)) continue;
      await ctx.db.patch(article._id, {
        imageUrl: undefined,
        imageWidth: undefined,
        imageHeight: undefined,
        imageAlt: undefined,
        imageSource: undefined,
      });
      clearedArticles++;
      if (article.eventId) affectedEventIds.add(article.eventId);
    }

    let clearedEvents = 0;
    for (const eventId of affectedEventIds) {
      if (!eventId) continue;
      const event = await ctx.db.get(eventId);
      if (!event) continue;
      if (isHtmlPageImageUrl(event.imageUrl)) {
        await ctx.db.patch(eventId, {
          imageUrl: undefined,
          imageWidth: undefined,
          imageHeight: undefined,
          imageAlt: undefined,
        });
        clearedEvents++;
      }
      // Re-pick presentation (including the image) from the remaining
      // articles now that the broken candidate is gone.
      await ctx.scheduler.runAfter(
        0,
        internal.clustering.refreshEventPresentationById,
        { eventId },
      );
    }

    return {
      processed: page.page.length,
      clearedArticles,
      clearedEvents,
      isDone: page.isDone,
      continueCursor: page.continueCursor,
    };
  },
});

// Targeted variant of clearHtmlPageImageUrls for a single event, e.g. when a
// user reports one broken event photo. Only touches rows whose imageUrl
// matches a known HTML-page pattern, so it is safe to re-run.
export const clearHtmlPageImageForEventSlug = internalMutation({
  args: { slug: v.string() },
  handler: async (ctx, args) => {
    const event = await ctx.db
      .query("events")
      .withIndex("by_slug", (q) => q.eq("slug", args.slug))
      .unique();
    if (!event) return { found: false };

    const articles = await ctx.db
      .query("articles")
      .withIndex("by_event", (q) => q.eq("eventId", event._id))
      .collect();

    let clearedArticles = 0;
    for (const article of articles) {
      if (!isHtmlPageImageUrl(article.imageUrl)) continue;
      await ctx.db.patch(article._id, {
        imageUrl: undefined,
        imageWidth: undefined,
        imageHeight: undefined,
        imageAlt: undefined,
        imageSource: undefined,
      });
      clearedArticles++;
    }

    let clearedEvent = false;
    if (isHtmlPageImageUrl(event.imageUrl)) {
      await ctx.db.patch(event._id, {
        imageUrl: undefined,
        imageWidth: undefined,
        imageHeight: undefined,
        imageAlt: undefined,
      });
      clearedEvent = true;
    }

    await ctx.scheduler.runAfter(
      0,
      internal.clustering.refreshEventPresentationById,
      { eventId: event._id },
    );

    return { found: true, clearedArticles, clearedEvent };
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

/**
 * One-time cleanup for the publish-on-summary switchover: revert `published`
 * events that can never earn an AI summary (fewer than the summary min articles
 * or sources) and don't already have one, back to `processing`. Under the new
 * invariant an event is public only if it has a full AI summary; these legacy
 * rows (published under the old 2-article bar) would otherwise stay public
 * without one. Qualifying published-but-summary-less events (>= the thresholds)
 * are LEFT ALONE here — the summary backfill fills those in place.
 *
 * Idempotent. Run dry first:
 *   npx convex run --prod migrations:revertUnsummarizablePublishedEvents '{"dryRun":true}'
 *   npx convex run --prod migrations:revertUnsummarizablePublishedEvents '{"dryRun":false}'
 */
export const revertUnsummarizablePublishedEvents = internalMutation({
  args: {
    dryRun: v.optional(v.boolean()),
    minArticles: v.optional(v.number()),
    minSources: v.optional(v.number()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const dryRun = args.dryRun ?? true;
    const minArticles = args.minArticles ?? 3;
    const minSources = args.minSources ?? 2;
    const scanLimit = Math.min(Math.max(args.limit ?? 2000, 1), 5000);

    const published = await ctx.db
      .query("events")
      .withIndex("by_status_recency", (q) => q.eq("status", "published"))
      .order("desc")
      .take(scanLimit);

    let scanned = 0;
    let reverted = 0;
    const samples: Array<{
      eventId: string;
      title: string;
      articleCount: number;
      sourceCount: number;
    }> = [];

    for (const event of published) {
      scanned++;
      const perspectives = normalizedPerspectives(event.perspectiveSummaries);
      const hasFullAiSummary = Boolean(
        perspectives?.neutral?.trim() &&
          perspectives?.reformist?.trim() &&
          perspectives?.suveranist?.trim() &&
          event.globalImpact?.trim() &&
          event.lastSummarizedAt,
      );
      const articleCount = event.articleCount ?? 1;
      const sourceCount = event.sourceCount ?? 1;
      const canQualify =
        articleCount >= minArticles && sourceCount >= minSources;

      // Leave alone: anything that already has a summary, or that still
      // qualifies for one (the backfill will summarize those in place).
      if (hasFullAiSummary || canQualify) continue;

      if (samples.length < 20) {
        samples.push({
          eventId: String(event._id),
          title: event.title,
          articleCount,
          sourceCount,
        });
      }
      reverted++;

      if (!dryRun) {
        await ctx.db.patch(event._id, { status: "processing" });
        // Now that status !== "published", this deletes the public preview.
        await syncPublicEventPreview(ctx, event._id);
      }
    }

    return {
      dryRun,
      minArticles,
      minSources,
      scannedPublished: scanned,
      reverted,
      samples,
    };
  },
});

/**
 * Backfill `searchText` on existing publicEventPreviews so the diacritic-
 * insensitive search index covers rows written before the field existed.
 * Run: npx convex run migrations:backfillPreviewSearchText
 */
export const backfillPreviewSearchText = mutation({
  args: {
    cursor: v.optional(v.string()),
    pageSize: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const safePageSize = Math.min(
      Math.max(Math.floor(args.pageSize ?? 500), 1),
      2000,
    );
    const page = await ctx.db.query("publicEventPreviews").paginate({
      cursor: args.cursor ?? null,
      numItems: safePageSize,
    });
    let updated = 0;

    for (const preview of page.page) {
      const searchText = foldDiacriticsToAscii(preview.title);
      if (preview.searchText !== searchText) {
        await ctx.db.patch(preview._id, { searchText });
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
