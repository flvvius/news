import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";

export const MAX_PREVIEW_SOURCES = 5;

type PublicPreviewCtx = MutationCtx | QueryCtx;

type SourceBiasCounts = {
  left: number;
  center: number;
  right: number;
};

function classifySourceBias(source: Pick<Doc<"sources">, "baseBias" | "mbfcCategory">) {
  const category = source.mbfcCategory?.toLowerCase();
  if (category === "left" || category === "left-center") return "left" as const;
  if (category === "right" || category === "right-center") return "right" as const;
  if (category === "center") return "center" as const;
  if (source.baseBias < 0) return "left" as const;
  if (source.baseBias > 0) return "right" as const;
  return "center" as const;
}

export function computeTrendingScore(args: {
  factualArticleCount?: number;
  factualSourceCount?: number;
  lastUpdatedAt?: number;
  firstPublishedAt: number;
}) {
  const sourceScore = (args.factualSourceCount ?? 0) * 10;
  const articleScore = (args.factualArticleCount ?? 0) * 3;
  const recencyScore =
    (args.lastUpdatedAt ?? args.firstPublishedAt) / 3_600_000;
  return sourceScore + articleScore + recencyScore;
}

export async function getPublicPreviewByEventId(
  ctx: PublicPreviewCtx,
  eventId: Id<"events">,
) {
  return await ctx.db
    .query("publicEventPreviews")
    .withIndex("by_event", (q) => q.eq("eventId", eventId))
    .unique();
}

export async function deletePublicEventPreview(
  ctx: MutationCtx,
  eventId: Id<"events">,
) {
  const existing = await getPublicPreviewByEventId(ctx, eventId);
  if (existing) {
    await ctx.db.delete(existing._id);
  }
}

export async function syncPublicEventPreview(
  ctx: MutationCtx,
  eventId: Id<"events">,
) {
  const event = await ctx.db.get(eventId);
  if (!event) {
    await deletePublicEventPreview(ctx, eventId);
    return { synced: false as const, reason: "missing_event" as const };
  }

  if (event.status !== "published") {
    await deletePublicEventPreview(ctx, eventId);
    return { synced: false as const, reason: "not_published" as const };
  }

  let articleCount = event.articleCount;
  let sourceCount = event.sourceCount;
  let sourceIds = event.sourceIds;

  if (articleCount === undefined || sourceCount === undefined || !sourceIds) {
    console.log(
      `[public-previews] Falling back to article scan for event ${String(eventId)} while preview cache is warming`,
    );
    const articles = await ctx.db
      .query("articles")
      .withIndex("by_event", (q) => q.eq("eventId", eventId))
      .collect();
    articleCount = articleCount ?? articles.length;
    sourceIds =
      sourceIds ??
      Array.from(new Set(articles.map((article) => article.sourceId)));
    sourceCount = sourceCount ?? sourceIds.length;
  }

  const [topicRows, sourceDocs] = await Promise.all([
    ctx.db
      .query("eventTopics")
      .withIndex("by_event", (q) => q.eq("eventId", eventId))
      .collect(),
    Promise.all((sourceIds ?? []).map((sourceId) => ctx.db.get(sourceId))),
  ]);

  const topics = topicRows.map((row) => row.topicId);
  const validSources = sourceDocs.filter(
    (source): source is Doc<"sources"> => source !== null,
  );
  const sourceBiasCounts: SourceBiasCounts = {
    left: 0,
    center: 0,
    right: 0,
  };

  for (const source of validSources) {
    sourceBiasCounts[classifySourceBias(source)]++;
  }

  const existing = await getPublicPreviewByEventId(ctx, eventId);
  const perspectiveSummaries = event.perspectiveSummaries
    ? {
        ...(event.perspectiveSummaries.center !== undefined
          ? { center: event.perspectiveSummaries.center }
          : {}),
        ...(event.perspectiveSummaries.left !== undefined
          ? { left: event.perspectiveSummaries.left }
          : {}),
        ...(event.perspectiveSummaries.right !== undefined
          ? { right: event.perspectiveSummaries.right }
          : {}),
      }
    : undefined;
  const payload = {
    eventId,
    slug: event.slug,
    title: event.title,
    imageUrl: event.imageUrl,
    imageAlt: event.imageAlt,
    perspectiveSummaries:
      perspectiveSummaries && Object.keys(perspectiveSummaries).length > 0
        ? perspectiveSummaries
        : undefined,
    globalImpact: event.globalImpact,
    firstPublishedAt: event.firstPublishedAt,
    lastUpdatedAt: event.lastUpdatedAt ?? event.firstPublishedAt,
    articleCount: articleCount ?? 0,
    sourceCount: sourceCount ?? validSources.length,
    topicIds: topics,
    factualArticleCount: event.factualArticleCount,
    factualSourceCount: event.factualSourceCount,
    trendingScore: computeTrendingScore(event),
    sourceBiasCounts,
    sources: validSources.slice(0, MAX_PREVIEW_SOURCES).map((source) => ({
      _id: source._id,
      name: source.name,
      logoUrl: source.logoUrl,
      baseBias: source.baseBias,
      reliabilityScore: source.reliabilityScore,
      mbfcCategory: source.mbfcCategory,
      mbfcFactual: source.mbfcFactual,
      mbfcCredibility: source.mbfcCredibility,
    })),
    updatedAt: Date.now(),
  };

  if (existing) {
    await ctx.db.patch(existing._id, payload);
  } else {
    await ctx.db.insert("publicEventPreviews", payload);
  }

  return { synced: true as const };
}
