import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { query } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";

const RANKED_CURSOR_PREFIX = "ranked:";
const TRENDING_SCAN_LIMIT = 250;

const FEED_SORT_VALIDATOR = v.union(v.literal("recent"), v.literal("trending"));

type FeedSort = "recent" | "trending";

type EnrichableEvent = Pick<
  Doc<"events">,
  | "_id"
  | "_creationTime"
  | "slug"
  | "title"
  | "imageUrl"
  | "imageAlt"
  | "perspectiveSummaries"
  | "globalImpact"
  | "firstPublishedAt"
  | "lastUpdatedAt"
  | "factualArticleCount"
  | "factualSourceCount"
>;

type RankedCursorPayload = {
  eventId: Id<"events">;
  score: number;
  updatedAt: number;
  firstPublishedAt: number;
  createdAt: number;
};

function updatedAtForSort(event: EnrichableEvent): number {
  return event.lastUpdatedAt ?? event.firstPublishedAt;
}

function trendingScore(event: EnrichableEvent): number {
  const sourceScore = (event.factualSourceCount ?? 0) * 10;
  const articleScore = (event.factualArticleCount ?? 0) * 3;
  const recencyScore = updatedAtForSort(event) / 3_600_000;
  return sourceScore + articleScore + recencyScore;
}

function rankedPayload(
  event: EnrichableEvent,
  sort: FeedSort,
): RankedCursorPayload {
  return {
    eventId: event._id,
    score: sort === "trending" ? trendingScore(event) : event.firstPublishedAt,
    updatedAt: updatedAtForSort(event),
    firstPublishedAt: event.firstPublishedAt,
    createdAt: event._creationTime,
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
    b.createdAt - a.createdAt ||
    String(a.eventId).localeCompare(String(b.eventId))
  );
}

function encodeRankedCursor(event: EnrichableEvent, sort: FeedSort): string {
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
      typeof parsed.firstPublishedAt === "number" &&
      typeof parsed.createdAt === "number"
    ) {
      return parsed as RankedCursorPayload;
    }
  } catch {
    return null;
  }
  return null;
}

function sortEventsForFeed(events: EnrichableEvent[], sort: FeedSort) {
  return [...events].sort((a, b) => {
    if (sort === "trending") {
      return compareRankedPayload(
        rankedPayload(a, sort),
        rankedPayload(b, sort),
      );
    }

    return compareRankedPayload(rankedPayload(a, sort), rankedPayload(b, sort));
  });
}

function paginateRankedEvents(
  events: EnrichableEvent[],
  cursor: string | null,
  targetSize: number,
  sort: FeedSort,
) {
  const resumePayload = decodeRankedCursor(cursor);
  const resumeIndex = resumePayload
    ? events.findIndex((event) => event._id === resumePayload.eventId)
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

async function enrichEventsWithTopicsAndSources(
  ctx: QueryCtx,
  events: EnrichableEvent[],
) {
  const eventIds = events.map((event) => event._id);
  const allEventTopicRows = await Promise.all(
    eventIds.map((eventId) =>
      ctx.db
        .query("eventTopics")
        .withIndex("by_event", (q) => q.eq("eventId", eventId))
        .collect(),
    ),
  );
  const topicsByEventId = new Map<string, (typeof allEventTopicRows)[0]>();
  for (let i = 0; i < eventIds.length; i++) {
    topicsByEventId.set(eventIds[i]!, allEventTopicRows[i]!);
  }

  const allArticlesByEventId = new Map<Id<"events">, Doc<"articles">[]>();
  const articleRows = await Promise.all(
    eventIds.map((eventId) =>
      ctx.db
        .query("articles")
        .withIndex("by_event", (q) => q.eq("eventId", eventId))
        .collect(),
    ),
  );

  const uniqueSourceIds = new Set<Id<"sources">>();
  for (let i = 0; i < eventIds.length; i++) {
    const articles = articleRows[i] ?? [];
    allArticlesByEventId.set(eventIds[i]!, articles);
    for (const article of articles) {
      uniqueSourceIds.add(article.sourceId);
    }
  }

  const sourceRows = await Promise.all(
    Array.from(uniqueSourceIds).map(
      async (sourceId) => [sourceId, await ctx.db.get(sourceId)] as const,
    ),
  );
  const sourcesById = new Map(sourceRows);

  return events.map((event) => {
    const articles = allArticlesByEventId.get(event._id) ?? [];
    const articleCount = articles.length;
    const sourceIds = Array.from(
      new Set(articles.map((article) => article.sourceId)),
    );
    const sources = sourceIds
      .map((sourceId) => sourcesById.get(sourceId) ?? null)
      .filter((source) => source !== null);
    const topicIds = (topicsByEventId.get(event._id) ?? []).map(
      (row) => row.topicId,
    );

    return {
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
      articleCount,
      sources,
    };
  });
}

async function getRankedFeedCandidates(
  ctx: QueryCtx,
  topicId?: Id<"topics">,
): Promise<Doc<"events">[]> {
  const scanLimit = topicId ? TRENDING_SCAN_LIMIT * 2 : TRENDING_SCAN_LIMIT;
  const recentPublished = await ctx.db
    .query("events")
    .withIndex("by_status_recency", (q) => q.eq("status", "published"))
    .order("desc")
    .take(scanLimit);

  if (!topicId) return recentPublished;

  const topicMatches = await Promise.all(
    recentPublished.map(async (event) => {
      const eventTopic = await ctx.db
        .query("eventTopics")
        .withIndex("by_event_topic", (q) =>
          q.eq("eventId", event._id).eq("topicId", topicId),
        )
        .unique();
      return eventTopic ? event : null;
    }),
  );

  return topicMatches
    .filter((event): event is Doc<"events"> => event !== null)
    .slice(0, TRENDING_SCAN_LIMIT);
}

function redactPublicEventPreview(
  event: Awaited<ReturnType<typeof enrichEventsWithTopicsAndSources>>[number],
) {
  return {
    _id: event._id,
    slug: event.slug,
    title: event.title,
    imageUrl: event.imageUrl,
    imageAlt: event.imageAlt,
    firstPublishedAt: event.firstPublishedAt,
    lastUpdatedAt: event.lastUpdatedAt,
    topicIds: event.topicIds,
    articleCount: event.articleCount,
    sources: event.sources,
    perspectiveSummaries: {
      center: event.perspectiveSummaries?.center,
    },
  };
}

export const getPublishedEvents = query({
  args: {
    paginationOpts: paginationOptsValidator,
    topicId: v.optional(v.id("topics")),
    sort: v.optional(FEED_SORT_VALIDATOR),
  },
  handler: async (ctx, args) => {
    const sort = args.sort ?? "recent";

    let events;

    if (args.topicId || sort === "trending") {
      // Ranked/topic pages use bounded candidates and a cursor carrying the
      // stable sort tuple, so pagination doesn't drift between requests.
      const targetSize = args.paginationOpts.numItems;
      const publishedMatches = await getRankedFeedCandidates(ctx, args.topicId);
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
        .query("events")
        .withIndex("by_status_recency", (q) => q.eq("status", "published"))
        .order("desc")
        .paginate(paginationOpts);
    }

    const enrichedPage = await enrichEventsWithTopicsAndSources(
      ctx,
      events.page,
    );

    return {
      ...events,
      page: enrichedPage,
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
      .query("events")
      .withSearchIndex("by_search_text", (q) =>
        q.search("title", normalizedQuery).eq("status", "published"),
      )
      .take(args.topicId ? safeLimit * 4 : safeLimit);

    const enriched = await enrichEventsWithTopicsAndSources(ctx, rawMatches);
    const filtered = args.topicId
      ? enriched.filter((event) => event.topicIds.includes(args.topicId!))
      : enriched;

    return filtered.slice(0, safeLimit);
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
    const eventIds = new Set<Id<"events">>();

    await Promise.all(
      uniqueTopicIds.map(async (topicId) => {
        const rows = await ctx.db
          .query("eventTopics")
          .withIndex("by_topic", (q) => q.eq("topicId", topicId))
          .take(safeLimit * 4);
        for (const row of rows) {
          eventIds.add(row.eventId);
        }
      }),
    );

    const matchedEvents = await Promise.all(
      Array.from(eventIds).map((eventId) => ctx.db.get(eventId)),
    );

    const publishedEvents = matchedEvents
      .filter(
        (event): event is Doc<"events"> =>
          event !== null && event.status === "published",
      )
      .sort(
        (a, b) =>
          (b.lastUpdatedAt ?? b.firstPublishedAt) -
            (a.lastUpdatedAt ?? a.firstPublishedAt) ||
          b.firstPublishedAt - a.firstPublishedAt ||
          b._creationTime - a._creationTime,
      )
      .slice(0, safeLimit);

    return await enrichEventsWithTopicsAndSources(ctx, publishedEvents);
  },
});

export const getPublicPublishedEventsPreview = query({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const safeLimit = Math.min(Math.max(Math.floor(args.limit ?? 3), 1), 20);
    const candidates = await getRankedFeedCandidates(ctx);
    const events = sortEventsForFeed(candidates, "trending").slice(
      0,
      safeLimit,
    );

    const enriched = await enrichEventsWithTopicsAndSources(ctx, events);
    return enriched.map(redactPublicEventPreview);
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

    const articlesWithSources = await Promise.all(
      articles.map(async (article) => {
        const source = await ctx.db.get(article.sourceId);
        return {
          ...article,
          source,
        };
      }),
    );

    return {
      event: {
        ...event,
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
