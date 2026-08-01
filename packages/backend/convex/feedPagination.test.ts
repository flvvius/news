import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";

import { computeTrendingScore } from "./lib/publicEventPreviews";
import schema from "./schema";
import { api, internal } from "./_generated/api";

// See interactions.test.ts for the glob rationale (drops convex.config.ts,
// *.test.ts and *.d.ts so the Better Auth component never instantiates).
const modules = (
  import.meta as unknown as {
    glob: (pattern: string) => Record<string, () => Promise<unknown>>;
  }
).glob("./**/!(*.*.*)*.*s");

const HOUR_MS = 3_600_000;

async function seed(count: number) {
  const t = convexTest(schema, modules);
  const now = Date.now();
  await t.run(async (ctx) => {
    for (let i = 0; i < count; i++) {
      const title = `event ${String(i).padStart(3, "0")}`;
      const lastUpdatedAt = now - i * HOUR_MS;
      const eventId = await ctx.db.insert("events", {
        title,
        slug: title.replace(/\s+/g, "-"),
        status: "published",
        firstPublishedAt: now - 200 * HOUR_MS,
      } as never);
      await ctx.db.insert("publicEventPreviews", {
        eventId,
        slug: title.replace(/\s+/g, "-"),
        title,
        firstPublishedAt: now - 200 * HOUR_MS,
        lastUpdatedAt,
        articleCount: 1,
        sourceCount: 1,
        topicIds: [],
        trendingScore: computeTrendingScore({
          sourceCount: 1,
          articleCount: 1,
          lastUpdatedAt,
          firstPublishedAt: now - 200 * HOUR_MS,
        }),
        sourceBiasCounts: { left: 0, center: 0, right: 0 },
        sources: [],
        updatedAt: now,
      });
    }
  });
  return t;
}

async function walk(
  t: Awaited<ReturnType<typeof seed>>,
  args: Record<string, unknown>,
  pageSize: number,
  maxPages = 100,
) {
  const titles: string[] = [];
  let cursor: string | null = null;
  let pages = 0;
  for (;;) {
    const res: {
      page: Array<{ title: string }>;
      isDone: boolean;
      continueCursor: string;
    } = await t.query(api.events.getPublishedEvents, {
      ...args,
      paginationOpts: { numItems: pageSize, cursor },
    });
    titles.push(...res.page.map((e) => e.title));
    pages++;
    if (res.isDone) break;
    // Fail loudly rather than returning a truncated result: a walk that runs
    // away is a bug, and silently capping it would let the completeness
    // assertions below pass on partial data.
    expect(pages, "pagination did not terminate").toBeLessThan(maxPages);
    cursor = res.continueCursor;
    expect(cursor).not.toBe("");
  }
  return { titles, pages };
}

/**
 * Seed `count` previews that all share one `lastUpdatedAt`, and therefore one
 * `trendingScore`. Ties are the pathological case for cursor-anchored ranking:
 * every row sits at the same index key, so the cursor cannot separate them by
 * score alone.
 */
async function seedTied(count: number) {
  const t = convexTest(schema, modules);
  const now = Date.now();
  const lastUpdatedAt = now - HOUR_MS;
  const firstPublishedAt = now - 200 * HOUR_MS;
  await t.run(async (ctx) => {
    for (let i = 0; i < count; i++) {
      const title = `tied ${String(i).padStart(3, "0")}`;
      const slug = title.replace(/\s+/g, "-");
      const eventId = await ctx.db.insert("events", {
        title,
        slug,
        status: "published",
        firstPublishedAt,
      } as never);
      await ctx.db.insert("publicEventPreviews", {
        eventId,
        slug,
        title,
        firstPublishedAt,
        lastUpdatedAt,
        articleCount: 1,
        sourceCount: 1,
        topicIds: [],
        trendingScore: computeTrendingScore({
          sourceCount: 1,
          articleCount: 1,
          lastUpdatedAt,
          firstPublishedAt,
        }),
        sourceBiasCounts: { left: 0, center: 0, right: 0 },
        sources: [],
        updatedAt: now,
      });
    }
  });
  return t;
}

// COST-MODE regression guard. `events.getPublishedEvents` was rewritten from
// "scan the top 250 preview rows on every page and slice in JS" to cursor-
// anchored index ranges, with the anonymous trending snapshot serving several
// pages instead of just the first. Those two changes cut the app's single
// largest source of database I/O, but they move real ordering/termination logic
// onto the cursor — so pin the observable contract: a full walk must return
// every event exactly once, in ranked order, and must terminate.
describe("ranked pagination (cursor-anchored)", () => {
  test("trending walk yields every event exactly once, in score order", async () => {
    const t = await seed(40);
    const { titles } = await walk(t, { sort: "trending" }, 6);
    expect(titles.length).toBe(40);
    expect(new Set(titles).size).toBe(40);
    expect(titles).toEqual([...titles].sort());
  });

  // Regression: a run of rows tying on the index key that is longer than
  // RANKED_PAGE_BUFFER filled an entire window with rows sorting at or before
  // the cursor. The page came back empty, which was indistinguishable from "the
  // feed ended" — so the feed silently truncated mid-list and the reader simply
  // stopped seeing events. 40 tied rows is well past the 12-row buffer.
  test("tie run longer than the page buffer does not truncate the feed", async () => {
    const t = await seedTied(40);
    const { titles } = await walk(t, { sort: "trending" }, 6);
    expect(titles.length).toBe(40);
    expect(new Set(titles).size).toBe(40);
  });

  test("tie run is walkable on the recent sort too", async () => {
    const t = await seedTied(30);
    const { titles } = await walk(t, { sort: "recent" }, 6);
    expect(titles.length).toBe(30);
    expect(new Set(titles).size).toBe(30);
  });

  test("depth cap stops the ranked feed", async () => {
    const t = await seed(300);
    const { titles } = await walk(t, { sort: "trending" }, 10);
    expect(titles.length).toBe(240);
    expect(new Set(titles).size).toBe(240);
  });

  test("snapshot serves multiple pages then hands off to the live path", async () => {
    const t = await seed(60);
    await t.mutation(internal.events.rebuildPublicFeedSnapshotsJob, {});
    const { titles } = await walk(t, { sort: "trending" }, 6);
    expect(titles.length).toBe(60);
    expect(new Set(titles).size).toBe(60);
    expect(titles).toEqual([...titles].sort());
  });

  test("topic-filtered trending walk is complete and ordered", async () => {
    const t = convexTest(schema, modules);
    const now = Date.now();
    const topicId = await t.run(async (ctx) => {
      const tid = await ctx.db.insert("topics", {
        slug: "politica",
        displayName: "Politica",
      } as never);
      for (let i = 0; i < 30; i++) {
        const title = `t ${String(i).padStart(3, "0")}`;
        const lastUpdatedAt = now - i * HOUR_MS;
        const eventId = await ctx.db.insert("events", {
          title,
          slug: title.replace(/\s+/g, "-"),
          status: "published",
          firstPublishedAt: now - 200 * HOUR_MS,
        } as never);
        const trendingScore = computeTrendingScore({
          sourceCount: 1,
          articleCount: 1,
          lastUpdatedAt,
          firstPublishedAt: now - 200 * HOUR_MS,
        });
        const previewId = await ctx.db.insert("publicEventPreviews", {
          eventId,
          slug: title.replace(/\s+/g, "-"),
          title,
          firstPublishedAt: now - 200 * HOUR_MS,
          lastUpdatedAt,
          articleCount: 1,
          sourceCount: 1,
          topicIds: [tid],
          trendingScore,
          sourceBiasCounts: { left: 0, center: 0, right: 0 },
          sources: [],
          updatedAt: now,
        });
        await ctx.db.insert("publicEventPreviewTopics", {
          topicId: tid,
          eventId,
          previewId,
          lastUpdatedAt,
          firstPublishedAt: now - 200 * HOUR_MS,
          trendingScore,
          updatedAt: now,
        });
      }
      return tid;
    });
    const { titles } = await walk(t, { sort: "trending", topicId }, 7);
    expect(titles.length).toBe(30);
    expect(new Set(titles).size).toBe(30);
    expect(titles).toEqual([...titles].sort());
  });

  test("stale snapshot cursor falls through to the live path", async () => {
    const t = await seed(40);
    await t.mutation(internal.events.rebuildPublicFeedSnapshotsJob, {});
    const first: { continueCursor: string } = await t.query(
      api.events.getPublishedEvents,
      { sort: "trending", paginationOpts: { numItems: 6, cursor: null } },
    );
    // Simulate a client holding a cursor from a snapshot generation the server
    // no longer has.
    await t.run(async (ctx) => {
      const snap = await ctx.db.query("publicFeedSnapshots").first();
      if (snap) {
        await ctx.db.patch(snap._id, {
          payloadJson: JSON.stringify({ items: [], cursors: [] }),
        });
      }
    });
    const second: { page: Array<{ title: string }> } = await t.query(
      api.events.getPublishedEvents,
      {
        sort: "trending",
        paginationOpts: { numItems: 6, cursor: first.continueCursor },
      },
    );
    expect(second.page.length).toBe(6);
    expect(second.page[0].title).toBe("event 006");
  });
});
