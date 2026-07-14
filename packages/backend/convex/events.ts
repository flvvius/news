import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { internalMutation, query } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import {
  compareRankedPayload,
  decodeRankedCursor,
  encodeRankedCursor,
  rankedPayload,
  RANKED_CURSOR_PREFIX,
  toFeedEvent,
  type FeedSort,
  type PublicPreviewRow,
} from "./lib/feedSerialization";
import {
  rebuildPublicFeedSnapshots,
  syncPublicEventPreview,
} from "./lib/publicEventPreviews";
import { filterEventImage } from "./lib/imagePolicy";
import { normalizedPerspectives } from "./lib/biasAxis";
import { foldDiacriticsToAscii } from "./lib/romanian";
import { getConfig } from "./config";
import { EVENT_SHARE_ASSET_GENERATION_ENABLED_KEY } from "./shareAssets";

const TRENDING_SCAN_LIMIT = 250;
const TOPIC_SCAN_LIMIT = 500;

const FEED_SORT_VALIDATOR = v.union(v.literal("recent"), v.literal("trending"));

function sortEventsForFeed(events: PublicPreviewRow[], sort: FeedSort) {
  return [...events].sort((a, b) => {
    return compareRankedPayload(rankedPayload(a, sort), rankedPayload(b, sort));
  });
}

function paginateRankedEvents(
  events: PublicPreviewRow[],
  cursor: string | null,
  targetSize: number,
  sort: FeedSort,
) {
  const resumePayload = decodeRankedCursor(cursor);
  const resumeIndex = resumePayload
    ? events.findIndex((event) => event.eventId === resumePayload.eventId)
    : -1;
  const startIndex =
    resumeIndex >= 0
      ? resumeIndex + 1
      : resumePayload
        ? events.findIndex(
            (event) =>
              compareRankedPayload(rankedPayload(event, sort), resumePayload) >
              0,
          )
        : 0;
  const normalizedStartIndex = startIndex >= 0 ? startIndex : events.length;
  const page = events.slice(
    normalizedStartIndex,
    normalizedStartIndex + targetSize,
  );
  const isDone = normalizedStartIndex + page.length >= events.length;
  const lastReturned = page[page.length - 1];

  return {
    page,
    isDone,
    continueCursor:
      isDone || !lastReturned ? "" : encodeRankedCursor(lastReturned, sort),
  };
}

function snapshotKey(sort: FeedSort) {
  return `anonymous:first-page:${sort}`;
}

async function getTopicFeedCandidates(
  ctx: QueryCtx,
  topicId: Id<"topics">,
  sort: FeedSort,
  limit: number = TOPIC_SCAN_LIMIT,
) {
  const rows =
    sort === "trending"
      ? await ctx.db
          .query("publicEventPreviewTopics")
          .withIndex("by_topic_trending", (q) => q.eq("topicId", topicId))
          .order("desc")
          .take(limit)
      : await ctx.db
          .query("publicEventPreviewTopics")
          .withIndex("by_topic_updated", (q) => q.eq("topicId", topicId))
          .order("desc")
          .take(limit);
  const previews = await Promise.all(rows.map((row) => ctx.db.get(row.previewId)));
  return previews.filter(
    (preview): preview is Doc<"publicEventPreviews"> => preview !== null,
  );
}

async function getFeedCandidates(
  ctx: QueryCtx,
  sort: FeedSort,
  scanLimit: number,
) {
  if (sort === "trending") {
    return await ctx.db
      .query("publicEventPreviews")
      .withIndex("by_trending_score")
      .order("desc")
      .take(scanLimit);
  }

  return await ctx.db
    .query("publicEventPreviews")
    .withIndex("by_last_updated_at")
    .order("desc")
    .take(scanLimit);
}

async function getRankedFeedCandidates(
  ctx: QueryCtx,
  topicId: Id<"topics"> | undefined,
  sort: FeedSort,
) {
  const scanLimit = topicId ? TOPIC_SCAN_LIMIT : TRENDING_SCAN_LIMIT;
  if (topicId) {
    return await getTopicFeedCandidates(ctx, topicId, sort);
  }
  return await getFeedCandidates(ctx, sort, scanLimit);
}

export const getPublishedEvents = query({
  args: {
    paginationOpts: paginationOptsValidator,
    topicId: v.optional(v.id("topics")),
    sort: v.optional(FEED_SORT_VALIDATOR),
  },
  handler: async (ctx, args) => {
    const sort = args.sort ?? "trending";

    let events;

    // Anonymous trending first-page acceleration. The trending feed otherwise
    // requires an expensive ranked scan on every cold load. Serve the cached
    // snapshot for the first page, then hand pagination back to the live ranked
    // query via the stored `ranked:` cursor so the feed never dead-ends at the
    // snapshot size. (Recent is a cheap indexed pagination and is not cached.)
    if (
      sort === "trending" &&
      !args.topicId &&
      args.paginationOpts.cursor === null
    ) {
      const snapshot = await ctx.db
        .query("publicFeedSnapshots")
        .withIndex("by_key", (q) => q.eq("key", snapshotKey("trending")))
        .unique();
      if (snapshot) {
        try {
          const parsed = JSON.parse(snapshot.payloadJson) as {
            items: ReturnType<typeof toFeedEvent>[];
            cursors: string[];
          };
          const items = parsed.items ?? [];
          if (items.length === 0) {
            return { page: [], isDone: true, continueCursor: "" };
          }
          const page = items.slice(0, args.paginationOpts.numItems);
          const boundaryIndex =
            Math.min(page.length, parsed.cursors.length) - 1;
          const continueCursor =
            boundaryIndex >= 0 ? (parsed.cursors[boundaryIndex] ?? "") : "";
          return {
            page,
            isDone: continueCursor === "",
            continueCursor,
          };
        } catch (error) {
          console.error(
            "[events] Failed to parse public feed snapshot:",
            error,
          );
          // Fall through to the live query path below.
        }
      }
    }

    if (args.topicId || sort === "trending") {
      const targetSize = args.paginationOpts.numItems;
      const publishedMatches = await getRankedFeedCandidates(
        ctx,
        args.topicId,
        sort,
      );
      const sortedMatches = sortEventsForFeed(publishedMatches, sort);

      events = paginateRankedEvents(
        sortedMatches,
        args.paginationOpts.cursor,
        targetSize,
        sort,
      );
    } else {
      // Defensive reset in case a ranked cursor is reused after ranked mode is
      // cleared.
      const paginationOpts = args.paginationOpts.cursor?.startsWith(
        RANKED_CURSOR_PREFIX,
      )
        ? { ...args.paginationOpts, cursor: null }
        : args.paginationOpts;

      events = await ctx.db
        .query("publicEventPreviews")
        .withIndex("by_last_updated_at")
        .order("desc")
        .paginate(paginationOpts);
    }

    return {
      ...events,
      page: events.page.map(toFeedEvent),
    };
  },
});

// Crawlable feed archive (/feed?page=N): fixed, index-backed pages in
// recent order, so every published event stays reachable through the
// next/previous anchor chain regardless of trending churn. Offset paging
// costs page*pageSize rows per read, hence the hard scan cap.
const ARCHIVE_MAX_SCAN = 4000;
const ARCHIVE_DEFAULT_PAGE_SIZE = 20;

export const getPublishedEventsArchivePage = query({
  args: {
    page: v.number(),
    pageSize: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const pageSize = Math.min(
      Math.max(Math.floor(args.pageSize ?? ARCHIVE_DEFAULT_PAGE_SIZE), 1),
      50,
    );
    const page = Math.max(Math.floor(args.page), 1);
    const maxPage = Math.floor(ARCHIVE_MAX_SCAN / pageSize);
    if (page > maxPage) {
      // Never serve duplicate content under an out-of-range URL; the web
      // loader turns an empty page into a 404.
      return { page, pageSize, events: [], hasMore: false };
    }

    const rows = await ctx.db
      .query("publicEventPreviews")
      .withIndex("by_last_updated_at")
      .order("desc")
      .take(page * pageSize + 1);
    const start = (page - 1) * pageSize;

    return {
      page,
      pageSize,
      events: rows.slice(start, start + pageSize).map(toFeedEvent),
      hasMore: rows.length > page * pageSize,
    };
  },
});

export const searchPublishedEvents = query({
  args: {
    query: v.string(),
    limit: v.optional(v.number()),
    topicId: v.optional(v.id("topics")),
  },
  handler: async (ctx, args) => {
    const normalizedQuery = args.query.trim();
    if (normalizedQuery.length < 2) {
      return [];
    }

    // Fold the query the same way `searchText` is stored so diacritics on
    // either side don't block a match ("bucuresti" ↔ "București").
    const searchQuery = foldDiacriticsToAscii(normalizedQuery);
    const safeLimit = Math.min(Math.max(Math.floor(args.limit ?? 12), 1), 30);
    const rawMatches = await ctx.db
      .query("publicEventPreviews")
      .withSearchIndex("by_title", (q) => q.search("searchText", searchQuery))
      .take(args.topicId ? safeLimit * 4 : safeLimit);

    const filtered = args.topicId
      ? rawMatches.filter((event) => event.topicIds.includes(args.topicId!))
      : rawMatches;

    return filtered.slice(0, safeLimit).map(toFeedEvent);
  },
});

export const getPublishedEventsByTopicIds = query({
  args: {
    topicIds: v.array(v.id("topics")),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const uniqueTopicIds = Array.from(new Set(args.topicIds));
    if (uniqueTopicIds.length === 0) {
      return [];
    }

    const safeLimit = Math.min(Math.max(Math.floor(args.limit ?? 5), 1), 20);
    const previews = (
      await Promise.all(
        uniqueTopicIds.map((topicId) =>
          getTopicFeedCandidates(ctx, topicId, "recent", safeLimit),
        ),
      )
    ).flat();
    const seen = new Set<string>();
    const publishedEvents = previews
      .filter((event) => {
        const key = String(event.eventId);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .sort(
        (a, b) =>
          b.lastUpdatedAt - a.lastUpdatedAt ||
          b.firstPublishedAt - a.firstPublishedAt ||
          String(b.eventId).localeCompare(String(a.eventId)),
      )
      .slice(0, safeLimit);

    return publishedEvents.map(toFeedEvent);
  },
});

export const getPublicPublishedEventsPreview = query({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const safeLimit = Math.min(Math.max(Math.floor(args.limit ?? 3), 1), 20);
    const events = await ctx.db
      .query("publicEventPreviews")
      .withIndex("by_trending_score")
      .order("desc")
      .take(safeLimit);
    return events.map(toFeedEvent);
  },
});

export const getSitemapPublishedEvents = query({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const safeLimit = Math.min(
      Math.max(Math.floor(args.limit ?? 5000), 1),
      10000,
    );
    const events = await ctx.db
      .query("publicEventPreviews")
      .withIndex("by_last_updated_at")
      .order("desc")
      .take(safeLimit);

    return events.map((event) => ({
      slug: event.slug,
      lastModifiedAt: event.lastUpdatedAt,
    }));
  },
});

/**
 * Recent published events for syndication feeds (/rss.xml and
 * /news-sitemap.xml). Newest first by publication time, thin-page gated: an
 * event with no neutral AI summary is mostly third-party RSS text and must not
 * be syndicated (mirrors the sitemap discipline). Returns the fields the feeds
 * need — the web layer derives the short headline and truncates copy.
 */
export const getSyndicationEvents = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const safeLimit = Math.min(Math.max(Math.floor(args.limit ?? 50), 1), 100);
    // Over-fetch, then keep only summarized events until we have `safeLimit`.
    const rows = await ctx.db
      .query("publicEventPreviews")
      .withIndex("by_first_published_at")
      .order("desc")
      .take(safeLimit * 4);

    const events: Array<{
      slug: string;
      title: string;
      summary: string;
      firstPublishedAt: number;
      lastUpdatedAt: number;
    }> = [];
    for (const event of rows) {
      const neutral = event.perspectiveSummaries?.neutral?.trim();
      if (!neutral) continue;
      events.push({
        slug: event.slug,
        title: event.title,
        summary: neutral,
        firstPublishedAt: event.firstPublishedAt,
        lastUpdatedAt: event.lastUpdatedAt,
      });
      if (events.length >= safeLimit) break;
    }
    return events;
  },
});

export const backfillPublicPreviewReadModels = internalMutation({
  args: {
    cursor: v.optional(v.string()),
    pageSize: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const pageSize = Math.min(Math.max(Math.floor(args.pageSize ?? 100), 1), 500);
    const page = await ctx.db.query("publicEventPreviews").paginate({
      cursor: args.cursor ?? null,
      numItems: pageSize,
    });

    for (const preview of page.page) {
      const existingRows = await ctx.db
        .query("publicEventPreviewTopics")
        .withIndex("by_event", (q) => q.eq("eventId", preview.eventId))
        .collect();
      const existingByTopic = new Map(
        existingRows.map((row) => [String(row.topicId), row]),
      );
      const nextTopicIds = new Set(
        preview.topicIds.map((topicId) => String(topicId)),
      );

      for (const topicId of preview.topicIds) {
        const existing = existingByTopic.get(String(topicId));
        const payload = {
          previewId: preview._id,
          lastUpdatedAt: preview.lastUpdatedAt,
          firstPublishedAt: preview.firstPublishedAt,
          trendingScore: preview.trendingScore,
          updatedAt: Date.now(),
        };
        if (existing) {
          await ctx.db.patch(existing._id, payload);
        } else {
          await ctx.db.insert("publicEventPreviewTopics", {
            topicId,
            eventId: preview.eventId,
            ...payload,
          });
        }
      }

      for (const row of existingRows) {
        if (!nextTopicIds.has(String(row.topicId))) {
          await ctx.db.delete(row._id);
        }
      }
    }

    if (page.isDone) {
      // Rebuild the anonymous trending snapshot once the read-model backfill
      // has populated every preview/topic row.
      await rebuildPublicFeedSnapshots(ctx);
    }

    return {
      processed: page.page.length,
      isDone: page.isDone,
      continueCursor: page.continueCursor,
    };
  },
});

export const rebuildPublicFeedSnapshotsJob = internalMutation({
  args: {},
  handler: async (ctx) => {
    await rebuildPublicFeedSnapshots(ctx);
    return { rebuilt: true as const };
  },
});

// One-shot migration for the trending-score reweight (recency 6pts/hr + coverage
// cap). `trendingScore` is written once per preview and never recomputed by a
// cron, so existing rows keep their old-formula scores — whose magnitude differs
// enough from the new formula to scramble ordering — until re-synced. This
// re-runs the normal, idempotent preview write path (which recomputes the score)
// for every existing preview, then rebuilds the anonymous snapshot on the final
// page. Paginate by feeding `continueCursor` back until `isDone`.
export const rescorePublicPreviews = internalMutation({
  args: {
    cursor: v.optional(v.string()),
    pageSize: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const pageSize = Math.min(
      Math.max(Math.floor(args.pageSize ?? 100), 1),
      500,
    );
    const page = await ctx.db.query("publicEventPreviews").paginate({
      cursor: args.cursor ?? null,
      numItems: pageSize,
    });

    for (const preview of page.page) {
      await syncPublicEventPreview(ctx, preview.eventId);
    }

    if (page.isDone) {
      await rebuildPublicFeedSnapshots(ctx);
    }

    return {
      processed: page.page.length,
      isDone: page.isDone,
      continueCursor: page.continueCursor,
    };
  },
});

export const getEventBySlug = query({
  args: { slug: v.string() },
  handler: async (ctx, args) => {
    const event = await ctx.db
      .query("events")
      .withIndex("by_slug", (q) => q.eq("slug", args.slug))
      .unique();

    // L8: an unpublished event is gone from public view instantly — the
    // route renders its not-found state.
    if (!event || event.status !== "published" || event.unpublishedAt) {
      return null;
    }

    // Load topic IDs from junction table
    const eventTopicRows = await ctx.db
      .query("eventTopics")
      .withIndex("by_event", (q) => q.eq("eventId", event._id))
      .collect();
    const topicIds = eventTopicRows.map((r) => r.topicId);

    const articles = await ctx.db
      .query("articles")
      .withIndex("by_event", (q) => q.eq("eventId", event._id))
      .collect();
    // Custom social preview images are gated by a single kill switch. While it
    // is off (dev and prod), never serve a generated share asset — even if the
    // DB still holds "ready" rows from a previous run — so the OG/share image
    // falls back to the original event photo below.
    const shareAssetsEnabled = await getConfig(
      ctx,
      EVENT_SHARE_ASSET_GENERATION_ENABLED_KEY,
      false,
    );
    const shareAsset = shareAssetsEnabled
      ? await ctx.db
          .query("eventShareAssets")
          .withIndex("by_event", (q) => q.eq("eventId", event._id))
          .order("desc")
          .first()
      : null;
    const shareImageUrl =
      shareAsset?.status === "ready" && shareAsset.storageId
        ? await ctx.storage.getUrl(shareAsset.storageId)
        : null;

    const sourceIds = Array.from(
      new Set(articles.map((article) => article.sourceId)),
    );
    const sourceRows = await Promise.all(
      sourceIds.map((sourceId) => ctx.db.get(sourceId)),
    );
    const sourcesById = new Map(
      sourceRows
        .filter((source): source is Doc<"sources"> => source !== null)
        .map((source) => [source._id, source]),
    );
    const articlesWithSources = articles.map((article) => ({
      ...article,
      source: sourcesById.get(article.sourceId) ?? null,
    }));

    // L9: publisher og:image is a hotlinked thumbnail displayed only while
    // the global + per-domain switches allow it.
    const allowedImageUrl = await filterEventImage(ctx, event);

    return {
      event: {
        _id: event._id,
        slug: event.slug,
        title: event.title,
        imageUrl: allowedImageUrl,
        imageAlt: allowedImageUrl ? event.imageAlt : undefined,
        perspectiveSummaries: normalizedPerspectives(
          event.perspectiveSummaries,
        ),
        perspectiveApplicable: event.perspectiveApplicable,
        globalImpact: event.globalImpact,
        firstPublishedAt: event.firstPublishedAt,
        lastUpdatedAt: event.lastUpdatedAt,
        topicIds,
        // L1 (AI Act art. 50(4)) — machine-readable disclosure. Published
        // events all carry AI summaries, so pre-backfill gaps default to
        // aiGenerated=true / humanReviewed=false rather than hiding the label.
        aiGenerated: event.aiGenerated ?? true,
        humanReviewed: event.humanReviewed ?? false,
        modelUsed: event.modelUsed,
        promptVersion: event.promptVersion,
        shareImageUrl: shareImageUrl ?? undefined,
        shareImageWidth:
          shareAsset?.status === "ready" ? shareAsset.width : undefined,
        shareImageHeight:
          shareAsset?.status === "ready" ? shareAsset.height : undefined,
      },
      articles: articlesWithSources,
    };
  },
});
