// L3: the verbatim-overlap gate — a lifted 12-word sentence is caught and
// blocks publication; genuine paraphrase passes; quotes/entities are exempt.
import { convexTest, type TestConvex } from "convex-test";
import { describe, expect, test } from "vitest";

import schema from "./schema";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
  checkSummaryOverlap,
  findVerbatimOverlaps,
} from "./lib/verbatimOverlap";

const modules = (
  import.meta as unknown as {
    glob: (pattern: string) => Record<string, () => Promise<unknown>>;
  }
).glob("./**/!(*.*.*)*.*s");

type ConvexT = TestConvex<typeof schema>;

const SOURCE_TEXT =
  "Premierul a anunțat marți seara că guvernul va suplimenta bugetul pentru " +
  "sănătate cu două miliarde de lei începând din luna septembrie, după " +
  "negocieri prelungite cu ministerul finanțelor privind plafonul de deficit.";

describe("findVerbatimOverlaps (L3)", () => {
  test("a lifted 12-word sentence is detected", () => {
    const summary =
      "Potrivit presei, guvernul va suplimenta bugetul pentru sănătate cu două " +
      "miliarde de lei începând din luna septembrie, decizie criticată de opoziție.";
    const spans = findVerbatimOverlaps(summary, [SOURCE_TEXT], 8);
    expect(spans.length).toBeGreaterThan(0);
    expect(spans[0]!.length).toBeGreaterThanOrEqual(8);
    expect(spans[0]!.text.toLowerCase()).toContain("suplimenta bugetul");
  });

  test("formulaic numeric phrasing is exempt (production false positives)", () => {
    // These exact spans blocked real events in production. Every ordinary word
    // in them is stock scaffolding, so there is no expression to protect and
    // demanding a paraphrase only produces worse Romanian.
    const src =
      "Ministerul a semnat un contract în valoare de 20 de miliarde de dolari " +
      "iar seismul s-a produs la o adâncime de 145 de kilometri.";
    const summary =
      "Acordul are în valoare de 20 de miliarde de dolari potrivit anunțului, " +
      "iar cutremurul a fost resimțit la o adâncime de 145 de kilometri.";
    expect(findVerbatimOverlaps(summary, [src], 8)).toHaveLength(0);
  });

  test("guard: loosening the exemption must not let real copied prose through", () => {
    // Same length as the formulaic case above, but the shared run carries
    // actual authorial phrasing rather than connective scaffolding.
    const summary =
      "Potrivit presei, guvernul va suplimenta bugetul pentru sănătate cu două " +
      "miliarde de lei începând din luna septembrie.";
    const spans = findVerbatimOverlaps(summary, [SOURCE_TEXT], 8);
    expect(spans.length).toBeGreaterThan(0);
  });

  test("a genuinely paraphrased summary passes", () => {
    const summary =
      "Executivul alocă fonduri suplimentare de aproximativ două miliarde de lei " +
      "domeniului sanitar din toamnă, decizie luată după discuții tensionate cu " +
      "finanțele despre limita de deficit.";
    expect(findVerbatimOverlaps(summary, [SOURCE_TEXT], 8)).toHaveLength(0);
  });

  test("text inside quotation marks is exempt", () => {
    const summary =
      `Premierul a declarat, citat de Digi24: „guvernul va suplimenta bugetul ` +
      `pentru sănătate cu două miliarde de lei începând din luna septembrie”.`;
    expect(findVerbatimOverlaps(summary, [SOURCE_TEXT], 8)).toHaveLength(0);
  });

  test("runs of named entities and numbers are exempt", () => {
    const source =
      "Ministerul Afacerilor Externe al României, Comisia Europeană, Banca " +
      "Națională a României, 15 septembrie 2026, București";
    const summary =
      "Reuniunea a inclus Ministerul Afacerilor Externe al României, Comisia " +
      "Europeană, Banca Națională a României, 15 septembrie 2026, București.";
    expect(findVerbatimOverlaps(summary, [source], 8)).toHaveLength(0);
  });

  test("punctuation and casing differences do not hide overlap", () => {
    const summary =
      "GUVERNUL va suplimenta, bugetul pentru sănătate — cu două miliarde de lei " +
      "începând din luna septembrie!";
    expect(
      findVerbatimOverlaps(summary, [SOURCE_TEXT], 8).length,
    ).toBeGreaterThan(0);
  });

  test("checkSummaryOverlap reports the failing field", () => {
    const result = checkSummaryOverlap(
      {
        neutral: "Un rezumat complet reformulat despre decizia bugetară.",
        globalImpact:
          "Sistemul public va primi mai mulți bani: guvernul va suplimenta " +
          "bugetul pentru sănătate cu două miliarde de lei începând din luna " +
          "septembrie, spun sursele.",
      },
      [SOURCE_TEXT],
      8,
    );
    expect(result.passed).toBe(false);
    expect(result.matchedSpans[0]!.field).toBe("globalImpact");
  });
});

async function seedProcessingJob(t: ConvexT): Promise<{
  eventId: Id<"events">;
  jobId: Id<"eventSummaryJobs">;
  runId: string;
}> {
  const now = Date.now();
  const runId = "run-l3";
  const eventId = await t.run(async (ctx) =>
    ctx.db.insert("events", {
      title: "Eveniment L3",
      slug: "eveniment-l3",
      status: "processing",
      firstPublishedAt: now,
      lastUpdatedAt: now,
      lastArticleAt: now,
      articleCount: 3,
      sourceCount: 2,
      sourceIds: [],
    }),
  );
  const jobId = await t.run(async (ctx) =>
    ctx.db.insert("eventSummaryJobs", {
      eventId,
      status: "processing",
      attempts: 1,
      requestedAt: now,
      nextAttemptAt: now,
      updatedAt: now,
      processingRunId: runId,
    }),
  );
  return { eventId, jobId, runId };
}

describe("publication gate on the overlap check (L3)", () => {
  test("a failing overlap check can never be applied/published", async () => {
    const t = convexTest(schema, modules);
    const { eventId, jobId, runId } = await seedProcessingJob(t);

    const result = await t.mutation(
      internal.summarization.applyEventSummaryResult,
      {
        jobId,
        eventId,
        runId,
        neutral: "Text",
        reformist: "",
        suveranist: "",
        globalImpact: "Impact",
        modelUsed: "test-model",
        overlapCheck: {
          passed: false,
          maxNgram: 8,
          attempts: 2,
          matchedSpans: [{ field: "neutral", text: "fragment copiat", length: 9 }],
        },
      },
    );
    expect(result.applied).toBe(false);

    const event = await t.run(async (ctx) => ctx.db.get(eventId));
    expect(event?.status).toBe("processing");
    expect(event?.perspectiveSummaries).toBeUndefined();
  });

  test("markSummaryJobBlockedVerbatim records the spans and is terminal", async () => {
    const t = convexTest(schema, modules);
    const { eventId, jobId, runId } = await seedProcessingJob(t);

    const overlapCheckJson = JSON.stringify({
      passed: false,
      maxNgram: 8,
      attempts: 2,
      matchedSpans: [{ field: "neutral", text: "fragment copiat", length: 12 }],
    });
    const result = await t.mutation(
      internal.summarization.markSummaryJobBlockedVerbatim,
      { jobId, runId, overlapCheckJson },
    );
    expect(result.updated).toBe(true);

    const job = await t.run(async (ctx) => ctx.db.get(jobId));
    expect(job?.status).toBe("failed");
    expect(job?.lastError).toBe("blocked_verbatim");
    expect(job?.nextAttemptAt).toBe(Number.MAX_SAFE_INTEGER);
    expect(job?.overlapCheckJson).toBe(overlapCheckJson);

    // The event stays unpublished.
    const event = await t.run(async (ctx) => ctx.db.get(eventId));
    expect(event?.status).toBe("processing");
  });

  test("a passing check publishes and is recorded on event + job", async () => {
    const t = convexTest(schema, modules);
    const { eventId, jobId, runId } = await seedProcessingJob(t);

    const result = await t.mutation(
      internal.summarization.applyEventSummaryResult,
      {
        jobId,
        eventId,
        runId,
        neutral: "Rezumat reformulat.",
        reformist: "Cadrare reformistă.",
        suveranist: "Cadrare suveranistă.",
        globalImpact: "Impact concret.",
        modelUsed: "test-model",
        overlapCheck: { passed: true, maxNgram: 8, attempts: 0, matchedSpans: [] },
      },
    );
    expect(result.applied).toBe(true);

    const event = await t.run(async (ctx) => ctx.db.get(eventId));
    expect(event?.status).toBe("published");
    expect(event?.lastOverlapCheckPassed).toBe(true);
    expect(event?.lastOverlapCheckAt ?? 0).toBeGreaterThan(0);

    const job = await t.run(async (ctx) => ctx.db.get(jobId));
    expect(job?.status).toBe("succeeded");
    expect(JSON.parse(job?.overlapCheckJson ?? "{}").passed).toBe(true);
  });
});
