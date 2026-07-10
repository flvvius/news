// L5: TDM opt-out resolver — signal parsing, state evaluation, and the
// purge that fires when a domain becomes more restrictive.
import { convexTest, type TestConvex } from "convex-test";
import { describe, expect, test, vi } from "vitest";

import schema from "./schema";
import { internal } from "./_generated/api";
import {
  aiTxtDisallowsText,
  declaresNoAi,
  evaluateTdmSignals,
  extractionAllowed,
  htmlDeclaresTdmReservation,
  normalizeDomain,
  robotsCrawlDelay,
  robotsDisallowsAll,
  tdmHeaderReservesRights,
  tdmrepReservesRights,
} from "./lib/tdmPolicy";

const modules = (
  import.meta as unknown as {
    glob: (pattern: string) => Record<string, () => Promise<unknown>>;
  }
).glob("./**/!(*.*.*)*.*s");

type ConvexT = TestConvex<typeof schema>;

describe("TDM signal parsing (L5)", () => {
  test("TDM-Reservation: 1 header reserves rights → rss_only, no extraction", () => {
    expect(tdmHeaderReservesRights("1")).toBe(true);
    expect(tdmHeaderReservesRights("0")).toBe(false);

    const evaluation = evaluateTdmSignals({ tdmReservationHeader: "1" });
    expect(evaluation.state).toBe("rss_only");
    expect(evaluation.signals).toContain("tdm_reservation_header");
    expect(extractionAllowed(evaluation.state)).toBe(false);
  });

  test("tdmrep.json reservation is detected", () => {
    const json = JSON.stringify([
      { location: "/", "tdm-reservation": 1 },
    ]);
    expect(tdmrepReservesRights(json)).toBe(true);
    expect(
      tdmrepReservesRights(JSON.stringify([{ "tdm-reservation": 0 }])),
    ).toBe(false);
    expect(tdmrepReservesRights("not json")).toBe(false);
  });

  test("tdm-reservation meta tag is detected", () => {
    expect(
      htmlDeclaresTdmReservation(
        `<head><meta name="tdm-reservation" content="1"></head>`,
      ),
    ).toBe(true);
    expect(
      htmlDeclaresTdmReservation(
        `<head><meta name="tdm-reservation" content="0"></head>`,
      ),
    ).toBe(false);
  });

  test("robots.txt: our token, *, and AI-convention tokens", () => {
    const robots = [
      "User-agent: *",
      "Disallow: /admin",
      "",
      "User-agent: GPTBot",
      "Disallow: /",
      "",
      "User-agent: BiviantBot",
      "Crawl-delay: 5",
      "Disallow:",
    ].join("\n");

    // Our dedicated group allows crawling with a crawl delay.
    expect(robotsDisallowsAll(robots, "BiviantBot")).toBe(false);
    expect(robotsCrawlDelay(robots, "BiviantBot")).toBe(5);
    // GPTBot fully disallowed → AI opt-out signal.
    expect(robotsDisallowsAll(robots, "GPTBot")).toBe(true);

    const evaluation = evaluateTdmSignals({ robotsTxt: robots });
    expect(evaluation.state).toBe("rss_only");
    expect(evaluation.signals).toContain("robots:gptbot");
  });

  test("robots.txt full * disallow restricts us too", () => {
    const robots = "User-agent: *\nDisallow: /";
    const evaluation = evaluateTdmSignals({ robotsTxt: robots });
    expect(evaluation.state).toBe("rss_only");
    expect(evaluation.signals).toContain("robots:BiviantBot");
  });

  test("unreachable robots.txt fails closed until resolved", () => {
    const evaluation = evaluateTdmSignals({ robotsTxtUnreachable: true });
    expect(evaluation.state).toBe("rss_only");
    expect(evaluation.signals).toContain("robots_txt_unreachable");
  });

  test("noai meta and X-Robots-Tag are detected", () => {
    expect(
      declaresNoAi(`<meta name="robots" content="index, noai">`, undefined),
    ).toBe(true);
    expect(declaresNoAi(undefined, "noindex, noai")).toBe(true);
    expect(
      declaresNoAi(`<meta name="robots" content="index, follow">`, null),
    ).toBe(false);
  });

  test("ai.txt disallow is detected", () => {
    expect(aiTxtDisallowsText("User-Agent: *\nDisallow: /")).toBe(true);
    expect(aiTxtDisallowsText("User-Agent: *\nDisallow: /images")).toBe(false);
  });

  test("a clean domain evaluates to full", () => {
    const evaluation = evaluateTdmSignals({
      tdmReservationHeader: null,
      robotsTxt: "User-agent: *\nDisallow: /admin",
      homepageHtml: "<html><head></head></html>",
    });
    expect(evaluation.state).toBe("full");
    expect(evaluation.signals).toHaveLength(0);
  });

  test("normalizeDomain strips www and URLs", () => {
    expect(normalizeDomain("https://www.digi24.ro/stiri/x")).toBe("digi24.ro");
    expect(normalizeDomain("Digi24.ro")).toBe("digi24.ro");
  });
});

async function seedDomainWithArticles(t: ConvexT, domain: string) {
  return await t.run(async (ctx) => {
    const sourceId = await ctx.db.insert("sources", {
      domain,
      name: domain,
      baseBias: 0,
      reliabilityScore: 6,
    });
    const articleId = await ctx.db.insert("articles", {
      sourceId,
      title: "Articol extras",
      url: `https://${domain}/a`,
      canonicalUrl: `https://${domain}/a`,
      summary: "Rezumat extras din pagina publicației.",
      atomicFacts: ["Fapt 1", "Fapt 2"],
      extractionQuality: "strong",
      status: "clustered",
      publishedAt: Date.now(),
    });
    return { sourceId, articleId };
  });
}

describe("permission store + purge (L5)", () => {
  test("flipping a domain to rss_only purges extracted content", async () => {
    vi.useFakeTimers();
    try {
      const t = convexTest(schema, modules);
      const domain = "opt-out.ro";
      const { articleId } = await seedDomainWithArticles(t, domain);

      await t.mutation(internal.domainPermissions.upsertDomainPermission, {
        domain,
        state: "full",
        signals: [],
      });

      // robots.txt flipped to disallow → resolver stores rss_only.
      await t.mutation(internal.domainPermissions.upsertDomainPermission, {
        domain,
        state: "rss_only",
        signals: ["robots:BiviantBot"],
      });
      await t.finishAllScheduledFunctions(vi.runAllTimers);

      const article = await t.run(async (ctx) => ctx.db.get(articleId));
      expect(article?.summary).toBeUndefined();
      expect(article?.atomicFacts).toBeUndefined();
      expect(article?.extractionQuality).toBe("weak");
      // rss_only keeps headline+link+snippet display rights.
      expect(article?.status).toBe("clustered");
    } finally {
      vi.useRealTimers();
    }
  });

  test("blocking a domain discards its articles entirely", async () => {
    vi.useFakeTimers();
    try {
      const t = convexTest(schema, modules);
      const domain = "blocked.ro";
      const { articleId } = await seedDomainWithArticles(t, domain);

      await t.mutation(internal.domainPermissions.upsertDomainPermission, {
        domain,
        state: "blocked",
        signals: ["manual_block"],
        manualOverride: true,
      });
      await t.finishAllScheduledFunctions(vi.runAllTimers);

      const article = await t.run(async (ctx) => ctx.db.get(articleId));
      expect(article?.status).toBe("discarded");
      expect(article?.summary).toBeUndefined();
      expect(article?.rssSnippet).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  test("a manual block is never loosened by the automatic resolver", async () => {
    const t = convexTest(schema, modules);
    const domain = "stays-blocked.ro";
    await t.mutation(internal.domainPermissions.upsertDomainPermission, {
      domain,
      state: "blocked",
      signals: ["manual_block"],
      manualOverride: true,
    });
    // The 24h refresh finds no TDM signals and tries to write "full".
    const result = await t.mutation(
      internal.domainPermissions.upsertDomainPermission,
      { domain, state: "full", signals: [] },
    );
    expect(result.state).toBe("blocked");
  });

  test("becoming less restrictive does not purge", async () => {
    const t = convexTest(schema, modules);
    const domain = "relaxed.ro";
    const { articleId } = await seedDomainWithArticles(t, domain);
    await t.mutation(internal.domainPermissions.upsertDomainPermission, {
      domain,
      state: "rss_only",
      signals: ["noai"],
    });
    // (purge scheduled — let it run)
    vi.useFakeTimers();
    try {
      await t.finishAllScheduledFunctions(vi.runAllTimers);
    } finally {
      vi.useRealTimers();
    }
    await t.mutation(internal.domainPermissions.upsertDomainPermission, {
      domain,
      state: "full",
      signals: [],
    });
    const article = await t.run(async (ctx) => ctx.db.get(articleId));
    // Purged once by the restriction; the relaxation does not discard rows.
    expect(article?.status).toBe("clustered");
  });
});
