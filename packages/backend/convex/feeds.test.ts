import { describe, expect, test } from "vitest";

import { ALL_FEEDS, FEED_COUNT } from "./feeds";
import { isFeedQuarantined } from "./ingestion";

const TIER_1_DOMAINS = [
  "digi24.ro",
  "hotnews.ro",
  "g4media.ro",
  "recorder.ro",
  "zf.ro",
  "riseproject.ro",
  "romania.europalibera.org",
];

describe("Romanian feed list (BIV-101)", () => {
  test("staged ramp: 15-20 feeds, not 100", () => {
    expect(FEED_COUNT).toBeGreaterThanOrEqual(15);
    expect(FEED_COUNT).toBeLessThanOrEqual(20);
  });

  // BIV-806: suveranist balance additions must widen the mix without the
  // ratio collapsing to 50/50, and reliability must stay honest.
  test("bias mix is slightly more balanced, not equal (BIV-806)", () => {
    const reformist = ALL_FEEDS.filter((f) => f.baseBias < 0).length;
    const neutral = ALL_FEEDS.filter((f) => f.baseBias === 0).length;
    const suveranist = ALL_FEEDS.filter((f) => f.baseBias > 0).length;
    // BIV-806 landed 8:5:6; dropping Agerpres (a neutral wire feed) leaves
    // 8:4:6. A future deliberate rebalance must update this test AND
    // docs/source-balance-biv806.md together.
    expect({ reformist, neutral, suveranist }).toEqual({
      reformist: 8,
      neutral: 4,
      suveranist: 6,
    });
    // Invariant behind the numbers: never equal or inverted.
    expect(reformist).toBeGreaterThan(suveranist);
  });

  test("no Tier-C disinformation domain is ever ingested (BIV-806)", () => {
    const tierC = ["flux24.ro", "solidnews.ro", "aznews.ro", "ortodoxinfo.ro"];
    const feedDomains = new Set(ALL_FEEDS.map((f) => f.domain));
    for (const domain of tierC) {
      expect(feedDomains, `${domain} must never be a feed`).not.toContain(
        domain,
      );
    }
  });

  test("reputation-only Tier-B domains stay out of the feed list (BIV-806)", () => {
    // Low-volume/unstable outlets are rated but deliberately not ingested.
    const reputationOnly = [
      "napocanews.ro",
      "certitudinea.ro",
      "buciumul.ro",
      "ziarulnatiunea.ro",
    ];
    const feedDomains = new Set(ALL_FEEDS.map((f) => f.domain));
    for (const domain of reputationOnly) {
      expect(feedDomains, `${domain} is reputation-only`).not.toContain(
        domain,
      );
    }
  });

  test("tier-3 balance feeds carry honest (low/moderate) reliability (BIV-806)", () => {
    const tier3 = ALL_FEEDS.filter((f) => f.tier === 3);
    expect(tier3.length).toBeGreaterThanOrEqual(4);
    for (const feed of tier3) {
      expect(feed.baseBias, `${feed.domain} must be suveranist-leaning`)
        .toBeGreaterThan(0);
      expect(
        feed.reliabilityScore,
        `${feed.domain} must not carry a misleadingly high reliability`,
      ).toBeLessThanOrEqual(4);
      expect(feed.mbfc.credibility).toBe("low");
    }
  });

  test("contains the full verified-direct tier-1 set", () => {
    const domains = new Set(ALL_FEEDS.map((f) => f.domain));
    for (const domain of TIER_1_DOMAINS) {
      expect(domains, `missing tier-1 domain ${domain}`).toContain(domain);
    }
  });

  test("contains only Romanian sources", () => {
    // Romanian outlets that publish under a non-.ro domain.
    const romanianNonRoDomains = new Set([
      "romania.europalibera.org",
      "realitatea.net",
      "romaniatv.net",
    ]);
    for (const feed of ALL_FEEDS) {
      const isRomanian =
        feed.domain.endsWith(".ro") || romanianNonRoDomains.has(feed.domain);
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
      expect([1, 2, 3]).toContain(feed.tier);
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
