import type { Doc, Id } from "../_generated/dataModel";
import { normalizedPerspectives } from "./biasAxis";

// Single source of truth for the public feed-card shape and ranked pagination
// cursors. Both the live feed queries (events.ts) and the anonymous first-page
// snapshot builder (publicEventPreviews.ts) serialize through these helpers so
// the snapshot payload can never drift from the live payload.

export type FeedSort = "recent" | "trending";

export const RANKED_CURSOR_PREFIX = "ranked:";

export type PublicPreviewRow = Pick<
  Doc<"publicEventPreviews">,
  | "_id"
  | "eventId"
  | "slug"
  | "title"
  | "imageUrl"
  | "imageAlt"
  | "perspectiveSummaries"
  | "perspectiveApplicable"
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
  | "aiGenerated"
  | "humanReviewed"
  | "trendingScore"
>;

export type RankedCursorPayload = {
  eventId: Id<"events">;
  // The preview row's own id. This is the final tiebreak, and it must be the
  // PREVIEW id rather than the event id: ranked reads walk an index on
  // publicEventPreviews, whose implicit last key is that table's `_id`. Optional
  // so cursors encoded before this field existed still decode.
  previewId?: string;
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
    previewId: String(event._id),
    score: sort === "trending" ? event.trendingScore : event.lastUpdatedAt,
    updatedAt: event.lastUpdatedAt,
    firstPublishedAt: event.firstPublishedAt,
  };
}

export function compareRankedPayload(
  a: RankedCursorPayload,
  b: RankedCursorPayload,
): number {
  // EVERY key here descends, matching the `.order("desc")` index traversal that
  // ranked reads use. That correspondence is load-bearing, not cosmetic: the
  // cursor walk assumes each window is a contiguous prefix of this total order.
  //
  // The old final tiebreak was ASCENDING eventId, which inverted the scan
  // direction inside a run of rows sharing a score. The window then held a
  // biased sample of the tie run (the rows the descending scan reached first),
  // the page returned that sample's tail, and the cursor advanced past every
  // remaining tied row — so the feed silently dead-ended mid-list. Widening the
  // window could not help, because widening reaches rows that sort BEFORE the
  // cursor under an inverted tiebreak.
  const previewIdOrder =
    a.previewId === undefined || b.previewId === undefined
      ? 0
      : a.previewId < b.previewId
        ? 1
        : a.previewId > b.previewId
          ? -1
          : 0;
  return (
    b.score - a.score ||
    b.updatedAt - a.updatedAt ||
    b.firstPublishedAt - a.firstPublishedAt ||
    previewIdOrder ||
    // Legacy cursors carry no previewId; fall back so they still order stably.
    String(b.eventId).localeCompare(String(a.eventId))
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
    perspectiveSummaries: normalizedPerspectives(row.perspectiveSummaries),
    perspectiveApplicable: row.perspectiveApplicable,
    globalImpact: row.globalImpact,
    firstPublishedAt: row.firstPublishedAt,
    lastUpdatedAt: row.lastUpdatedAt,
    topicIds: row.topicIds,
    articleCount: row.articleCount,
    sourceCount: row.sourceCount,
    sourceBiasCounts: row.sourceBiasCounts,
    sources: row.sources,
    // L1: machine-readable AI-generation disclosure on every public payload.
    aiGenerated: row.aiGenerated ?? true,
    humanReviewed: row.humanReviewed ?? false,
  };
}

export type FeedEvent = ReturnType<typeof toFeedEvent>;
