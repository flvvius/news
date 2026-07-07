// BIV-806 feed-parse smoke test: fetches each tier-3 (balance addition) RSS
// URL and asserts it parses as RSS/Atom with at least one item.
//
// Network-dependent, so it only runs when explicitly requested:
//   FEED_SMOKE=1 pnpm --filter @news-app/backend exec vitest run convex/feeds.smoke.test.ts
// In the normal suite the cases are skipped (not silently green).
import { describe, expect, test } from "vitest";

import { ALL_FEEDS } from "./feeds";

const smokeEnabled = process.env.FEED_SMOKE === "1";
const tier3 = ALL_FEEDS.filter((feed) => feed.tier === 3);

describe("BIV-806 balance feeds parse live", () => {
  test("tier-3 feed list is non-empty", () => {
    expect(tier3.length).toBeGreaterThanOrEqual(4);
  });

  test.skipIf(!smokeEnabled).each(tier3.map((f) => [f.domain, f.url]))(
    "%s feed responds with parseable RSS/Atom items (%s)",
    async (_domain, url) => {
      const response = await fetch(url, {
        headers: {
          "user-agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) BiviantFeedSmoke/1.0",
        },
        redirect: "follow",
        signal: AbortSignal.timeout(20_000),
      });
      expect(response.ok, `${url} returned ${response.status}`).toBe(true);

      const body = await response.text();
      expect(body).toMatch(/<rss[\s>]|<feed[\s>]/i);
      const itemCount =
        (body.match(/<item[\s>]/gi) ?? []).length +
        (body.match(/<entry[\s>]/gi) ?? []).length;
      expect(itemCount, `${url} has no items`).toBeGreaterThan(0);
    },
    30_000,
  );
});
