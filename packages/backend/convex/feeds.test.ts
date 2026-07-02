import { describe, expect, test } from "vitest";

import { ALL_FEEDS, FEED_COUNT } from "./feeds";
import { isFeedQuarantined } from "./ingestion";

const TIER_1_DOMAINS = [
  "digi24.ro",
  "hotnews.ro",
  "g4media.ro",
  "recorder.ro",
  "agerpres.ro",
  "zf.ro",
  "riseproject.ro",
  "romania.europalibera.org",
];

describe("Romanian feed list (BIV-101)", () => {
  test("staged ramp: 15-20 feeds, not 100", () => {
    expect(FEED_COUNT).toBeGreaterThanOrEqual(15);
    expect(FEED_COUNT).toBeLessThanOrEqual(20);
  });

  test("contains the full verified-direct tier-1 set", () => {
    const domains = new Set(ALL_FEEDS.map((f) => f.domain));
    for (const domain of TIER_1_DOMAINS) {
      expect(domains, `missing tier-1 domain ${domain}`).toContain(domain);
    }
  });

  test("contains only Romanian sources", () => {
    for (const feed of ALL_FEEDS) {
      const isRomanian =
        feed.domain.endsWith(".ro") ||
        feed.domain === "romania.europalibera.org";
      expect(isRomanian, `${feed.domain} is not a Romanian source`).toBe(true);
    }
  });

  test("domains and URLs are unique", () => {
    const domains = ALL_FEEDS.map((f) => f.domain);
    const urls = ALL_FEEDS.map((f) => f.url);
    expect(new Set(domains).size).toBe(domains.length);
    expect(new Set(urls).size).toBe(urls.length);
  });

  test("every entry is well-formed", () => {
    for (const feed of ALL_FEEDS) {
      expect(feed.url).toMatch(/^https:\/\//);
      expect(feed.name.length).toBeGreaterThan(0);
      expect([1, 2]).toContain(feed.tier);
      expect(feed.baseBias).toBeGreaterThanOrEqual(-5);
      expect(feed.baseBias).toBeLessThanOrEqual(5);
      expect(feed.reliabilityScore).toBeGreaterThanOrEqual(1);
      expect(feed.reliabilityScore).toBeLessThanOrEqual(10);
    }
  });
});

describe("feed quarantine policy (BIV-101)", () => {
  const NOW = 1_750_000_000_000;
  const HOUR = 60 * 60 * 1000;

  test("feeds without history are not quarantined", () => {
    expect(isFeedQuarantined(null, NOW)).toBe(false);
  });

  test("healthy and mildly failing feeds are not quarantined", () => {
    expect(
      isFeedQuarantined(
        { consecutiveFailures: 0, lastIngestedAt: NOW - HOUR },
        NOW,
      ),
    ).toBe(false);
    expect(
      isFeedQuarantined(
        { consecutiveFailures: 4, lastIngestedAt: NOW - HOUR },
        NOW,
      ),
    ).toBe(false);
  });

  test("repeatedly failing feeds are quarantined within the backoff window", () => {
    expect(
      isFeedQuarantined(
        { consecutiveFailures: 5, lastIngestedAt: NOW - HOUR },
        NOW,
      ),
    ).toBe(true);
    expect(
      isFeedQuarantined(
        { consecutiveFailures: 12, lastIngestedAt: NOW - 5 * HOUR },
        NOW,
      ),
    ).toBe(true);
  });

  test("quarantined feeds get a probe attempt after the backoff interval", () => {
    expect(
      isFeedQuarantined(
        { consecutiveFailures: 9, lastIngestedAt: NOW - 7 * HOUR },
        NOW,
      ),
    ).toBe(false);
    expect(
      isFeedQuarantined({ consecutiveFailures: 9 }, NOW),
    ).toBe(false);
  });
});
