import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";

import { computeTrendingScore } from "./lib/publicEventPreviews";
import schema from "./schema";
import { api } from "./_generated/api";

// See interactions.test.ts for the glob rationale (drops convex.config.ts,
// *.test.ts and *.d.ts so the Better Auth component never instantiates).
const modules = (
  import.meta as unknown as {
    glob: (pattern: string) => Record<string, () => Promise<unknown>>;
  }
).glob("./**/!(*.*.*)*.*s");

const HOUR_MS = 3_600_000;
// Recency weight from computeTrendingScore: 1 point every 10 min = 6 pts/hour.
const RECENCY_PER_HOUR = 6;

describe("computeTrendingScore (BIV-801: graceful degradation)", () => {
  test("prefers claim-verified counts when present", () => {
    const score = computeTrendingScore({
      factualSourceCount: 4,
      factualArticleCount: 10,
      sourceCount: 9,
      articleCount: 30,
      lastUpdatedAt: HOUR_MS,
      firstPublishedAt: 0,
    });
    expect(score).toBe(4 * 10 + 10 * 3 + RECENCY_PER_HOUR);
  });

  test("regression: falls back to raw coverage when claim analysis never ran (undefined)", () => {
    const score = computeTrendingScore({
      sourceCount: 5,
      articleCount: 12,
      lastUpdatedAt: HOUR_MS,
      firstPublishedAt: 0,
    });
    expect(score).toBe(5 * 10 + 12 * 3 + RECENCY_PER_HOUR);
  });

  test("regression: treats zeroed factual counts (paused pipeline) like absent ones", () => {
    const score = computeTrendingScore({
      factualSourceCount: 0,
      factualArticleCount: 0,
      sourceCount: 5,
      articleCount: 12,
      lastUpdatedAt: HOUR_MS,
      firstPublishedAt: 0,
    });
    expect(score).toBe(5 * 10 + 12 * 3 + RECENCY_PER_HOUR);
  });

  test("without any coverage signal, only recency remains (never NaN)", () => {
    const score = computeTrendingScore({
      firstPublishedAt: 2 * HOUR_MS,
    });
    expect(score).toBe(2 * RECENCY_PER_HOUR);
  });

  test("caps the coverage bonus so a stale but heavily-covered event cannot outrank fresh ones", () => {
    // A huge story (30 sources * 10 + 80 articles * 3 = 540) is capped to 288
    // points of coverage — worth ~48h of recency. Once its lastUpdatedAt is
    // more than that far in the past, a zero-coverage but fresh event wins.
    const now = 1_000 * HOUR_MS;
    const staleHuge = computeTrendingScore({
      sourceCount: 30,
      articleCount: 80,
      lastUpdatedAt: now - 72 * HOUR_MS, // 3 days stale
      firstPublishedAt: now - 72 * HOUR_MS,
    });
    const freshThin = computeTrendingScore({
      sourceCount: 0,
      articleCount: 0,
      lastUpdatedAt: now,
      firstPublishedAt: now,
    });
    expect(staleHuge).toBeLessThan(freshThin);
  });
});

// BIV-801 regression: the `sort` arg must be honored — trending and latest
// must produce different orderings when coverage differs. (Trending ranks on
// source/article corroboration + recency, not user interactions, so the
// seeded divergence signal is coverage.)
describe("events.getPublishedEvents sort arg (BIV-801)", () => {
  async function seedPreviews() {
    const t = convexTest(schema, modules);
    const now = Date.now();

    await t.run(async (ctx) => {
      const mkEvent = async (title: string) =>
        await ctx.db.insert("events", {
          title,
          slug: title.toLowerCase().replace(/\s+/g, "-"),
          status: "published",
          firstPublishedAt: now - 10 * HOUR_MS,
        } as never);

      // "fresh-thin": newest but barely corroborated → wins "recent",
      // loses "trending".
      // "older-corroborated": 4h older but heavily corroborated → wins
      // "trending" (12 sources * 10 = 120 points ≫ 4 recency points).
      const rows = [
        {
          title: "fresh thin",
          lastUpdatedAt: now,
          sourceCount: 1,
          articleCount: 1,
        },
        {
          title: "older corroborated",
          lastUpdatedAt: now - 4 * HOUR_MS,
          sourceCount: 12,
          articleCount: 20,
        },
        {
          title: "middle",
          lastUpdatedAt: now - 2 * HOUR_MS,
          sourceCount: 3,
          articleCount: 5,
        },
      ];

      for (const row of rows) {
        const eventId = await mkEvent(row.title);
        await ctx.db.insert("publicEventPreviews", {
          eventId,
          slug: row.title.toLowerCase().replace(/\s+/g, "-"),
          title: row.title,
          firstPublishedAt: now - 10 * HOUR_MS,
          lastUpdatedAt: row.lastUpdatedAt,
          articleCount: row.articleCount,
          sourceCount: row.sourceCount,
          topicIds: [],
          trendingScore: computeTrendingScore({
            sourceCount: row.sourceCount,
            articleCount: row.articleCount,
            lastUpdatedAt: row.lastUpdatedAt,
            firstPublishedAt: now - 10 * HOUR_MS,
          }),
          sourceBiasCounts: { left: 0, center: 0, right: 0 },
          sources: [],
          updatedAt: now,
        });
      }
    });

    return t;
  }

  test("trending and recent produce different orderings on the same data", async () => {
    const t = await seedPreviews();

    const recent = await t.query(api.events.getPublishedEvents, {
      paginationOpts: { numItems: 10, cursor: null },
      sort: "recent",
    });
    const trending = await t.query(api.events.getPublishedEvents, {
      paginationOpts: { numItems: 10, cursor: null },
      sort: "trending",
    });

    const recentTitles = recent.page.map(
      (event: { title: string }) => event.title,
    );
    const trendingTitles = trending.page.map(
      (event: { title: string }) => event.title,
    );

    expect(recentTitles).toEqual(["fresh thin", "middle", "older corroborated"]);
    expect(trendingTitles).toEqual([
      "older corroborated",
      "middle",
      "fresh thin",
    ]);
    expect(trendingTitles).not.toEqual(recentTitles);
  });

  test("omitting sort defaults to trending", async () => {
    const t = await seedPreviews();

    const defaulted = await t.query(api.events.getPublishedEvents, {
      paginationOpts: { numItems: 10, cursor: null },
    });

    expect(
      defaulted.page.map((event: { title: string }) => event.title)[0],
    ).toBe("older corroborated");
  });
});
