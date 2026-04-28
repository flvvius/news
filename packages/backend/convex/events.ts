import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { query } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { requireBetaAccess } from "./lib/betaAccess";

const TOPIC_CURSOR_PREFIX = "topic:";
const RANKED_CURSOR_PREFIX = "ranked:";
const TRENDING_SCAN_LIMIT = 250;

const FEED_SORT_VALIDATOR = v.union(
  v.literal("recent"),
  v.literal("trending"),
);

function encodeTopicCursor(eventId: Id<"events">): string {
  return `${TOPIC_CURSOR_PREFIX}${eventId}`;
}

function decodeTopicCursor(cursor: string | null): Id<"events"> | null {
  if (!cursor?.startsWith(TOPIC_CURSOR_PREFIX)) return null;
  return cursor.slice(TOPIC_CURSOR_PREFIX.length) as Id<"events">;
}

function encodeRankedCursor(eventId: Id<"events">): string {
  return `${RANKED_CURSOR_PREFIX}${eventId}`;
}

function decodeRankedCursor(cursor: string | null): Id<"events"> | null {
  if (!cursor?.startsWith(RANKED_CURSOR_PREFIX)) return null;
  return cursor.slice(RANKED_CURSOR_PREFIX.length) as Id<"events">;
}

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

function trendingScore(event: EnrichableEvent, now: number): number {
  const sourceScore = (event.factualSourceCount ?? 0) * 10;
  const articleScore = (event.factualArticleCount ?? 0) * 3;
  const updatedAt = event.lastUpdatedAt ?? event.firstPublishedAt;
  const ageHours = Math.max(0, (now - updatedAt) / 3_600_000);
  const recencyScore = Math.max(0, 48 - ageHours);
  return sourceScore + articleScore + recencyScore;
}

function sortEventsForFeed(
  events: EnrichableEvent[],
  sort: "recent" | "trending",
) {
  const now = Date.now();
  return [...events].sort((a, b) => {
    if (sort === "trending") {
      return (
        trendingScore(b, now) - trendingScore(a, now) ||
        (b.lastUpdatedAt ?? b.firstPublishedAt) -
          (a.lastUpdatedAt ?? a.firstPublishedAt) ||
        b.firstPublishedAt - a.firstPublishedAt ||
        b._creationTime - a._creationTime
      );
    }

    return (
      b.firstPublishedAt - a.firstPublishedAt ||
      b._creationTime - a._creationTime
    );
  });
}

function paginateRankedEvents(
  events: EnrichableEvent[],
  cursor: string | null,
  targetSize: number,
) {
  const resumeAfterId = decodeRankedCursor(cursor) ?? decodeTopicCursor(cursor);
  const resumeIndex = resumeAfterId
    ? events.findIndex((event) => event._id === resumeAfterId)
    : -1;
  const startIndex = resumeIndex >= 0 ? resumeIndex + 1 : 0;
  const page = events.slice(startIndex, startIndex + targetSize);
  const isDone = startIndex + page.length >= events.length;
  const lastReturned = page[page.length - 1];

  return {
    page,
    isDone,
    continueCursor:
      isDone || !lastReturned ? "" : encodeRankedCursor(lastReturned._id),
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
    await requireBetaAccess(ctx);
    const sort = args.sort ?? "recent";

    // When filtering by topic, collect matching IDs first so pagination can
    // resume after the last matching event returned to the client.
    let matchingEventIds: Set<Id<"events">> | null = null;
    if (args.topicId) {
      const eventTopicRows = await ctx.db
        .query("eventTopics")
        .withIndex("by_topic", (q) => q.eq("topicId", args.topicId!))
        .collect();
      matchingEventIds = new Set(eventTopicRows.map((r) => r.eventId));
    }

    let events;

    if (matchingEventIds !== null || sort === "trending") {
      // Topic filtering uses a custom cursor based on the last returned event.
      // This avoids dropping matching events that appear later in an over-fetched
      // database page after the UI page has already reached its target size.
      const targetSize = args.paginationOpts.numItems;
      const matchingEvents =
        matchingEventIds !== null
          ? await Promise.all(
              Array.from(matchingEventIds).map((eventId) => ctx.db.get(eventId)),
            )
          : await ctx.db
              .query("events")
              .withIndex("by_status_recency", (q) =>
                q.eq("status", "published"),
              )
              .order("desc")
              .take(TRENDING_SCAN_LIMIT);
      const publishedMatches = matchingEvents
        .filter(
          (event): event is Doc<"events"> =>
            event !== null && event.status === "published",
        );
      const sortedMatches = sortEventsForFeed(publishedMatches, sort);

      events = paginateRankedEvents(
        sortedMatches,
        args.paginationOpts.cursor,
        targetSize,
      );
    } else {
      // Defensive reset in case a topic cursor is reused after the topic filter
      // is cleared.
      const paginationOpts =
        args.paginationOpts.cursor?.startsWith(TOPIC_CURSOR_PREFIX) ||
        args.paginationOpts.cursor?.startsWith(RANKED_CURSOR_PREFIX)
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
    await requireBetaAccess(ctx);

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
    await requireBetaAccess(ctx);

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
    const events = await ctx.db
      .query("events")
      .withIndex("by_status_recency", (q) => q.eq("status", "published"))
      .order("desc")
      .take(safeLimit);

    const enriched = await enrichEventsWithTopicsAndSources(ctx, events);
    return enriched.map(redactPublicEventPreview);
  },
});

export const getEventBySlugPreview = query({
  args: { slug: v.string() },
  handler: async (ctx, args) => {
    const event = await ctx.db
      .query("events")
      .withIndex("by_slug", (q) => q.eq("slug", args.slug))
      .unique();

    if (!event || event.status !== "published") {
      return null;
    }

    const eventTopicRows = await ctx.db
      .query("eventTopics")
      .withIndex("by_event", (q) => q.eq("eventId", event._id))
      .collect();
    const topicIds = eventTopicRows.map((r) => r.topicId);
    const topics = (
      await Promise.all(topicIds.map((topicId) => ctx.db.get(topicId)))
    ).filter((topic) => topic !== null);

    const articles = await ctx.db
      .query("articles")
      .withIndex("by_event", (q) => q.eq("eventId", event._id))
      .collect();

    const uniqueSourceIds = Array.from(
      new Set(articles.map((article) => article.sourceId)),
    );
    const sources = (
      await Promise.all(uniqueSourceIds.map((sourceId) => ctx.db.get(sourceId)))
    ).filter((source) => source !== null);
    const shareAsset = await ctx.db
      .query("eventShareAssets")
      .withIndex("by_event", (q) => q.eq("eventId", event._id))
      .order("desc")
      .first();
    const shareImageUrl =
      shareAsset?.status === "ready" && shareAsset.storageId
        ? await ctx.storage.getUrl(shareAsset.storageId)
        : null;

    return {
      event: {
        _id: event._id,
        slug: event.slug,
        title: event.title,
        shareImageUrl: shareImageUrl ?? undefined,
        shareImageWidth:
          shareAsset?.status === "ready" ? shareAsset.width : undefined,
        shareImageHeight:
          shareAsset?.status === "ready" ? shareAsset.height : undefined,
        imageUrl: event.imageUrl,
        imageAlt: event.imageAlt,
        firstPublishedAt: event.firstPublishedAt,
        lastUpdatedAt: event.lastUpdatedAt,
        topics: topics.map((topic) => ({
          _id: topic._id,
          displayName: topic.displayName,
        })),
        articleCount: articles.length,
        sources,
        globalImpact: event.globalImpact,
        perspectiveSummaries: {
          center: event.perspectiveSummaries?.center,
        },
      },
    };
  },
});

export const getEventBySlug = query({
  args: { slug: v.string() },
  handler: async (ctx, args) => {
    await requireBetaAccess(ctx);

    const event = await ctx.db
      .query("events")
      .withIndex("by_slug", (q) => q.eq("slug", args.slug))
      .unique();

    if (!event) {
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
      event: { ...event, topicIds },
      articles: articlesWithSources,
    };
  },
});
