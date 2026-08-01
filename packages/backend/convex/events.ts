import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { internalMutation, query } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import {
  compareRankedPayload,
  decodeRankedCursor,
  encodeRankedCursor,
  rankedPayload,
  RANKED_CURSOR_PREFIX,
  toFeedEvent,
  type FeedSort,
  type PublicPreviewRow,
} from "./lib/feedSerialization";
import {
  rebuildPublicFeedSnapshots,
  syncPublicEventPreview,
} from "./lib/publicEventPreviews";
import { filterEventImage } from "./lib/imagePolicy";
import { normalizedPerspectives } from "./lib/biasAxis";
import { foldDiacriticsToAscii } from "./lib/romanian";
import { getConfig } from "./config";
import { EVENT_SHARE_ASSET_GENERATION_ENABLED_KEY } from "./shareAssets";

// COST: ranked feed pagination is the app's single largest source of database
// I/O, so it is deliberately cursor-anchored rather than "scan the top N and
// slice in JS".
//
// The old shape re-scanned the top TRENDING_SCAN_LIMIT (250) preview rows for
// *every* page — including page 5 — and then threw ~95% of them away. Two
// separate costs came out of that:
//   1. bytes read per execution (250 fat preview docs ≈ 0.6 MB for a 6-item
//      page), and
//   2. reactive re-execution: a query that reads the top of `by_trending_score`
//      is invalidated by every newly-published event (recency dominates the
//      score, so new events always land at the top of that range). Every open
//      page-2+ subscription therefore re-ran, and re-read its 250 rows, on
//      roughly every publish.
//
// Anchoring each page to an index range that is bounded *above* by the previous
// page's score fixes both: a page reads ~pageSize rows, and new high-scoring
// events fall outside the read range so they no longer invalidate deep pages.
const RANKED_PAGE_BUFFER = 12;
// A run of rows tying on the index key (identical trendingScore, or identical
// lastUpdatedAt) can be longer than RANKED_PAGE_BUFFER. When that happens every
// row in the window sorts at or before the cursor and the page comes back
// empty, which would look identical to "the feed ended". Widen the window
// geometrically instead. 4 attempts covers a tie run of ~1,000 rows; the retry
// only runs in that rare case, so the normal path still reads exactly once.
const RANKED_TIE_RUN_MAX_ATTEMPTS = 4;
const RANKED_TIE_RUN_GROWTH = 4;
const RANKED_MAX_PAGE_SIZE = 50;
// Ranked pagination depth cap. Preserves the old "the ranked feed ends" UX
// (previously an implicit side effect of the 250/500-row scan window) so
// infinite scroll cannot walk the whole table one cheap page at a time.
const RANKED_MAX_DEPTH = 240;
const RANKED_DEPTH_MARKER = "|d";

const FEED_SORT_VALIDATOR = v.union(v.literal("recent"), v.literal("trending"));

function sortEventsForFeed(events: PublicPreviewRow[], sort: FeedSort) {
  return [...events].sort((a, b) => {
    return compareRankedPayload(rankedPayload(a, sort), rankedPayload(b, sort));
  });
}

// `encodeRankedCursor` percent-encodes its JSON payload, so "|" can never occur
// inside a base cursor and is safe as a depth separator. Depth travels on the
// cursor so the server stays stateless; a cursor without a marker (e.g. one
// minted by the snapshot builder) simply starts at depth 0.
function splitRankedCursor(cursor: string | null) {
  if (!cursor) return { base: null as string | null, depth: 0 };
  const markerIndex = cursor.lastIndexOf(RANKED_DEPTH_MARKER);
  if (markerIndex < 0) return { base: cursor, depth: 0 };
  const parsed = Number(cursor.slice(markerIndex + RANKED_DEPTH_MARKER.length));
  return {
    base: cursor.slice(0, markerIndex),
    depth: Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0,
  };
}

function withDepth(cursor: string, depth: number) {
  return cursor === "" ? "" : `${cursor}${RANKED_DEPTH_MARKER}${depth}`;
}

function snapshotKey(sort: FeedSort, topicId?: Id<"topics">) {
  // Topic-scoped snapshots come from #60; the cursor-anchored reader below
  // consumes them the same way it consumes the global one.
  return topicId
    ? `anonymous:first-page:${sort}:topic:${topicId}`
    : `anonymous:first-page:${sort}`;
}

type RankedWindow = {
  rows: PublicPreviewRow[];
  /** The index range was exhausted, so there is nothing after this window. */
  reachedEnd: boolean;
};

/**
 * Reads at most `limit` preview rows starting at `fromScore` (inclusive) and
 * walking down the ranking. `fromScore === undefined` starts at the top.
 */
async function readRankedWindow(
  ctx: QueryCtx,
  topicId: Id<"topics"> | undefined,
  sort: FeedSort,
  fromScore: number | undefined,
  limit: number,
): Promise<RankedWindow> {
  if (topicId) {
    const table = ctx.db.query("publicEventPreviewTopics");
    const rows =
      sort === "trending"
        ? await (fromScore === undefined
            ? table.withIndex("by_topic_trending", (q) =>
                q.eq("topicId", topicId),
              )
            : table.withIndex("by_topic_trending", (q) =>
                q.eq("topicId", topicId).lte("trendingScore", fromScore),
              )
          )
            .order("desc")
            .take(limit)
        : await (fromScore === undefined
            ? table.withIndex("by_topic_updated", (q) =>
                q.eq("topicId", topicId),
              )
            : table.withIndex("by_topic_updated", (q) =>
                q.eq("topicId", topicId).lte("lastUpdatedAt", fromScore),
              )
          )
            .order("desc")
            .take(limit);
    const previews = await Promise.all(
      rows.map((row) => ctx.db.get(row.previewId)),
    );
    return {
      rows: previews.filter(
        (preview): preview is Doc<"publicEventPreviews"> => preview !== null,
      ),
      reachedEnd: rows.length < limit,
    };
  }

  const table = ctx.db.query("publicEventPreviews");
  const rows =
    sort === "trending"
      ? await (fromScore === undefined
          ? table.withIndex("by_trending_score")
          : table.withIndex("by_trending_score", (q) =>
              q.lte("trendingScore", fromScore),
            )
        )
          .order("desc")
          .take(limit)
      : await (fromScore === undefined
          ? table.withIndex("by_last_updated_at")
          : table.withIndex("by_last_updated_at", (q) =>
              q.lte("lastUpdatedAt", fromScore),
            )
        )
          .order("desc")
          .take(limit);
  return { rows, reachedEnd: rows.length < limit };
}

async function paginateRanked(
  ctx: QueryCtx,
  topicId: Id<"topics"> | undefined,
  sort: FeedSort,
  cursor: string | null,
  requestedSize: number,
) {
  const targetSize = Math.min(Math.max(requestedSize, 1), RANKED_MAX_PAGE_SIZE);
  const { base, depth } = splitRankedCursor(cursor);
  const resumePayload = decodeRankedCursor(base);

  const remainingDepth = Math.max(0, RANKED_MAX_DEPTH - depth);
  if (remainingDepth === 0) {
    return { page: [] as PublicPreviewRow[], isDone: true, continueCursor: "" };
  }
  const pageSize = Math.min(targetSize, remainingDepth);

  // Read only one page plus a small buffer. The buffer absorbs rows that tie on
  // the index key with the cursor (they sort before it under the full
  // comparator and get dropped below).
  const rowsAfterCursor = (windowRows: PublicPreviewRow[]) => {
    const sorted = sortEventsForFeed(windowRows, sort);
    return resumePayload
      ? sorted.filter(
          (event) =>
            compareRankedPayload(rankedPayload(event, sort), resumePayload) > 0,
        )
      : sorted;
  };

  let limit = pageSize + RANKED_PAGE_BUFFER;
  let window = await readRankedWindow(
    ctx,
    topicId,
    sort,
    resumePayload?.score,
    limit,
  );
  let after = rowsAfterCursor(window.rows);

  // An empty result with more rows still available means the window fell
  // entirely inside a tie run, not that the feed ended. Widen and retry.
  for (
    let attempt = 1;
    after.length === 0 &&
    !window.reachedEnd &&
    attempt < RANKED_TIE_RUN_MAX_ATTEMPTS;
    attempt++
  ) {
    limit *= RANKED_TIE_RUN_GROWTH;
    window = await readRankedWindow(
      ctx,
      topicId,
      sort,
      resumePayload?.score,
      limit,
    );
    after = rowsAfterCursor(window.rows);
  }

  const reachedEnd = window.reachedEnd;
  const page = after.slice(0, pageSize);
  const lastReturned = page[page.length - 1];
  const nextDepth = depth + page.length;
  const isDone =
    (reachedEnd && after.length <= pageSize) ||
    nextDepth >= RANKED_MAX_DEPTH ||
    !lastReturned;

  return {
    page,
    isDone,
    continueCursor: isDone
      ? ""
      : withDepth(encodeRankedCursor(lastReturned, sort), nextDepth),
  };
}

async function getTopicFeedCandidates(
  ctx: QueryCtx,
  topicId: Id<"topics">,
  sort: FeedSort,
  limit: number,
) {
  const { rows } = await readRankedWindow(ctx, topicId, sort, undefined, limit);
  return rows;
}

export const getPublishedEvents = query({
  args: {
    paginationOpts: paginationOptsValidator,
    topicId: v.optional(v.id("topics")),
    sort: v.optional(FEED_SORT_VALIDATOR),
  },
  handler: async (ctx, args) => {
    const sort = args.sort ?? "trending";
    const numItems = Math.min(
      Math.max(args.paginationOpts.numItems, 1),
      RANKED_MAX_PAGE_SIZE,
    );

    // Anonymous trending acceleration. The snapshot document holds the whole
    // precomputed first slice of the trending ranking plus the `ranked:` cursor
    // that follows each item, so it can serve *any* page whose cursor it still
    // recognises — not just page 1. With the default 6-item page size that is
    // the first four pages of the feed served from a single document read
    // instead of four ranked index scans, and — critically — that document only
    // changes when the rebuild cron runs, so the subscription re-runs on that
    // cadence instead of on every publish.
    //
    // Topic-scoped snapshots (#60) are keyed separately and read through this
    // same path; when one is absent the live cursor-anchored query below is
    // authoritative, so a missing snapshot only costs an index range read.
    if (sort === "trending") {
      const { base: snapshotCursor, depth: cursorDepth } = splitRankedCursor(
        args.paginationOpts.cursor,
      );
      const snapshot = await ctx.db
        .query("publicFeedSnapshots")
        .withIndex("by_key", (q) =>
          q.eq("key", snapshotKey("trending", args.topicId)),
        )
        .unique();
      if (snapshot) {
        try {
          const parsed = JSON.parse(snapshot.payloadJson) as {
            items: ReturnType<typeof toFeedEvent>[];
            cursors: string[];
          };
          const items = parsed.items ?? [];
          const cursors = parsed.cursors ?? [];
          // Resolve where this request resumes inside the snapshot. A cursor the
          // snapshot does not recognise (stale generation) or one past the
          // snapshot tail yields startIndex < 0 / >= items.length and falls
          // through to the live ranked path below, which is authoritative.
          const resumeIndex =
            snapshotCursor === null ? -1 : cursors.indexOf(snapshotCursor);
          const startIndex =
            snapshotCursor === null ? 0 : resumeIndex < 0 ? -1 : resumeIndex + 1;
          if (startIndex >= 0 && startIndex < items.length) {
            const page = items.slice(startIndex, startIndex + numItems);
            const boundaryIndex = startIndex + page.length - 1;
            // An absent boundary cursor means the snapshot cannot hand off to
            // the live ranked path, so the feed ends here.
            const rawCursor = cursors[boundaryIndex] ?? "";
            const nextDepth = cursorDepth + page.length;
            const isDone = rawCursor === "" || nextDepth >= RANKED_MAX_DEPTH;
            return {
              page,
              isDone,
              continueCursor: isDone ? "" : withDepth(rawCursor, nextDepth),
            };
          }
        } catch (error) {
          console.error(
            "[events] Failed to parse public feed snapshot:",
            error,
          );
          // Fall through to the live query path below.
        }
      }
    }

    if (args.topicId || sort === "trending") {
      const events = await paginateRanked(
        ctx,
        args.topicId,
        sort,
        args.paginationOpts.cursor,
        numItems,
      );
      return { ...events, page: events.page.map(toFeedEvent) };
    }

    // Defensive reset in case a ranked cursor is reused after ranked mode is
    // cleared.
    const paginationOpts = args.paginationOpts.cursor?.startsWith(
      RANKED_CURSOR_PREFIX,
    )
      ? { ...args.paginationOpts, cursor: null, numItems }
      : { ...args.paginationOpts, numItems };

    const events = await ctx.db
      .query("publicEventPreviews")
      .withIndex("by_last_updated_at")
      .order("desc")
      .paginate(paginationOpts);

    return {
      ...events,
      page: events.page.map(toFeedEvent),
    };
  },
});

// Crawlable feed archive (/feed?page=N): fixed, index-backed pages in
// recent order, so every published event stays reachable through the
// next/previous anchor chain regardless of trending churn. Offset paging
// costs page*pageSize rows per read, hence the hard scan cap.
const ARCHIVE_MAX_SCAN = 4000;
const ARCHIVE_DEFAULT_PAGE_SIZE = 20;

export const getPublishedEventsArchivePage = query({
  args: {
    page: v.number(),
    pageSize: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const pageSize = Math.min(
      Math.max(Math.floor(args.pageSize ?? ARCHIVE_DEFAULT_PAGE_SIZE), 1),
      50,
    );
    const page = Math.max(Math.floor(args.page), 1);
    const maxPage = Math.floor(ARCHIVE_MAX_SCAN / pageSize);
    if (page > maxPage) {
      // Never serve duplicate content under an out-of-range URL; the web
      // loader turns an empty page into a 404.
      return { page, pageSize, events: [], hasMore: false };
    }

    const rows = await ctx.db
      .query("publicEventPreviews")
      .withIndex("by_last_updated_at")
      .order("desc")
      .take(page * pageSize + 1);
    const start = (page - 1) * pageSize;

    return {
      page,
      pageSize,
      events: rows.slice(start, start + pageSize).map(toFeedEvent),
      hasMore: rows.length > page * pageSize,
    };
  },
});

export const searchPublishedEvents = query({
  args: {
    query: v.string(),
    limit: v.optional(v.number()),
    topicId: v.optional(v.id("topics")),
  },
  handler: async (ctx, args) => {
    const normalizedQuery = args.query.trim();
    if (normalizedQuery.length < 2) {
      return [];
    }

    // Fold the query the same way `searchText` is stored so diacritics on
    // either side don't block a match ("bucuresti" ↔ "București").
    const searchQuery = foldDiacriticsToAscii(normalizedQuery);
    const safeLimit = Math.min(Math.max(Math.floor(args.limit ?? 12), 1), 30);
    const rawMatches = await ctx.db
      .query("publicEventPreviews")
      .withSearchIndex("by_title", (q) => q.search("searchText", searchQuery))
      .take(args.topicId ? safeLimit * 4 : safeLimit);

    const filtered = args.topicId
      ? rawMatches.filter((event) => event.topicIds.includes(args.topicId!))
      : rawMatches;

    return filtered.slice(0, safeLimit).map(toFeedEvent);
  },
});

export const getPublishedEventsByTopicIds = query({
  args: {
    topicIds: v.array(v.id("topics")),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const uniqueTopicIds = Array.from(new Set(args.topicIds));
    if (uniqueTopicIds.length === 0) {
      return [];
    }

    const safeLimit = Math.min(Math.max(Math.floor(args.limit ?? 5), 1), 20);
    const previews = (
      await Promise.all(
        uniqueTopicIds.map((topicId) =>
          getTopicFeedCandidates(ctx, topicId, "recent", safeLimit),
        ),
      )
    ).flat();
    const seen = new Set<string>();
    const publishedEvents = previews
      .filter((event) => {
        const key = String(event.eventId);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .sort(
        (a, b) =>
          b.lastUpdatedAt - a.lastUpdatedAt ||
          b.firstPublishedAt - a.firstPublishedAt ||
          String(b.eventId).localeCompare(String(a.eventId)),
      )
      .slice(0, safeLimit);

    return publishedEvents.map(toFeedEvent);
  },
});

export const getPublicPublishedEventsPreview = query({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const safeLimit = Math.min(Math.max(Math.floor(args.limit ?? 3), 1), 20);
    const events = await ctx.db
      .query("publicEventPreviews")
      .withIndex("by_trending_score")
      .order("desc")
      .take(safeLimit);
    return events.map(toFeedEvent);
  },
});

export const getSitemapPublishedEvents = query({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    // COST: this is a public query with no caller left (the sitemap is served
    // from `publicSitemapSnapshots`), so an unbounded default was a free way for
    // anyone holding the deployment URL to read tens of MB of preview rows.
    const safeLimit = Math.min(
      Math.max(Math.floor(args.limit ?? 2000), 1),
      2000,
    );
    const events = await ctx.db
      .query("publicEventPreviews")
      .withIndex("by_last_updated_at")
      .order("desc")
      .take(safeLimit);

    return events.map((event) => ({
      slug: event.slug,
      lastModifiedAt: event.lastUpdatedAt,
    }));
  },
});

/**
 * Recent published events for syndication feeds (/rss.xml and
 * /news-sitemap.xml). Newest first by publication time, thin-page gated: an
 * event with no neutral AI summary is mostly third-party RSS text and must not
 * be syndicated (mirrors the sitemap discipline). Returns the fields the feeds
 * need — the web layer derives the short headline and truncates copy.
 */
export const getSyndicationEvents = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const safeLimit = Math.min(Math.max(Math.floor(args.limit ?? 50), 1), 100);
    // Over-fetch, then keep only summarized events until we have `safeLimit`.
    const rows = await ctx.db
      .query("publicEventPreviews")
      .withIndex("by_first_published_at")
      .order("desc")
      .take(safeLimit * 4);

    const events: Array<{
      slug: string;
      title: string;
      summary: string;
      firstPublishedAt: number;
      lastUpdatedAt: number;
    }> = [];
    for (const event of rows) {
      const neutral = event.perspectiveSummaries?.neutral?.trim();
      if (!neutral) continue;
      events.push({
        slug: event.slug,
        title: event.title,
        summary: neutral,
        firstPublishedAt: event.firstPublishedAt,
        lastUpdatedAt: event.lastUpdatedAt,
      });
      if (events.length >= safeLimit) break;
    }
    return events;
  },
});

export const backfillPublicPreviewReadModels = internalMutation({
  args: {
    cursor: v.optional(v.string()),
    pageSize: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const pageSize = Math.min(Math.max(Math.floor(args.pageSize ?? 100), 1), 500);
    const page = await ctx.db.query("publicEventPreviews").paginate({
      cursor: args.cursor ?? null,
      numItems: pageSize,
    });

    for (const preview of page.page) {
      const existingRows = await ctx.db
        .query("publicEventPreviewTopics")
        .withIndex("by_event", (q) => q.eq("eventId", preview.eventId))
        .collect();
      const existingByTopic = new Map(
        existingRows.map((row) => [String(row.topicId), row]),
      );
      const nextTopicIds = new Set(
        preview.topicIds.map((topicId) => String(topicId)),
      );

      for (const topicId of preview.topicIds) {
        const existing = existingByTopic.get(String(topicId));
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

    if (page.isDone) {
      // Rebuild the anonymous trending snapshot once the read-model backfill
      // has populated every preview/topic row.
      await rebuildPublicFeedSnapshots(ctx);
    }

    return {
      processed: page.page.length,
      isDone: page.isDone,
      continueCursor: page.continueCursor,
    };
  },
});

export const rebuildPublicFeedSnapshotsJob = internalMutation({
  args: {},
  handler: async (ctx) => {
    await rebuildPublicFeedSnapshots(ctx);
    return { rebuilt: true as const };
  },
});

// One-shot migration for the trending-score reweight (recency 6pts/hr + coverage
// cap). `trendingScore` is written once per preview and never recomputed by a
// cron, so existing rows keep their old-formula scores — whose magnitude differs
// enough from the new formula to scramble ordering — until re-synced. This
// re-runs the normal, idempotent preview write path (which recomputes the score)
// for every existing preview, then rebuilds the anonymous snapshot on the final
// page. Paginate by feeding `continueCursor` back until `isDone`.
export const rescorePublicPreviews = internalMutation({
  args: {
    cursor: v.optional(v.string()),
    pageSize: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const pageSize = Math.min(
      Math.max(Math.floor(args.pageSize ?? 100), 1),
      500,
    );
    const page = await ctx.db.query("publicEventPreviews").paginate({
      cursor: args.cursor ?? null,
      numItems: pageSize,
    });

    for (const preview of page.page) {
      await syncPublicEventPreview(ctx, preview.eventId);
    }

    if (page.isDone) {
      await rebuildPublicFeedSnapshots(ctx);
    }

    return {
      processed: page.page.length,
      isDone: page.isDone,
      continueCursor: page.continueCursor,
    };
  },
});

const EVENT_PAGE_ARTICLE_LIMIT = 60;

export const getEventBySlug = query({
  args: { slug: v.string() },
  handler: async (ctx, args) => {
    const event = await ctx.db
      .query("events")
      .withIndex("by_slug", (q) => q.eq("slug", args.slug))
      .unique();

    // L8: an unpublished event is gone from public view instantly — the
    // route renders its not-found state.
    if (!event || event.status !== "published" || event.unpublishedAt) {
      return null;
    }

    // Load topic IDs from junction table
    const eventTopicRows = await ctx.db
      .query("eventTopics")
      .withIndex("by_event", (q) => q.eq("eventId", event._id))
      .collect();
    const topicIds = eventTopicRows.map((r) => r.topicId);

    // COST: article docs are the fattest rows in the schema (summary, atomic
    // facts, entities, bias components), and this runs on every event page view
    // and every crawler hit. A merged mega-event can accumulate well over a
    // hundred articles; the page only ever renders a coverage list, so cap the
    // read. Events at the cap show their most-recently-ingested coverage.
    const articles = await ctx.db
      .query("articles")
      .withIndex("by_event", (q) => q.eq("eventId", event._id))
      .order("desc")
      .take(EVENT_PAGE_ARTICLE_LIMIT);
    // Custom social preview images are gated by a single kill switch. While it
    // is off (dev and prod), never serve a generated share asset — even if the
    // DB still holds "ready" rows from a previous run — so the OG/share image
    // falls back to the original event photo below.
    const shareAssetsEnabled = await getConfig(
      ctx,
      EVENT_SHARE_ASSET_GENERATION_ENABLED_KEY,
      false,
    );
    const shareAsset = shareAssetsEnabled
      ? await ctx.db
          .query("eventShareAssets")
          .withIndex("by_event", (q) => q.eq("eventId", event._id))
          .order("desc")
          .first()
      : null;
    const shareImageUrl =
      shareAsset?.status === "ready" && shareAsset.storageId
        ? await ctx.storage.getUrl(shareAsset.storageId)
        : null;

    const sourceIds = Array.from(
      new Set(articles.map((article) => article.sourceId)),
    );
    const sourceRows = await Promise.all(
      sourceIds.map((sourceId) => ctx.db.get(sourceId)),
    );
    const sourcesById = new Map(
      sourceRows
        .filter((source): source is Doc<"sources"> => source !== null)
        .map((source) => [source._id, source]),
    );
    const articlesWithSources = articles.map((article) => ({
      ...article,
      source: sourcesById.get(article.sourceId) ?? null,
    }));

    // L9: publisher og:image is a hotlinked thumbnail displayed only while
    // the global + per-domain switches allow it.
    const allowedImageUrl = await filterEventImage(ctx, event);

    return {
      event: {
        _id: event._id,
        slug: event.slug,
        title: event.title,
        imageUrl: allowedImageUrl,
        imageAlt: allowedImageUrl ? event.imageAlt : undefined,
        perspectiveSummaries: normalizedPerspectives(
          event.perspectiveSummaries,
        ),
        perspectiveApplicable: event.perspectiveApplicable,
        globalImpact: event.globalImpact,
        firstPublishedAt: event.firstPublishedAt,
        lastUpdatedAt: event.lastUpdatedAt,
        topicIds,
        // L1 (AI Act art. 50(4)) — machine-readable disclosure. Published
        // events all carry AI summaries, so pre-backfill gaps default to
        // aiGenerated=true / humanReviewed=false rather than hiding the label.
        aiGenerated: event.aiGenerated ?? true,
        humanReviewed: event.humanReviewed ?? false,
        modelUsed: event.modelUsed,
        promptVersion: event.promptVersion,
        shareImageUrl: shareImageUrl ?? undefined,
        shareImageWidth:
          shareAsset?.status === "ready" ? shareAsset.width : undefined,
        shareImageHeight:
          shareAsset?.status === "ready" ? shareAsset.height : undefined,
      },
      articles: articlesWithSources,
    };
  },
});
