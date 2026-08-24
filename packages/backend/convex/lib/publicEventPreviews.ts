import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { encodeRankedCursor, toFeedEvent } from "./feedSerialization";
import { filterEventImage } from "./imagePolicy";
import { normalizedPerspectives } from "./biasAxis";
import { foldDiacriticsToAscii } from "./romanian";

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

// The stored trending score is a static, monotonic sort key (it is written
// once when a preview is upserted, indexed by `by_trending_score`, and never
// recomputed by a cron). It must therefore be built from an absolute
// timestamp, not a "now-relative" age — otherwise the stored ordering would
// silently rot as time passes. We weight recency by adding a per-hour term and
// bound how far a well-covered-but-stale event can float above fresher ones.
//
// Recency weight: 1 point every 5 minutes (= 12 points/hour, 288/day). This is
// 12x the original 1 point/hour, so recency strongly dominates coverage.
const RECENCY_MS_PER_POINT = 300_000;
// Coverage cap: 144 points = 12h of recency at the rate above. Once an event
// stops updating, its coverage can lift it at most half a day over a fresher
// event, so yesterday's well-corroborated story cannot hold the top slots
// against today's news no matter how heavily it was covered. Actively-updated
// stories keep a fresh lastUpdatedAt and are unaffected.
//
// Keep this expressed as (hours of float x points-per-hour): the ratio between
// the cap and the recency rate IS the tuning knob. Raising the cap or slowing
// the rate both buy stale-but-covered events more time at the top.
const MAX_COVERAGE_BONUS = 144;

export function computeTrendingScore(args: {
  factualArticleCount?: number;
  factualSourceCount?: number;
  articleCount?: number;
  sourceCount?: number;
  lastUpdatedAt?: number;
  firstPublishedAt: number;
}) {
  // BIV-801: the claim-verified counts only populate while the claim-analysis
  // pipeline runs, and that pipeline is paused (BIV-602). Without a fallback
  // the score degenerates to the recency term alone and Trending becomes
  // indistinguishable from Latest. Raw coverage (how many sources/articles
  // corroborate the event) is the honest degraded signal, so treat a zero
  // factual count the same as an absent one — a paused pipeline also writes
  // zeros, making 0 vs undefined meaningless as a distinction.
  const sourceSignal = args.factualSourceCount || args.sourceCount || 0;
  const articleSignal = args.factualArticleCount || args.articleCount || 0;
  const coverageBonus = Math.min(
    sourceSignal * 10 + articleSignal * 3,
    MAX_COVERAGE_BONUS,
  );
  const recencyScore =
    (args.lastUpdatedAt ?? args.firstPublishedAt) / RECENCY_MS_PER_POINT;
  return coverageBonus + recencyScore;
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

function snapshotKey(sort: "recent" | "trending", topicId?: Id<"topics">) {
  return topicId
    ? `anonymous:first-page:${sort}:topic:${topicId}`
    : `anonymous:first-page:${sort}`;
}

async function upsertFeedSnapshot(
  ctx: MutationCtx,
  key: string,
  rows: Doc<"publicEventPreviews">[],
) {
  const payloadJson = JSON.stringify({
    items: rows.map(toFeedEvent),
    cursors: rows.map((row) => encodeRankedCursor(row, "trending")),
  });

  const now = Date.now();
  const existing = await ctx.db
    .query("publicFeedSnapshots")
    .withIndex("by_key", (q) => q.eq("key", key))
    .unique();
  const row = {
    sort: "trending" as const,
    payloadJson,
    itemCount: rows.length,
    generatedAt: now,
    updatedAt: now,
  };
  if (existing) {
    await ctx.db.patch(existing._id, row);
  } else {
    await ctx.db.insert("publicFeedSnapshots", { key, ...row });
  }
}

// Rebuilds the anonymous trending first-page snapshots. Only trending is
// snapshotted: it needs an expensive ranked scan on every cold load, whereas
// the recent feed is a cheap indexed pagination. Each payload stores the
// serialized first page plus the live `ranked:` cursors so the feed query can
// hand pagination back to the live ranked query instead of dead-ending at the
// snapshot size. Called from a cron (not on every preview write) to avoid write
// amplification and contention on these documents.
//
// The global trending feed plus every topic feed is cached. Topic feeds run
// the single largest ranked scan (up to TOPIC_SCAN_LIMIT full ~4KB preview
// hydrations per uncached load) and were previously never cached, so caching
// their first page is the biggest database-I/O win on the public read path.
// The topic catalog is small and curated, so the per-topic rebuild cost is
// bounded.
export async function rebuildPublicFeedSnapshots(ctx: MutationCtx) {
  const trending = await ctx.db
    .query("publicEventPreviews")
    .withIndex("by_trending_score")
    .order("desc")
    .take(FEED_SNAPSHOT_PAGE_SIZE);
  await upsertFeedSnapshot(ctx, snapshotKey("trending"), trending);

  const topics = await ctx.db.query("topics").collect();
  for (const topic of topics) {
    const topicRows = await ctx.db
      .query("publicEventPreviewTopics")
      .withIndex("by_topic_trending", (q) => q.eq("topicId", topic._id))
      .order("desc")
      .take(FEED_SNAPSHOT_PAGE_SIZE);
    const previews = (
      await Promise.all(topicRows.map((row) => ctx.db.get(row.previewId)))
    ).filter(
      (preview): preview is Doc<"publicEventPreviews"> => preview !== null,
    );
    await upsertFeedSnapshot(ctx, snapshotKey("trending", topic._id), previews);
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

  if (event.status !== "published" || event.unpublishedAt) {
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
  // Collapses to the canonical axis keys (falling back to legacy
  // center/left/right for pre-BIV-303 rows) or undefined when empty.
  const perspectiveSummaries = normalizedPerspectives(
    event.perspectiveSummaries,
  );
  // L9: feed thumbnails obey the same og:image policy as the event page.
  const allowedImageUrl = await filterEventImage(ctx, event);
  const now = Date.now();
  const payload = {
    eventId,
    slug: event.slug,
    title: event.title,
    // Feeds the diacritic-insensitive search index (see schema).
    searchText: foldDiacriticsToAscii(event.title),
    imageUrl: allowedImageUrl,
    imageAlt: allowedImageUrl ? event.imageAlt : undefined,
    perspectiveSummaries,
    perspectiveApplicable: event.perspectiveApplicable,
    globalImpact: event.globalImpact,
    firstPublishedAt: event.firstPublishedAt,
    lastUpdatedAt: event.lastUpdatedAt ?? event.firstPublishedAt,
    articleCount: articleCount ?? 0,
    sourceCount: sourceCount ?? validSources.length,
    topicIds: topics,
    factualArticleCount: event.factualArticleCount,
    factualSourceCount: event.factualSourceCount,
    // L1 disclosure mirror: previews exist only for events whose summary came
    // out of the AI pipeline, so default the legacy-row gap to true/false.
    aiGenerated: event.aiGenerated ?? true,
    humanReviewed: event.humanReviewed ?? false,
    trendingScore: computeTrendingScore({
      factualArticleCount: event.factualArticleCount,
      factualSourceCount: event.factualSourceCount,
      // Resolved above (event fields or article scan) so the coverage
      // fallback sees real counts even while the event cache is warming.
      articleCount: articleCount ?? 0,
      sourceCount: sourceCount ?? validSources.length,
      lastUpdatedAt: event.lastUpdatedAt,
      firstPublishedAt: event.firstPublishedAt,
    }),
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
