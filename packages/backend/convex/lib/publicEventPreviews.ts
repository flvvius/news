import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { encodeRankedCursor, toFeedEvent } from "./feedSerialization";

export const MAX_PREVIEW_SOURCES = 5;
const FEED_SNAPSHOT_PAGE_SIZE = 24;

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
    await deletePreviewTopicRows(ctx, eventId);
    await ctx.db.delete(existing._id);
  }
}

async function deletePreviewTopicRows(ctx: MutationCtx, eventId: Id<"events">) {
  const rows = await ctx.db
    .query("publicEventPreviewTopics")
    .withIndex("by_event", (q) => q.eq("eventId", eventId))
    .collect();
  for (const row of rows) await ctx.db.delete(row._id);
}

async function syncPreviewTopicRows(
  ctx: MutationCtx,
  preview: Doc<"publicEventPreviews">,
) {
  const existingRows = await ctx.db
    .query("publicEventPreviewTopics")
    .withIndex("by_event", (q) => q.eq("eventId", preview.eventId))
    .collect();
  const existingByTopic = new Map(
    existingRows.map((row) => [String(row.topicId), row]),
  );
  const nextTopicIds = new Set(preview.topicIds.map((topicId) => String(topicId)));

  for (const topicId of preview.topicIds) {
    const key = String(topicId);
    const existing = existingByTopic.get(key);
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

function snapshotKey(sort: "recent" | "trending") {
  return `anonymous:first-page:${sort}`;
}

// Rebuilds the anonymous trending first-page snapshot. Only the trending feed
// is snapshotted: it needs an expensive ranked scan on every cold load, whereas
// the recent feed is a cheap indexed pagination. The payload stores the
// serialized first page plus the live `ranked:` cursors so the feed query can
// hand pagination back to the live ranked query instead of dead-ending at the
// snapshot size. Called from a cron (not on every preview write) to avoid write
// amplification and contention on this single document.
export async function rebuildPublicFeedSnapshots(ctx: MutationCtx) {
  const trending = await ctx.db
    .query("publicEventPreviews")
    .withIndex("by_trending_score")
    .order("desc")
    .take(FEED_SNAPSHOT_PAGE_SIZE);

  const payloadJson = JSON.stringify({
    items: trending.map(toFeedEvent),
    cursors: trending.map((row) => encodeRankedCursor(row, "trending")),
  });

  const now = Date.now();
  const key = snapshotKey("trending");
  const existing = await ctx.db
    .query("publicFeedSnapshots")
    .withIndex("by_key", (q) => q.eq("key", key))
    .unique();
  const row = {
    sort: "trending" as const,
    payloadJson,
    itemCount: trending.length,
    generatedAt: now,
    updatedAt: now,
  };
  if (existing) {
    await ctx.db.patch(existing._id, row);
  } else {
    await ctx.db.insert("publicFeedSnapshots", { key, ...row });
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
  const now = Date.now();
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
    updatedAt: now,
  };

  if (existing) {
    await ctx.db.patch(existing._id, {
      ...payload,
      createdAt: existing.createdAt ?? now,
    });
    const updated = await ctx.db.get(existing._id);
    if (updated) await syncPreviewTopicRows(ctx, updated);
  } else {
    const previewId = await ctx.db.insert("publicEventPreviews", {
      ...payload,
      createdAt: now,
    });
    const inserted = await ctx.db.get(previewId);
    if (inserted) await syncPreviewTopicRows(ctx, inserted);
  }

  return { synced: true as const };
}
