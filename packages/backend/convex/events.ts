import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { query } from "./_generated/server";

export const getPublishedEvents = query({
  args: {
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    const queryBuilder = ctx.db
      .query("events")
      .withIndex("by_topic_recency", (q) => q.eq("status", "published"))
      .order("desc");

    return await queryBuilder.paginate(args.paginationOpts);
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
