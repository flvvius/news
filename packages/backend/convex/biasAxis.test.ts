import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";

import {
  BIAS_AXIS,
  biasScoreOf,
  clampBiasScore,
  namedAxisBias,
  normalizedPerspectives,
} from "./lib/biasAxis";
import schema from "./schema";
import { api } from "./_generated/api";

const modules = (
  import.meta as unknown as {
    glob: (pattern: string) => Record<string, () => Promise<unknown>>;
  }
).glob("./**/!(*.*.*)*.*s");

describe("namedAxisBias helpers (BIV-302)", () => {
  test("builds the canonical object on the launch axis", () => {
    expect(namedAxisBias(-3)).toEqual({
      axis: "reformist_suveranist",
      score: -3,
    });
    expect(namedAxisBias(0).axis).toBe(BIAS_AXIS);
  });

  test("clamps scores to -5..+5 and defuses non-finite input", () => {
    expect(clampBiasScore(9)).toBe(5);
    expect(clampBiasScore(-12)).toBe(-5);
    expect(clampBiasScore(Number.NaN)).toBe(0);
    expect(namedAxisBias(7)).toEqual({ axis: BIAS_AXIS, score: 5 });
  });

  test("biasScoreOf reads the object with fallback", () => {
    expect(biasScoreOf({ axis: BIAS_AXIS, score: 2 }, 0)).toBe(2);
    expect(biasScoreOf(undefined, -1)).toBe(-1);
    expect(biasScoreOf(null, 4)).toBe(4);
  });
});

describe("normalizedPerspectives (BIV-303)", () => {
  test("passes canonical keys through", () => {
    expect(
      normalizedPerspectives({ neutral: "n", reformist: "r", suveranist: "s" }),
    ).toEqual({ neutral: "n", reformist: "r", suveranist: "s" });
  });

  test("falls back to legacy center/left/right keys", () => {
    expect(
      normalizedPerspectives({ center: "c", left: "l", right: "r" }),
    ).toEqual({ neutral: "c", reformist: "l", suveranist: "r" });
  });

  test("prefers canonical keys over legacy on mixed rows", () => {
    expect(normalizedPerspectives({ neutral: "new", center: "old" })).toEqual({
      neutral: "new",
    });
  });

  test("returns undefined for empty or missing input", () => {
    expect(normalizedPerspectives(undefined)).toBeUndefined();
    expect(normalizedPerspectives({})).toBeUndefined();
  });

  // BIV-812: a stored side field is what makes the UI render its tab, so the
  // retired "Acoperire limitată…" placeholder must not survive the read path —
  // otherwise events summarized before prompt v8 keep showing a tab with
  // nothing in it until they are resummarized.
  test("drops retired placeholder side summaries", () => {
    expect(
      normalizedPerspectives({
        neutral: "n",
        reformist:
          "Acoperire limitată din partea surselor cu orientare reformistă.",
        suveranist: "Antena 3 titrează pe rata de promovare.",
      }),
    ).toEqual({
      neutral: "n",
      suveranist: "Antena 3 titrează pe rata de promovare.",
    });
    // Legacy left/right keys go through the same filter.
    expect(
      normalizedPerspectives({
        center: "n",
        left: "Acoperire limitată din partea surselor cu orientare reformistă.",
      }),
    ).toEqual({ neutral: "n" });
    // A placeholder-only object has nothing left to show.
    expect(
      normalizedPerspectives({
        reformist:
          "Acoperire limitată din partea surselor cu orientare reformistă.",
      }),
    ).toBeUndefined();
  });
});

describe("backfillPerspectiveAxisKeys migration (BIV-303)", () => {
  test("converts legacy event and preview rows to axis keys", async () => {
    const t = convexTest(schema, modules);
    const eventId = await t.run(async (ctx) => {
      return await ctx.db.insert("events", {
        title: "Legacy event",
        slug: "legacy-event",
        status: "published",
        firstPublishedAt: Date.now(),
        perspectiveSummaries: { center: "c", left: "l", right: "r" },
      });
    });

    const result = await t.mutation(
      api.migrations.backfillPerspectiveAxisKeys,
      {},
    );
    expect(result.updatedEvents).toBe(1);

    await t.run(async (ctx) => {
      const event = await ctx.db.get(eventId);
      expect(event?.perspectiveSummaries).toEqual({
        neutral: "c",
        reformist: "l",
        suveranist: "r",
      });
    });

    // Second run is a no-op.
    const second = await t.mutation(
      api.migrations.backfillPerspectiveAxisKeys,
      {},
    );
    expect(second.updatedEvents).toBe(0);
  });
});

describe("backfillNamedAxisBias migration (BIV-302)", () => {
  test("backfills sources and scored articles, skips already-migrated rows", async () => {
    const t = convexTest(schema, modules);

    const { legacySourceId, migratedSourceId, scoredArticleId, unscoredArticleId } =
      await t.run(async (ctx) => {
        const legacySourceId = await ctx.db.insert("sources", {
          domain: "digi24.ro",
          name: "Digi24",
          baseBias: -1,
          reliabilityScore: 8,
        });
        const migratedSourceId = await ctx.db.insert("sources", {
          domain: "biziday.ro",
          name: "Biziday",
          bias: { axis: "reformist_suveranist", score: 0 },
          baseBias: 0,
          reliabilityScore: 8,
        });
        const scoredArticleId = await ctx.db.insert("articles", {
          sourceId: legacySourceId,
          title: "Test",
          url: "https://digi24.ro/a",
          canonicalUrl: "https://digi24.ro/a",
          status: "enriched",
          publishedAt: Date.now(),
          aiBiasScore: 2,
        });
        const unscoredArticleId = await ctx.db.insert("articles", {
          sourceId: legacySourceId,
          title: "Test 2",
          url: "https://digi24.ro/b",
          canonicalUrl: "https://digi24.ro/b",
          status: "unprocessed",
          publishedAt: Date.now(),
        });
        return {
          legacySourceId,
          migratedSourceId,
          scoredArticleId,
          unscoredArticleId,
        };
      });

    const result = await t.mutation(api.migrations.backfillNamedAxisBias, {
      autoContinue: false,
    });
    expect(result.sourcesPatched).toBe(1);
    expect(result.articlesPatched).toBe(1);
    expect(result.isDone).toBe(true);

    await t.run(async (ctx) => {
      const legacySource = await ctx.db.get(legacySourceId);
      expect(legacySource?.bias).toEqual({
        axis: "reformist_suveranist",
        score: -1,
      });
      // baseBias mirror untouched
      expect(legacySource?.baseBias).toBe(-1);

      const migratedSource = await ctx.db.get(migratedSourceId);
      expect(migratedSource?.bias?.score).toBe(0);

      const scoredArticle = await ctx.db.get(scoredArticleId);
      expect(scoredArticle?.aiBias).toEqual({
        axis: "reformist_suveranist",
        score: 2,
      });
      expect(scoredArticle?.aiBiasScore).toBe(2);

      const unscoredArticle = await ctx.db.get(unscoredArticleId);
      expect(unscoredArticle?.aiBias).toBeUndefined();
    });
  });

  test("is idempotent on a second run", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      const sourceId = await ctx.db.insert("sources", {
        domain: "hotnews.ro",
        name: "HotNews",
        baseBias: -2,
        reliabilityScore: 8,
      });
      await ctx.db.insert("articles", {
        sourceId,
        title: "T",
        url: "https://hotnews.ro/a",
        canonicalUrl: "https://hotnews.ro/a",
        status: "enriched",
        publishedAt: Date.now(),
        aiBiasScore: -1,
      });
    });

    const first = await t.mutation(api.migrations.backfillNamedAxisBias, {
      autoContinue: false,
    });
    const second = await t.mutation(api.migrations.backfillNamedAxisBias, {
      autoContinue: false,
    });
    expect(first.sourcesPatched + first.articlesPatched).toBe(2);
    expect(second.sourcesPatched + second.articlesPatched).toBe(0);
  });
});
