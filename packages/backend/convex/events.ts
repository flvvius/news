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
      .withIndex("by_topic_recency", (q) => q.eq("status", "published"))
      .order("desc")
      .paginate(args.paginationOpts);

    // Filter by topic if provided
    if (args.topicId) {
      const topicId = args.topicId;
      events = {
        ...events,
        page: events.page.filter((event) => event.topicIds.includes(topicId)),
      };
    }

    // Enrich each event with article count and sources
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

        return {
          ...event,
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
      event,
      articles: articlesWithSources,
    };
  },
});
