import { v } from "convex/values";
import { query } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";

function sourceBiasLabel(source: Doc<"sources">): string {
  const mbfcCategory = source.mbfcCategory?.toLowerCase();
  if (
    mbfcCategory === "left" ||
    mbfcCategory === "left-center" ||
    mbfcCategory === "center" ||
    mbfcCategory === "right-center" ||
    mbfcCategory === "right"
  ) {
    return mbfcCategory;
  }
  if (source.baseBias === 0) return "center";
  if (source.baseBias <= -3) return "left";
  if (source.baseBias < 0) return "left-center";
  if (source.baseBias >= 3) return "right";
  if (source.baseBias > 0) return "right-center";
  return "center";
}

async function getEventTopics(
  ctx: QueryCtx,
  eventId: Id<"events">,
) {
  const rows = await ctx.db
    .query("eventTopics")
    .withIndex("by_event", (q) => q.eq("eventId", eventId))
    .collect();
  const topics = await Promise.all(rows.map((row) => ctx.db.get(row.topicId)));
  return topics
    .filter((topic) => topic !== null)
    .map((topic) => ({
      _id: topic._id,
      displayName: topic.displayName,
    }));
}

export const getSourceProfile = query({
  args: {
    sourceId: v.id("sources"),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const source = await ctx.db.get(args.sourceId);
    if (!source) return null;

    const safeLimit = Math.max(1, Math.min(100, Math.floor(args.limit ?? 50)));
    const recentArticlesRaw = await ctx.db
      .query("articles")
      .withIndex("by_source_publishedAt", (q) =>
        q.eq("sourceId", args.sourceId),
      )
      .order("desc")
      .take(safeLimit);

    const eventIds = Array.from(
      new Set(
        recentArticlesRaw
          .map((article) => article.eventId)
          .filter((eventId): eventId is Id<"events"> => eventId !== undefined),
      ),
    );
    const eventRows = await Promise.all(
      eventIds.map((eventId) => ctx.db.get(eventId)),
    );
    const eventsById = new Map(
      eventRows
        .filter(
          (event): event is Doc<"events"> =>
            event !== null && event.status === "published",
        )
        .map((event) => [event._id, event]),
    );
    const recentArticles = recentArticlesRaw.filter((article) =>
      article.eventId ? eventsById.has(article.eventId) : true,
    );
    const topicRows = await Promise.all(
      Array.from(eventsById.keys()).map(async (eventId) => [
        eventId,
        await getEventTopics(ctx, eventId),
      ] as const),
    );
    const topicsByEventId = new Map(topicRows);

    const scoredArticles = recentArticles.filter(
      (article) => typeof article.aiBiasScore === "number",
    );
    const averageAiBias =
      scoredArticles.length > 0
        ? scoredArticles.reduce(
            (sum, article) => sum + (article.aiBiasScore ?? 0),
            0,
          ) / scoredArticles.length
        : null;

    const eventCount = new Set(
      recentArticles
        .map((article) => article.eventId)
        .filter((eventId): eventId is Id<"events"> => eventId !== undefined),
    ).size;

    return {
      source: {
        ...source,
        biasLabel: sourceBiasLabel(source),
      },
      stats: {
        totalArticles: recentArticles.length,
        eventCount,
        scoredArticleCount: scoredArticles.length,
        averageAiBias,
        biasOutlierCount: recentArticles.filter(
          (article) => article.biasOutlierFlag,
        ).length,
        sourceBiasOutlierCount: recentArticles.filter(
          (article) => article.sourceBiasOutlierFlag,
        ).length,
      },
      articles: recentArticles.map((article) => {
        const event = article.eventId
          ? eventsById.get(article.eventId) ?? null
          : null;
        return {
          _id: article._id,
          title: article.title,
          summary: article.summary,
          rssSnippet: article.rssSnippet,
          canonicalUrl: article.canonicalUrl,
          publishedAt: article.publishedAt,
          imageUrl: article.imageUrl,
          imageAlt: article.imageAlt,
          aiBiasScore: article.aiBiasScore,
          biasOutlierFlag: article.biasOutlierFlag,
          sourceBiasOutlierFlag: article.sourceBiasOutlierFlag,
          event: event
            ? {
                _id: event._id,
                slug: event.slug,
                title: event.title,
                imageUrl: event.imageUrl,
                firstPublishedAt: event.firstPublishedAt,
                lastUpdatedAt: event.lastUpdatedAt,
                topics: topicsByEventId.get(event._id) ?? [],
              }
            : null,
        };
      }),
    };
  },
});

export const getSitemapSources = query({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const safeLimit = Math.min(Math.max(Math.floor(args.limit ?? 5000), 1), 10000);
    const sources = await ctx.db.query("sources").take(safeLimit);

    return sources.map((source) => ({
      sourceId: source._id,
      lastModifiedAt:
        source.rollingBiasUpdatedAt ??
        source.mbfcLastChecked ??
        source._creationTime,
    }));
  },
});
