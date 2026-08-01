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
import { truncateThirdPartySnippet } from "./lib/compliance";
import { isRateLimitError } from "./lib/aiCall";
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
/**
 * L2 (Art. 94¹) — truncate already-stored third-party display text to the
 * 120-char "very short extract" ceiling: articles.rssSnippet and
 * articles.summary. Heuristic event summaries are rewritten by the next
 * clustering pass; AI summaries are our own text and unaffected.
 */
export const backfillSnippetCeiling = internalMutation({
  args: {
    cursor: v.optional(v.string()),
    pageSize: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const safePageSize = Math.min(
      Math.max(Math.floor(args.pageSize ?? 200), 1),
      500,
    );
    const page = await ctx.db.query("articles").paginate({
      cursor: args.cursor ?? null,
      numItems: safePageSize,
    });
    let updated = 0;

    for (const article of page.page) {
      const nextSnippet = truncateThirdPartySnippet(article.rssSnippet);
      const nextSummary = truncateThirdPartySnippet(article.summary);
      const patch: Partial<Doc<"articles">> = {};
      if (article.rssSnippet !== undefined && nextSnippet !== article.rssSnippet) {
        patch.rssSnippet = nextSnippet;
      }
      if (article.summary !== undefined && nextSummary !== article.summary) {
        patch.summary = nextSummary;
      }
      if (Object.keys(patch).length > 0) {
        await ctx.db.patch(article._id, patch);
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

/**
 * L1 (AI Act art. 50(4)) — stamp the AI-disclosure fields onto every event
 * that already carries an AI summary, plus mirror aiGenerated/humanReviewed
 * onto its public preview. The model that produced legacy summaries was not
 * recorded, so those rows get "unrecorded".
 */
export const backfillAiDisclosureFields = internalMutation({
  args: {
    cursor: v.optional(v.string()),
    pageSize: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const safePageSize = Math.min(
      Math.max(Math.floor(args.pageSize ?? 200), 1),
      500,
    );
    const page = await ctx.db.query("events").paginate({
      cursor: args.cursor ?? null,
      numItems: safePageSize,
    });
    let updated = 0;

    for (const event of page.page) {
      const hasSummary = Boolean(
        normalizedPerspectives(event.perspectiveSummaries)?.neutral?.trim() ||
          event.globalImpact?.trim() ||
          event.lastSummarizedAt,
      );
      if (!hasSummary || event.aiGenerated !== undefined) continue;
      await ctx.db.patch(event._id, {
        aiGenerated: true,
        humanReviewed: false,
        modelUsed: event.modelUsed ?? "unrecorded",
        promptVersion:
          event.promptVersion ??
          String(event.lastSummaryPromptVersion ?? "pre-l1"),
      });
      updated++;
    }

    return {
      processed: page.page.length,
      updated,
      isDone: page.isDone,
      continueCursor: page.continueCursor,
    };
  },
});

/** L1 companion: mirror aiGenerated/humanReviewed onto existing previews. */
export const backfillPreviewAiDisclosure = internalMutation({
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
      if (preview.aiGenerated !== undefined) continue;
      await ctx.db.patch(preview._id, {
        aiGenerated: true,
        humanReviewed: false,
      });
      updated++;
    }
    return {
      processed: page.page.length,
      updated,
      isDone: page.isDone,
      continueCursor: page.continueCursor,
    };
  },
});

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

/**
 * COST MODE — force the stored config rows that override the code defaults.
 *
 * `config.getBatch` resolves a key from the `config` table and only falls back
 * to the seeded default when the row is ABSENT. Prod already has rows for most
 * of the expensive knobs, so editing the defaults in config.ts is not enough on
 * its own — those rows have to be rewritten. This migration does that.
 *
 * (`event_summary_body_fetch_enabled` is the exception: it has no row in prod,
 * so the new `false` default takes effect on deploy without this migration.
 * It is written here anyway so the state is explicit and identical everywhere.)
 *
 * Idempotent. Run dry first:
 *   npx convex run --prod migrations:applyCostReductionConfig '{"dryRun":true}'
 *   npx convex run --prod migrations:applyCostReductionConfig '{"dryRun":false}'
 *
 * Afterwards refresh the pipeline snapshot so running jobs pick the values up:
 *   npx convex run --prod config:refreshPipelineRuntimeConfig '{}'
 */
export const applyCostReductionConfig = internalMutation({
  args: {
    dryRun: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const dryRun = args.dryRun ?? true;

    // Value encoding must match config.setInternal / config.getBatch: the
    // `value` column holds a JSON-encoded string, not the raw scalar.
    const targets: Array<{ key: string; value: unknown; why: string }> = [
      {
        key: "event_summary_body_fetch_enabled",
        value: false,
        why: "up to 12 billed network fetches per summary job — the single most expensive operation in the app",
      },
      {
        key: "event_summary_batch_size",
        value: 12,
        why: "summaries gate publishing, so throughput must keep pace with eligible events (~48/day at 4 runs/day) while staying inside Gemini free-tier RPM",
      },
      {
        key: "event_summary_enqueue_limit",
        value: 40,
        why: "unchanged from the previous default — the 2.15 GB I/O was fixed by cadence (32 runs/day to 4), and lowering depth would starve the publish queue",
      },
      {
        key: "event_summary_max_input_articles",
        value: 6,
        why: "prompt size drives data egress and model latency, both billed",
      },
      {
        key: "pipeline_alert_check_interval_minutes",
        value: 720,
        why: "must track the check-pipeline-alerts cron (now 2x daily) or absent-run alerts fire spuriously",
      },
      {
        key: "article_embedding_retention_days",
        value: 45,
        why: "caps unbounded articleEmbeddings storage growth; clustering's widest lookback is 48h",
      },
      {
        key: "archived_article_retention_days",
        value: 90,
        why: "deletes articles archived as stale singletons, which belong to no event",
      },
    ];

    const changed: Array<{ key: string; from: string | null; to: string }> = [];
    const unchanged: string[] = [];

    for (const target of targets) {
      const encoded = JSON.stringify(target.value);
      const row = await ctx.db
        .query("config")
        .withIndex("by_key", (q) => q.eq("key", target.key))
        .unique();

      if (row && row.value === encoded) {
        unchanged.push(target.key);
        continue;
      }

      changed.push({
        key: target.key,
        from: row ? row.value : null,
        to: encoded,
      });

      if (dryRun) continue;

      if (row) {
        await ctx.db.patch(row._id, {
          value: encoded,
          updatedAt: Date.now(),
        });
      } else {
        await ctx.db.insert("config", {
          key: target.key,
          value: encoded,
          description: target.why,
          updatedAt: Date.now(),
        });
      }
    }

    return { dryRun, changedCount: changed.length, changed, unchanged };
  },
});

/**
 * COST MODE — revive summary jobs that were killed by Gemini rate limits.
 *
 * Before the backpressure fix, a 429 called `markSummaryJobFailed`, consuming
 * one of only 3 attempts. In prod this left ~395 jobs parked at attempts=3 with
 * a far-future `nextAttemptAt`, permanently dead — the direct cause of the
 * "only ~31% of events ever get summarized" problem. Rate limiting is
 * backpressure, not a failure of the job, so those jobs deserve another run.
 *
 * Only revives jobs whose recorded error looks like a rate limit. Jobs that
 * failed for real reasons (blocked_ungrounded, blocked_verbatim, empty
 * response) are LEFT ALONE — re-running those would just burn budget again.
 *
 * Idempotent, and bounded so a single call cannot blow the transaction limit.
 * Run repeatedly until `remaining` is 0:
 *   npx convex run --prod migrations:requeueRateLimitedSummaryJobs '{"dryRun":true}'
 *   npx convex run --prod migrations:requeueRateLimitedSummaryJobs '{"dryRun":false}'
 */
export const requeueRateLimitedSummaryJobs = internalMutation({
  args: {
    dryRun: v.optional(v.boolean()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const dryRun = args.dryRun ?? true;
    const limit = Math.min(Math.max(args.limit ?? 200, 1), 500);

    const failed = await ctx.db
      .query("eventSummaryJobs")
      .withIndex("by_status_updatedAt", (q) => q.eq("status", "failed"))
      .order("desc")
      .take(1000);

    // Share the runtime's rate-limit detection so this migration classifies
    // jobs exactly the way the summarization defer path does — a divergence
    // here would revive the wrong jobs, or silently miss the right ones.
    const candidates = failed.filter((job) => isRateLimitError(job.lastError));

    const now = Date.now();
    let requeued = 0;

    for (const job of candidates.slice(0, limit)) {
      if (!dryRun) {
        await ctx.db.patch(job._id, {
          status: "queued",
          attempts: 0,
          nextAttemptAt: now,
          lastError: undefined,
          processingRunId: undefined,
          leaseExpiresAt: undefined,
          updatedAt: now,
        });
      }
      requeued++;
    }

    return {
      dryRun,
      scannedFailed: failed.length,
      rateLimited: candidates.length,
      requeued,
      remaining: Math.max(candidates.length - requeued, 0),
      skippedRealFailures: failed.length - candidates.length,
    };
  },
});

/**
 * COST MODE — reclaim orphaned Convex file storage.
 *
 * Prod file storage sits at ~992 MB against a 1 GB free allowance, but
 * `eventShareAssets.storageId` is the ONLY `v.id("_storage")` reference in the
 * entire schema (see schema.ts), and that table is empty in prod. Every stored
 * file is therefore unreachable: they are share-asset images generated before
 * the 2026-07-07 prod database wipe, which cleared the rows but left the blobs
 * behind. Share-asset generation is intentionally disabled, so nothing will
 * ever reference them again.
 *
 * DESTRUCTIVE AND IRREVERSIBLE. Deleted blobs cannot be recovered. The guard
 * below re-derives the live reference set at run time rather than trusting the
 * analysis above, so it stays correct if share assets are ever re-enabled.
 *
 * Paginated. Run dry first and confirm `wouldDelete` matches expectations, then
 * run for real, feeding `continueCursor` back in as `cursor` until `isDone`:
 *   npx convex run --prod migrations:purgeOrphanedStorageFiles '{"dryRun":true}'
 *   npx convex run --prod migrations:purgeOrphanedStorageFiles '{"dryRun":false}'
 *   npx convex run --prod migrations:purgeOrphanedStorageFiles '{"dryRun":false,"cursor":"<continueCursor>"}'
 */
export const purgeOrphanedStorageFiles = internalMutation({
  args: {
    dryRun: v.optional(v.boolean()),
    limit: v.optional(v.number()),
    cursor: v.optional(v.union(v.string(), v.null())),
  },
  handler: async (ctx, args) => {
    const dryRun = args.dryRun ?? true;
    const limit = Math.min(Math.max(args.limit ?? 200, 1), 500);

    // Re-derive the live reference set instead of assuming it is empty.
    const referenced = new Set<string>();
    for (const asset of await ctx.db.query("eventShareAssets").collect()) {
      if (asset.storageId) referenced.add(asset.storageId);
    }

    // Paginate rather than repeatedly `take`-ing from the head of the table.
    // Retained (referenced) files stay at the head forever, so a head scan
    // would re-examine them on every call and could never reach the rows behind
    // them. In a dry run nothing is deleted at all, so a head scan would simply
    // return the same page every time.
    const page = await ctx.db.system
      .query("_storage")
      .paginate({ numItems: limit, cursor: args.cursor ?? null });

    let removed = 0;
    let deletedBytes = 0;
    let kept = 0;

    for (const file of page.page) {
      if (referenced.has(file._id)) {
        kept++;
        continue;
      }
      removed++;
      deletedBytes += file.size ?? 0;
      if (!dryRun) {
        await ctx.storage.delete(file._id);
      }
    }

    return {
      dryRun,
      referencedCount: referenced.size,
      scanned: page.page.length,
      kept,
      [dryRun ? "wouldDelete" : "deleted"]: removed,
      approxMbReclaimed: Number((deletedBytes / 1048576).toFixed(2)),
      // Feed this back in as `cursor` to continue; `isDone` means the whole
      // table has been walked, not merely that this page was clean.
      isDone: page.isDone,
      continueCursor: page.isDone ? null : page.continueCursor,
    };
  },
});
