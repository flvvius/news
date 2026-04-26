import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { query } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { requireBetaAccess } from "./lib/betaAccess";

const TOPIC_CURSOR_PREFIX = "topic:";

function encodeTopicCursor(eventId: Id<"events">): string {
  return `${TOPIC_CURSOR_PREFIX}${eventId}`;
}

function decodeTopicCursor(cursor: string | null): Id<"events"> | null {
  if (!cursor?.startsWith(TOPIC_CURSOR_PREFIX)) return null;
  return cursor.slice(TOPIC_CURSOR_PREFIX.length) as Id<"events">;
}

type EnrichableEvent = Pick<
  Doc<"events">,
  | "_id"
  | "slug"
  | "title"
  | "imageUrl"
  | "imageAlt"
  | "perspectiveSummaries"
  | "globalImpact"
  | "firstPublishedAt"
>;

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

  const allArticlesByEventId = new Map<
    Id<"events">,
    Doc<"articles">[]
  >();
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
    Array.from(uniqueSourceIds).map(async (sourceId) => [
      sourceId,
      await ctx.db.get(sourceId),
    ] as const),
  );
  const sourcesById = new Map(sourceRows);

  return events.map((event) => {
    const articles = allArticlesByEventId.get(event._id) ?? [];
    const articleCount = articles.length;
    const sourceIds = Array.from(new Set(articles.map((article) => article.sourceId)));
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
  },
  handler: async (ctx, args) => {
    await requireBetaAccess(ctx);

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

    if (matchingEventIds !== null) {
      // Topic filtering uses a custom cursor based on the last returned event.
      // This avoids dropping matching events that appear later in an over-fetched
      // database page after the UI page has already reached its target size.
      const targetSize = args.paginationOpts.numItems;
      const matchingEvents = await Promise.all(
        Array.from(matchingEventIds).map((eventId) => ctx.db.get(eventId)),
      );
      const publishedMatches = matchingEvents
        .filter(
          (event): event is Doc<"events"> =>
            event !== null && event.status === "published",
        )
        .sort(
          (a, b) =>
            b.firstPublishedAt - a.firstPublishedAt ||
            b._creationTime - a._creationTime,
        );

      const resumeAfterId = decodeTopicCursor(args.paginationOpts.cursor);
      const resumeIndex = resumeAfterId
        ? publishedMatches.findIndex((event) => event._id === resumeAfterId)
        : -1;
      const startIndex = resumeIndex >= 0 ? resumeIndex + 1 : 0;
      const page = publishedMatches.slice(startIndex, startIndex + targetSize);
      const isDone = startIndex + page.length >= publishedMatches.length;
      const lastReturned = page[page.length - 1];

      events = {
        page,
        isDone,
        continueCursor:
          isDone || !lastReturned ? "" : encodeTopicCursor(lastReturned._id),
      };
    } else {
      // Defensive reset in case a topic cursor is reused after the topic filter
      // is cleared.
      const paginationOpts = args.paginationOpts.cursor?.startsWith(
        TOPIC_CURSOR_PREFIX,
      )
        ? { ...args.paginationOpts, cursor: null }
        : args.paginationOpts;

      events = await ctx.db
        .query("events")
        .withIndex("by_status_recency", (q) => q.eq("status", "published"))
        .order("desc")
        .paginate(paginationOpts);
    }

    const enrichedPage = await enrichEventsWithTopicsAndSources(ctx, events.page);

    return {
      ...events,
      page: enrichedPage,
    };
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

    return {
      event: {
        slug: event.slug,
        title: event.title,
        imageUrl: event.imageUrl,
        imageAlt: event.imageAlt,
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
