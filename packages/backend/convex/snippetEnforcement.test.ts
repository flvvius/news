// L2 (Art. 94¹): no stored third-party text may exceed MAX_SNIPPET_CHARS.
// Feeds a 500-char RSS description through the real write paths and asserts
// truncation at storage; the render-side twin lives in
// apps/web/src/components/ui/snippet.test.tsx.
import { convexTest, type TestConvex } from "convex-test";
import { describe, expect, test } from "vitest";

import schema from "./schema";
import { internal } from "./_generated/api";
import {
  MAX_SNIPPET_CHARS,
  truncateThirdPartySnippet,
} from "./lib/compliance";

const modules = (
  import.meta as unknown as {
    glob: (pattern: string) => Record<string, () => Promise<unknown>>;
  }
).glob("./**/!(*.*.*)*.*s");

type ConvexT = TestConvex<typeof schema>;

const LONG_DESCRIPTION =
  "Guvernul a aprobat miercuri o ordonanță de urgență care modifică plafonul " +
  "de cheltuieli pentru administrația locală, în contextul negocierilor cu " +
  "Comisia Europeană privind deficitul bugetar. Ministrul finanțelor a " +
  "declarat că măsura este temporară și că va fi reevaluată la rectificarea " +
  "din toamnă, în timp ce opoziția acuză executivul că mută povara fiscală " +
  "asupra primăriilor și cere retragerea imediată a actului normativ adoptat.";

async function seedSource(t: ConvexT) {
  return await t.run(async (ctx) =>
    ctx.db.insert("sources", {
      domain: "example.ro",
      name: "Example",
      baseBias: 0,
      reliabilityScore: 5,
    }),
  );
}

describe("snippet ceiling (L2)", () => {
  test("truncateThirdPartySnippet caps a 500-char description at a word boundary", () => {
    expect(LONG_DESCRIPTION.length).toBeGreaterThan(400);
    const truncated = truncateThirdPartySnippet(LONG_DESCRIPTION)!;
    expect(truncated.length).toBeLessThanOrEqual(MAX_SNIPPET_CHARS);
    // No mid-word cut: dropping the ellipsis leaves a prefix of the original
    // whose next character is punctuation/whitespace, never a letter.
    const bare = truncated.replace(/…$/, "");
    expect(LONG_DESCRIPTION.startsWith(bare)).toBe(true);
    expect(LONG_DESCRIPTION[bare.length]).toMatch(/[\s,.:;]/);
  });

  test("short text and empty input pass through", () => {
    expect(truncateThirdPartySnippet("Scurt.")).toBe("Scurt.");
    expect(truncateThirdPartySnippet("   ")).toBeUndefined();
    expect(truncateThirdPartySnippet(undefined)).toBeUndefined();
  });

  test("insertArticles stores rssSnippet truncated to the ceiling", async () => {
    const t = convexTest(schema, modules);
    const sourceId = await seedSource(t);

    const [articleId] = await t.mutation(internal.ingestion.insertArticles, {
      articles: [
        {
          sourceId,
          title: "Ordonanța privind plafonul de cheltuieli",
          url: "https://example.ro/articol",
          canonicalUrl: "https://example.ro/articol",
          rssSnippet: LONG_DESCRIPTION,
          status: "unprocessed" as const,
          publishedAt: Date.now(),
        },
      ],
    });

    const stored = await t.run(async (ctx) => ctx.db.get(articleId!));
    expect(stored?.rssSnippet).toBeDefined();
    expect(stored!.rssSnippet!.length).toBeLessThanOrEqual(MAX_SNIPPET_CHARS);
  });

  test("markArticleEnriched stores the extracted summary truncated to the ceiling", async () => {
    const t = convexTest(schema, modules);
    const sourceId = await seedSource(t);
    const runId = "run-l2";
    const articleId = await t.run(async (ctx) =>
      ctx.db.insert("articles", {
        sourceId,
        title: "Articol",
        url: "https://example.ro/a",
        canonicalUrl: "https://example.ro/a",
        status: "processing",
        enrichmentRunId: runId,
        publishedAt: Date.now(),
      }),
    );

    await t.mutation(internal.enrichment.markArticleEnriched, {
      articleId,
      embedding: Array.from({ length: 512 }, () => 0),
      summary: LONG_DESCRIPTION,
      version: 1,
      runId,
    });

    const stored = await t.run(async (ctx) => ctx.db.get(articleId));
    expect(stored?.summary).toBeDefined();
    expect(stored!.summary!.length).toBeLessThanOrEqual(MAX_SNIPPET_CHARS);
  });
});
