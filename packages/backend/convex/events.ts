import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { query } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";

const RANKED_CURSOR_PREFIX = "ranked:";
const TRENDING_SCAN_LIMIT = 250;
const TOPIC_SCAN_LIMIT = 500;

const FEED_SORT_VALIDATOR = v.union(v.literal("recent"), v.literal("trending"));

type FeedSort = "recent" | "trending";

type PublicPreviewRow = Pick<
  Doc<"publicEventPreviews">,
  | "eventId"
  | "slug"
  | "title"
  | "imageUrl"
  | "imageAlt"
  | "perspectiveSummaries"
  | "globalImpact"
  | "firstPublishedAt"
  | "lastUpdatedAt"
  | "articleCount"
  | "sourceCount"
  | "sources"
  | "sourceBiasCounts"
  | "topicIds"
  | "factualArticleCount"
  | "factualSourceCount"
  | "trendingScore"
>;

type RankedCursorPayload = {
  eventId: Id<"events">;
  score: number;
  updatedAt: number;
  firstPublishedAt: number;
};

function updatedAtForSort(event: PublicPreviewRow): number {
  return event.lastUpdatedAt;
}

function rankedPayload(
  event: PublicPreviewRow,
  sort: FeedSort,
): RankedCursorPayload {
  return {
    eventId: event.eventId,
    score: sort === "trending" ? event.trendingScore : event.lastUpdatedAt,
    updatedAt: updatedAtForSort(event),
    firstPublishedAt: event.firstPublishedAt,
  };
}

function compareRankedPayload(
  a: RankedCursorPayload,
  b: RankedCursorPayload,
): number {
  return (
    b.score - a.score ||
    b.updatedAt - a.updatedAt ||
    b.firstPublishedAt - a.firstPublishedAt ||
    String(a.eventId).localeCompare(String(b.eventId))
  );
}

function encodeRankedCursor(event: PublicPreviewRow, sort: FeedSort): string {
  return `${RANKED_CURSOR_PREFIX}${encodeURIComponent(
    JSON.stringify(rankedPayload(event, sort)),
  )}`;
}

function decodeRankedCursor(cursor: string | null): RankedCursorPayload | null {
  if (!cursor?.startsWith(RANKED_CURSOR_PREFIX)) return null;
  try {
    const parsed = JSON.parse(
      decodeURIComponent(cursor.slice(RANKED_CURSOR_PREFIX.length)),
    ) as Partial<RankedCursorPayload>;
    if (
      typeof parsed.eventId === "string" &&
      typeof parsed.score === "number" &&
      typeof parsed.updatedAt === "number" &&
      typeof parsed.firstPublishedAt === "number"
    ) {
      return parsed as RankedCursorPayload;
    }
  } catch {
    return null;
  }
  return null;
}

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

function toFeedEvent(row: PublicPreviewRow) {
  return {
    _id: row.eventId,
    slug: row.slug,
    title: row.title,
    imageUrl: row.imageUrl,
    imageAlt: row.imageAlt,
    perspectiveSummaries: row.perspectiveSummaries,
    globalImpact: row.globalImpact,
    firstPublishedAt: row.firstPublishedAt,
    lastUpdatedAt: row.lastUpdatedAt,
    topicIds: row.topicIds,
    articleCount: row.articleCount,
    sourceCount: row.sourceCount,
    sourceBiasCounts: row.sourceBiasCounts,
    sources: row.sources,
  };
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
  const candidates = await getFeedCandidates(ctx, sort, scanLimit);
  if (!topicId) return candidates;
  return candidates.filter((event) => event.topicIds.includes(topicId));
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

    const safeLimit = Math.min(Math.max(Math.floor(args.limit ?? 12), 1), 30);
    const rawMatches = await ctx.db
      .query("publicEventPreviews")
      .withSearchIndex("by_title", (q) => q.search("title", normalizedQuery))
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
    const previews = await getFeedCandidates(ctx, "recent", TOPIC_SCAN_LIMIT);
    const publishedEvents = previews
      .filter((event) =>
        event.topicIds.some((topicId) => uniqueTopicIds.includes(topicId)),
      )
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

export const getEventBySlug = query({
  args: { slug: v.string() },
  handler: async (ctx, args) => {
    const event = await ctx.db
      .query("events")
      .withIndex("by_slug", (q) => q.eq("slug", args.slug))
      .unique();

    if (!event || event.status !== "published") {
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
    const shareAsset = await ctx.db
      .query("eventShareAssets")
      .withIndex("by_event", (q) => q.eq("eventId", event._id))
      .order("desc")
      .first();
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

    return {
      event: {
        _id: event._id,
        slug: event.slug,
        title: event.title,
        imageUrl: event.imageUrl,
        imageAlt: event.imageAlt,
        perspectiveSummaries: event.perspectiveSummaries,
        globalImpact: event.globalImpact,
        firstPublishedAt: event.firstPublishedAt,
        lastUpdatedAt: event.lastUpdatedAt,
        topicIds,
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
