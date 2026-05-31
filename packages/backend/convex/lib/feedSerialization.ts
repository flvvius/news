import type { Doc, Id } from "../_generated/dataModel";

// Single source of truth for the public feed-card shape and ranked pagination
// cursors. Both the live feed queries (events.ts) and the anonymous first-page
// snapshot builder (publicEventPreviews.ts) serialize through these helpers so
// the snapshot payload can never drift from the live payload.

export type FeedSort = "recent" | "trending";

export const RANKED_CURSOR_PREFIX = "ranked:";

export type PublicPreviewRow = Pick<
  Doc<"publicEventPreviews">,
  | "eventId"
  | "slug"
  | "title"
  | "imageUrl"
  | "imageAlt"
  | "perspectiveSummaries"
  | "globalImpact"
  | "firstPublishedAt"
  | "lastUpdatedAt"
  | "articleCount"
  | "sourceCount"
  | "sources"
  | "sourceBiasCounts"
  | "topicIds"
  | "factualArticleCount"
  | "factualSourceCount"
  | "trendingScore"
>;

export type RankedCursorPayload = {
  eventId: Id<"events">;
  score: number;
  updatedAt: number;
  firstPublishedAt: number;
};

export function rankedPayload(
  event: PublicPreviewRow,
  sort: FeedSort,
): RankedCursorPayload {
  return {
    eventId: event.eventId,
    score: sort === "trending" ? event.trendingScore : event.lastUpdatedAt,
    updatedAt: event.lastUpdatedAt,
    firstPublishedAt: event.firstPublishedAt,
  };
}

export function compareRankedPayload(
  a: RankedCursorPayload,
  b: RankedCursorPayload,
): number {
  return (
    b.score - a.score ||
    b.updatedAt - a.updatedAt ||
    b.firstPublishedAt - a.firstPublishedAt ||
    String(a.eventId).localeCompare(String(b.eventId))
  );
}

export function encodeRankedCursor(
  event: PublicPreviewRow,
  sort: FeedSort,
): string {
  return `${RANKED_CURSOR_PREFIX}${encodeURIComponent(
    JSON.stringify(rankedPayload(event, sort)),
  )}`;
}

export function decodeRankedCursor(
  cursor: string | null,
): RankedCursorPayload | null {
  if (!cursor?.startsWith(RANKED_CURSOR_PREFIX)) return null;
  try {
    const parsed = JSON.parse(
      decodeURIComponent(cursor.slice(RANKED_CURSOR_PREFIX.length)),
    ) as Partial<RankedCursorPayload>;
    if (
      typeof parsed.eventId === "string" &&
      typeof parsed.score === "number" &&
      typeof parsed.updatedAt === "number" &&
      typeof parsed.firstPublishedAt === "number"
    ) {
      return parsed as RankedCursorPayload;
    }
  } catch {
    return null;
  }
  return null;
}

export function toFeedEvent(row: PublicPreviewRow) {
  return {
    _id: row.eventId,
    slug: row.slug,
    title: row.title,
    imageUrl: row.imageUrl,
    imageAlt: row.imageAlt,
    perspectiveSummaries: row.perspectiveSummaries,
    globalImpact: row.globalImpact,
    firstPublishedAt: row.firstPublishedAt,
    lastUpdatedAt: row.lastUpdatedAt,
    topicIds: row.topicIds,
    articleCount: row.articleCount,
    sourceCount: row.sourceCount,
    sourceBiasCounts: row.sourceBiasCounts,
    sources: row.sources,
  };
}

export type FeedEvent = ReturnType<typeof toFeedEvent>;
