import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";

import {
  ROMANIAN_SOURCE_REPUTATION,
  getSourceReputation,
} from "./sourceReputation";
import { ALL_FEEDS } from "./feeds";
import schema from "./schema";
import { internal } from "./_generated/api";

const modules = (
  import.meta as unknown as {
    glob: (pattern: string) => Record<string, () => Promise<unknown>>;
  }
).glob("./**/!(*.*.*)*.*s");

describe("Romanian source reputation seed (BIV-401)", () => {
  test("covers 15-40 outlets, each well-formed with a provenance note", () => {
    expect(ROMANIAN_SOURCE_REPUTATION.length).toBeGreaterThanOrEqual(15);
    expect(ROMANIAN_SOURCE_REPUTATION.length).toBeLessThanOrEqual(40);

    for (const entry of ROMANIAN_SOURCE_REPUTATION) {
      expect(entry.biasScore).toBeGreaterThanOrEqual(-5);
      expect(entry.biasScore).toBeLessThanOrEqual(5);
      expect(entry.reliabilityScore).toBeGreaterThanOrEqual(1);
      expect(entry.reliabilityScore).toBeLessThanOrEqual(10);
      expect(
        entry.provenance.length,
        `${entry.domain} needs a provenance note`,
      ).toBeGreaterThan(20);
    }
  });

  test("every entry carries a reader-facing Romanian note", () => {
    for (const entry of ROMANIAN_SOURCE_REPUTATION) {
      expect(
        entry.readerNote.length,
        `${entry.domain} needs a readerNote`,
      ).toBeGreaterThan(20);
      expect(
        entry.readerNote,
        `${entry.domain}: readerNote must not reuse the internal provenance`,
      ).not.toBe(entry.provenance);
    }
  });

  test("reader notes never leak internal analyst shorthand", () => {
    // `provenance` is English operator shorthand carrying ticket refs, tool
    // names and process metadata ("never ingest as credible"). It shipped to
    // Romanian readers verbatim once; this is the guard against that.
    const internalMarkers = [
      /BIV-\d+/i,
      /\bMBFC\b/i,
      /Hand-scored/i,
      /\bTier [ABC]\b/i,
      /never ingest/i,
      /\bRSS\b/i,
      /whitelist/i,
    ];
    for (const entry of ROMANIAN_SOURCE_REPUTATION) {
      for (const marker of internalMarkers) {
        expect(
          marker.test(entry.readerNote),
          `${entry.domain}: readerNote contains internal marker ${marker}`,
        ).toBe(false);
      }
    }
  });

  test("domains are unique", () => {
    const domains = ROMANIAN_SOURCE_REPUTATION.map((e) => e.domain);
    expect(new Set(domains).size).toBe(domains.length);
  });

  test("every launch feed domain resolves to a reputation entry", () => {
    for (const feed of ALL_FEEDS) {
      const entry = getSourceReputation(feed.domain);
      expect(entry, `${feed.domain} missing from reputation seed`).toBeDefined();
      // feeds.ts derives its ratings from the seed — they must agree
      expect(feed.baseBias).toBe(entry!.biasScore);
      expect(feed.reliabilityScore).toBe(entry!.reliabilityScore);
    }
  });

  test("low-reliability layer outlets are capped and the whitelist has a floor", () => {
    const lowReliability = [
      "activenews.ro",
      "solidnews.ro",
      "national.ro",
      "ortodoxinfo.ro",
    ];
    for (const domain of lowReliability) {
      const entry = getSourceReputation(domain);
      expect(entry, `${domain} must be seeded`).toBeDefined();
      expect(entry!.reliabilityScore).toBeLessThanOrEqual(4);
    }

    const whitelist = ["recorder.ro", "pressone.ro", "context.ro", "g4media.ro"];
    for (const domain of whitelist) {
      const entry = getSourceReputation(domain);
      expect(entry, `${domain} must be seeded`).toBeDefined();
      expect(entry!.reliabilityScore).toBeGreaterThanOrEqual(7);
    }
  });

  // BIV-806: the balance additions carry BOTH an axis score and an
  // independently-assigned reliability score, and no Tier-C disinformation
  // node ever rises above bottom reliability.
  test("BIV-806 balance additions have axis + honest reliability scores", () => {
    const additions: Record<string, { maxReliability: number }> = {
      // Tier A — mainstream suveranist-leaning, moderate(-low) reliability
      "romaniatv.net": { maxReliability: 4 },
      "realitatea.net": { maxReliability: 4 },
      // Tier B — hard nationalist, low reliability
      "activenews.ro": { maxReliability: 3 },
      "national.ro": { maxReliability: 3 },
      "napocanews.ro": { maxReliability: 3 },
      "certitudinea.ro": { maxReliability: 3 },
      "buciumul.ro": { maxReliability: 3 },
      "ziarulnatiunea.ro": { maxReliability: 3 },
    };
    for (const [domain, { maxReliability }] of Object.entries(additions)) {
      const entry = getSourceReputation(domain);
      expect(entry, `${domain} must be seeded`).toBeDefined();
      expect(entry!.biasScore, `${domain} must be suveranist-leaning`)
        .toBeGreaterThan(0);
      expect(entry!.biasScore).toBeLessThanOrEqual(5);
      expect(entry!.reliabilityScore).toBeGreaterThanOrEqual(1);
      expect(
        entry!.reliabilityScore,
        `${domain} reliability must stay honest`,
      ).toBeLessThanOrEqual(maxReliability);
    }
  });

  test("Tier-C disinformation nodes never exceed bottom reliability (BIV-806)", () => {
    const tierC = ["flux24.ro", "solidnews.ro", "aznews.ro", "ortodoxinfo.ro"];
    for (const domain of tierC) {
      const entry = getSourceReputation(domain);
      expect(entry, `${domain} must be seeded (rated LOW, not neutral)`)
        .toBeDefined();
      expect(
        entry!.reliabilityScore,
        `${domain} must sit at bottom reliability`,
      ).toBeLessThanOrEqual(1);
    }
  });

  test("seedRomanianSources upserts rows idempotently", async () => {
    const t = convexTest(schema, modules);

    // Pre-existing row (created by ingestion) gets refreshed, not duplicated.
    await t.run(async (ctx) => {
      await ctx.db.insert("sources", {
        domain: "digi24.ro",
        name: "Digi24",
        baseBias: 0,
        reliabilityScore: 5,
      });
    });

    const first = await t.mutation(internal.seeds.seedRomanianSources, {});
    expect(first.updated).toBe(1);
    expect(first.created).toBe(ROMANIAN_SOURCE_REPUTATION.length - 1);

    const second = await t.mutation(internal.seeds.seedRomanianSources, {});
    expect(second.created).toBe(0);
    expect(second.updated).toBe(ROMANIAN_SOURCE_REPUTATION.length);

    await t.run(async (ctx) => {
      const digi = await ctx.db
        .query("sources")
        .withIndex("by_domain", (q) => q.eq("domain", "digi24.ro"))
        .collect();
      expect(digi).toHaveLength(1);
      expect(digi[0]!.baseBias).toBe(-1);
      expect(digi[0]!.bias).toEqual({ axis: "reformist_suveranist", score: -1 });
      expect(digi[0]!.reliabilityScore).toBe(8);
      expect(digi[0]!.provenance).toContain("Hand-scored");
    });
  });
});
