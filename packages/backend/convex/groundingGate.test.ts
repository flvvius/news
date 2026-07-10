// L4: grounding + NER risk gate. A synthetic summary accusing a named person
// is held in the review queue and never auto-published; failing grounding can
// never be applied; held events are not re-enqueued.
import { convexTest, type TestConvex } from "convex-test";
import { describe, expect, test } from "vitest";

import schema from "./schema";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
  collectSummarySentences,
  findNamedEntities,
  findRiskySentences,
  splitIntoSentences,
} from "./lib/grounding";
import { SIDE_COVERAGE_FALLBACK } from "./prompts";

const modules = (
  import.meta as unknown as {
    glob: (pattern: string) => Record<string, () => Promise<unknown>>;
  }
).glob("./**/!(*.*.*)*.*s");

type ConvexT = TestConvex<typeof schema>;

describe("sentence splitting + collection (L4)", () => {
  test("splits Romanian prose and keeps abbreviations/decimals intact", () => {
    const text =
      "Guvernul a alocat 2.5 miliarde de lei. Decizia a fost anunțată de dl. Ionescu! Va urma o rectificare?";
    const sentences = splitIntoSentences(text);
    expect(sentences).toHaveLength(3);
    expect(sentences[0]).toContain("2.5 miliarde");
    expect(sentences[1]).toContain("dl. Ionescu");
  });

  test("fallback strings are never treated as checkable claims", () => {
    const sentences = collectSummarySentences({
      neutral: "Un fapt concret raportat de surse.",
      reformist: SIDE_COVERAGE_FALLBACK,
      suveranist: "",
    });
    expect(sentences).toHaveLength(1);
    expect(sentences[0]!.field).toBe("neutral");
  });
});

describe("NER risk gate (L4)", () => {
  test("a named person + accusation term is flagged", () => {
    const flags = findRiskySentences({
      neutral:
        "Consiliul a aprobat bugetul local. Ion Popescu este acuzat de corupție într-un dosar penal, potrivit surselor.",
    });
    expect(flags.length).toBeGreaterThan(0);
    expect(flags[0]!.entity).toContain("Ion Popescu");
    expect(["corupție", "dosar penal"]).toContain(flags[0]!.term);
  });

  test("an organization + fraud term is flagged", () => {
    const flags = findRiskySentences({
      globalImpact:
        "Ancheta vizează compania Alfa Beta SRL pentru fraudă cu fonduri europene.",
    });
    expect(flags.length).toBeGreaterThan(0);
  });

  test("neutral coverage without accusations passes", () => {
    const flags = findRiskySentences({
      neutral:
        "Guvernul a majorat bugetul pentru sănătate cu două miliarde de lei, potrivit mai multor surse.",
      globalImpact: "Spitalele vor primi fonduri suplimentare din septembrie.",
    });
    expect(flags).toHaveLength(0);
  });

  test("accusation term without a named entity passes", () => {
    const flags = findRiskySentences({
      neutral: "Numărul dosarelor de corupție a scăzut anul trecut.",
    });
    // "corupție" appears but no person/org is named in the sentence.
    expect(flags).toHaveLength(0);
  });

  test("findNamedEntities skips generic capitalized sentence starters", () => {
    expect(findNamedEntities("Potrivit surselor, ancheta continuă.")).toHaveLength(0);
    expect(findNamedEntities("Ancheta îl vizează pe Vasile Ionescu.")).toEqual([
      "Vasile Ionescu",
    ]);
  });
});

async function seedProcessingJob(t: ConvexT): Promise<{
  eventId: Id<"events">;
  jobId: Id<"eventSummaryJobs">;
  runId: string;
}> {
  const now = Date.now();
  const runId = "run-l4";
  const eventId = await t.run(async (ctx) =>
    ctx.db.insert("events", {
      title: "Eveniment L4",
      slug: "eveniment-l4",
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

const RISKY_PROPOSAL = {
  neutral:
    "Ion Popescu este acuzat de corupție în dosarul instrumentat de procurori.",
  reformist: "",
  suveranist: "",
  globalImpact: "Cazul ar putea influența alegerile locale.",
  perspectiveApplicable: false,
  modelUsed: "test-model",
  summarySignature: undefined as string | undefined,
};

describe("review queue holds risky summaries (L4)", () => {
  test("holdSummaryForReview queues the proposal and never publishes", async () => {
    const t = convexTest(schema, modules);
    const { eventId, jobId, runId } = await seedProcessingJob(t);

    const held = await t.mutation(internal.summarization.holdSummaryForReview, {
      jobId,
      eventId,
      runId,
      proposed: RISKY_PROPOSAL,
      flaggedSentences: [
        {
          field: "neutral",
          sentence: RISKY_PROPOSAL.neutral,
          entity: "Ion Popescu",
          term: "corupție",
        },
      ],
    });
    expect(held.held).toBe(true);

    // Never auto-published: event untouched, no summary stored.
    const event = await t.run(async (ctx) => ctx.db.get(eventId));
    expect(event?.status).toBe("processing");
    expect(event?.perspectiveSummaries).toBeUndefined();

    const job = await t.run(async (ctx) => ctx.db.get(jobId));
    expect(job?.status).toBe("skipped");
    expect(job?.lastError).toBe("held_for_review");

    const queue = await t.run(async (ctx) =>
      ctx.db.query("summaryReviewQueue").collect(),
    );
    expect(queue).toHaveLength(1);
    expect(queue[0]!.status).toBe("pending");
    expect(queue[0]!.flaggedSentences[0]!.entity).toBe("Ion Popescu");
  });

  test("an event with a pending review is not re-enqueued", async () => {
    const t = convexTest(schema, modules);
    const { eventId, jobId, runId } = await seedProcessingJob(t);
    await t.mutation(internal.summarization.holdSummaryForReview, {
      jobId,
      eventId,
      runId,
      proposed: RISKY_PROPOSAL,
      flaggedSentences: [],
    });

    const result = await t.mutation(
      internal.summarization.enqueueEligibleEventSummaries,
      { limit: 10, minArticles: 3, minSources: 2 },
    );
    expect(result.queued).toBe(0);
  });

  test("a second hold for the same event replaces the pending row", async () => {
    const t = convexTest(schema, modules);
    const { eventId, jobId, runId } = await seedProcessingJob(t);
    await t.mutation(internal.summarization.holdSummaryForReview, {
      jobId,
      eventId,
      runId,
      proposed: RISKY_PROPOSAL,
      flaggedSentences: [],
    });

    const secondRunId = "run-l4-b";
    const secondJobId = await t.run(async (ctx) =>
      ctx.db.insert("eventSummaryJobs", {
        eventId,
        status: "processing",
        attempts: 1,
        requestedAt: Date.now(),
        nextAttemptAt: Date.now(),
        updatedAt: Date.now(),
        processingRunId: secondRunId,
      }),
    );
    await t.mutation(internal.summarization.holdSummaryForReview, {
      jobId: secondJobId,
      eventId,
      runId: secondRunId,
      proposed: { ...RISKY_PROPOSAL, neutral: "Versiune nouă." },
      flaggedSentences: [],
    });

    const queue = await t.run(async (ctx) =>
      ctx.db.query("summaryReviewQueue").collect(),
    );
    expect(queue).toHaveLength(1);
    expect(queue[0]!.proposed.neutral).toBe("Versiune nouă.");
  });
});

describe("grounding invariants at the publish gate (L4)", () => {
  test("a failing grounding record can never be applied", async () => {
    const t = convexTest(schema, modules);
    const { eventId, jobId, runId } = await seedProcessingJob(t);

    const result = await t.mutation(
      internal.summarization.applyEventSummaryResult,
      {
        jobId,
        eventId,
        runId,
        neutral: "Afirmație fabricată.",
        reformist: "",
        suveranist: "",
        globalImpact: "Impact.",
        modelUsed: "test-model",
        overlapCheck: { passed: true, maxNgram: 8, attempts: 0, matchedSpans: [] },
        grounding: {
          model: "test-model",
          passed: false,
          results: [],
          strippedSentences: [
            { field: "neutral", sentence: "Afirmație fabricată." },
          ],
        },
      },
    );
    expect(result.applied).toBe(false);
    const event = await t.run(async (ctx) => ctx.db.get(eventId));
    expect(event?.status).toBe("processing");
  });

  test("a passing grounding record is stored per sentence with source IDs", async () => {
    const t = convexTest(schema, modules);
    const { eventId, jobId, runId } = await seedProcessingJob(t);
    const sourceId = await t.run(async (ctx) =>
      ctx.db.insert("sources", {
        domain: "example.ro",
        name: "Example",
        baseBias: 0,
        reliabilityScore: 7,
      }),
    );
    const articleId = await t.run(async (ctx) =>
      ctx.db.insert("articles", {
        sourceId,
        title: "Articol",
        url: "https://example.ro/a",
        canonicalUrl: "https://example.ro/a",
        status: "clustered",
        eventId,
        publishedAt: Date.now(),
      }),
    );

    const result = await t.mutation(
      internal.summarization.applyEventSummaryResult,
      {
        jobId,
        eventId,
        runId,
        neutral: "Fapt susținut de surse.",
        reformist: "",
        suveranist: "",
        globalImpact: "Impact concret.",
        perspectiveApplicable: false,
        modelUsed: "test-model",
        overlapCheck: { passed: true, maxNgram: 8, attempts: 0, matchedSpans: [] },
        grounding: {
          model: "test-model",
          passed: true,
          results: [
            {
              field: "neutral",
              sentence: "Fapt susținut de surse.",
              supported: true,
              supportingArticleIds: [articleId],
            },
          ],
          strippedSentences: [],
        },
      },
    );
    expect(result.applied).toBe(true);

    const grounding = await t.run(async (ctx) =>
      ctx.db
        .query("summaryGrounding")
        .withIndex("by_event", (q) => q.eq("eventId", eventId))
        .unique(),
    );
    expect(grounding?.passed).toBe(true);
    expect(grounding?.results[0]!.supportingArticleIds).toContain(articleId);

    // Public attribution query resolves source names.
    const attribution = await t.query(
      api.summarization.getSummaryGrounding,
      { eventId },
    );
    expect(attribution?.results[0]!.supportingSources).toContain("Example");
  });
});
