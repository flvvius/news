import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { query } from "./_generated/server";

export const getPublishedEvents = query({
  args: {
    paginationOpts: paginationOptsValidator,
    topicId: v.optional(v.id("topics")),
  },
  handler: async (ctx, args) => {
    let events = await ctx.db
      .query("events")
      .withIndex("by_status_recency", (q) => q.eq("status", "published"))
      .order("desc")
      .paginate(args.paginationOpts);

    // Filter by topic if provided (via junction table)
    if (args.topicId) {
      const topicId = args.topicId;
      // Get all eventIds that have this topic
      const eventTopicRows = await ctx.db
        .query("eventTopics")
        .withIndex("by_topic", (q) => q.eq("topicId", topicId))
        .collect();
      const matchingEventIds = new Set(eventTopicRows.map((r) => r.eventId));
      events = {
        ...events,
        page: events.page.filter((event) => matchingEventIds.has(event._id)),
      };
    }

    // Batch-load topic IDs for all events in the page to avoid N+1 queries
    const eventIds = events.page.map((e) => e._id);
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

    // Enrich each event with article count, sources, and topic IDs
    const enrichedPage = await Promise.all(
      events.page.map(async (event) => {
        const articles = await ctx.db
          .query("articles")
          .withIndex("by_event", (q) => q.eq("eventId", event._id))
          .collect();

        const articleCount = articles.length;

        // Get unique sources (with deduplication)
        const sourceIds = Array.from(new Set(articles.map((a) => a.sourceId)));
        const sources = await Promise.all(
          sourceIds.map((id) => ctx.db.get(id)),
        );

        // Read topic IDs from pre-loaded lookup
        const topicIds = (topicsByEventId.get(event._id) ?? []).map(
          (r) => r.topicId,
        );

        return {
          ...event,
          topicIds,
          articleCount,
          sources: sources.filter((s) => s !== null),
        };
      }),
    );

    return {
      ...events,
      page: enrichedPage,
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
