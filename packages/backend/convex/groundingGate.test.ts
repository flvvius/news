// L4: grounding gate. A summary that fails grounding can never be applied.
// The NER risk gate was removed (prefix-matching lexicon held ordinary
// coverage), so its tests are gone; holdSummaryForReview is retained only so
// rows held before the removal stay readable in /admin/review.
import { convexTest, type TestConvex } from "convex-test";
import { describe, expect, test } from "vitest";

import schema from "./schema";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
  collectSummarySentences,
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

describe("summaryReviewQueue retained for pre-removal holds (L4)", () => {
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

  test("an event held before the NER gate was removed is re-enqueued", async () => {
    // Previously a pending review row skipped the event forever. With the gate
    // gone those rows are inert history, so the event must flow again —
    // otherwise every event held before the removal stays unpublished.
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
    expect(result.queued).toBe(1);
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

describe("terminal blocks do not regenerate identical inputs", () => {
  test("an exhausted failure stamps the signature so the next run short-circuits", async () => {
    const t = convexTest(schema, modules);
    const { eventId, jobId, runId } = await seedProcessingJob(t);

    await t.mutation(internal.summarization.markSummaryJobFailed, {
      jobId,
      runId,
      error: "blocked_ungrounded",
      retryAfterMs: Number.MAX_SAFE_INTEGER,
      maxAttempts: 0,
      eventId,
      summarySignature: "sig-abc",
    });

    // processSummaryJob compares this against the signature it rebuilds from
    // the same articles, so the next attempt skips before any model call.
    const event = await t.run(async (ctx) => ctx.db.get(eventId));
    expect(event?.lastSummarySignature).toBe("sig-abc");
    expect(event?.status).toBe("processing");
  });

  test("a retryable failure does not stamp the signature", async () => {
    const t = convexTest(schema, modules);
    const { eventId, jobId, runId } = await seedProcessingJob(t);

    // attempts (1) < maxAttempts (3): this job retries, so the inputs must
    // stay eligible for regeneration.
    await t.mutation(internal.summarization.markSummaryJobFailed, {
      jobId,
      runId,
      error: "transient upstream error",
      retryAfterMs: 60_000,
      maxAttempts: 3,
      eventId,
      summarySignature: "sig-abc",
    });

    const event = await t.run(async (ctx) => ctx.db.get(eventId));
    expect(event?.lastSummarySignature).toBeUndefined();
  });

  test("blocked_verbatim stamps the signature too", async () => {
    const t = convexTest(schema, modules);
    const { eventId, jobId, runId } = await seedProcessingJob(t);

    await t.mutation(internal.summarization.markSummaryJobBlockedVerbatim, {
      jobId,
      runId,
      overlapCheckJson: "{}",
      summarySignature: "sig-verbatim",
    });

    const event = await t.run(async (ctx) => ctx.db.get(eventId));
    expect(event?.lastSummarySignature).toBe("sig-verbatim");
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
