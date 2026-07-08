import { convexTest, type TestConvex } from "convex-test";
import { describe, expect, test } from "vitest";

import schema from "./schema";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

// Same convex-test glob as the other suites: `!(*.*.*)` drops second-dot files
// (so convex.config.ts / the Better Auth component is never instantiated) plus
// *.test.ts / *.d.ts. These tests exercise the summary → publish state machine
// directly, without the LLM (processSummaryJob) in the loop.
const modules = (
  import.meta as unknown as {
    glob: (pattern: string) => Record<string, () => Promise<unknown>>;
  }
).glob("./**/!(*.*.*)*.*s");

type ConvexT = TestConvex<typeof schema>;

async function seedProcessingEvent(
  t: ConvexT,
  {
    title,
    articleCount,
    sourceCount,
  }: { title: string; articleCount: number; sourceCount: number },
): Promise<Id<"events">> {
  const now = Date.now();
  return await t.run(async (ctx) => {
    return await ctx.db.insert("events", {
      title,
      slug: title.toLowerCase().replace(/\s+/g, "-"),
      status: "processing",
      firstPublishedAt: now,
      lastUpdatedAt: now,
      lastArticleAt: now,
      articleCount,
      sourceCount,
      sourceIds: [],
    });
  });
}

describe("publish is gated on a successful AI summary", () => {
  test("applyEventSummaryResult promotes a qualifying processing event to published", async () => {
    const t = convexTest(schema, modules);
    const eventId = await seedProcessingEvent(t, {
      title: "Qualifying Event",
      articleCount: 3,
      sourceCount: 2,
    });
    const runId = "run-promote";
    const jobId = await t.run(async (ctx) => {
      return await ctx.db.insert("eventSummaryJobs", {
        eventId,
        status: "processing",
        attempts: 1,
        requestedAt: Date.now(),
        nextAttemptAt: Date.now(),
        updatedAt: Date.now(),
        processingRunId: runId,
      });
    });

    const result = await t.mutation(
      internal.summarization.applyEventSummaryResult,
      {
        jobId,
        eventId,
        runId,
        neutral: "Neutral framing.",
        reformist: "Reformist framing.",
        suveranist: "Suveranist framing.",
        globalImpact: "Why it matters.",
      },
    );
    expect(result.applied).toBe(true);

    const event = await t.run(async (ctx) => ctx.db.get(eventId));
    expect(event?.status).toBe("published");
    expect(event?.perspectiveSource).toBe("ai");
    expect(event?.globalImpact).toBe("Why it matters.");
    expect(event?.lastSummarizedAt ?? 0).toBeGreaterThan(0);

    // The event is only now public, so its preview must exist.
    const preview = await t.run(async (ctx) =>
      ctx.db
        .query("publicEventPreviews")
        .withIndex("by_event", (q) => q.eq("eventId", eventId))
        .unique(),
    );
    expect(preview).not.toBeNull();
  });

  test("enqueueEligibleEventSummaries queues a qualifying processing event", async () => {
    const t = convexTest(schema, modules);
    const eventId = await seedProcessingEvent(t, {
      title: "Ready For Summary",
      articleCount: 3,
      sourceCount: 2,
    });

    const result = await t.mutation(
      internal.summarization.enqueueEligibleEventSummaries,
      { limit: 10, minArticles: 3, minSources: 2 },
    );
    expect(result.queued).toBe(1);

    const jobs = await t.run(async (ctx) =>
      ctx.db.query("eventSummaryJobs").collect(),
    );
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.eventId).toBe(eventId);
  });

  test("enqueueEligibleEventSummaries skips a processing singleton", async () => {
    const t = convexTest(schema, modules);
    await seedProcessingEvent(t, {
      title: "Lonely Singleton",
      articleCount: 1,
      sourceCount: 1,
    });

    const result = await t.mutation(
      internal.summarization.enqueueEligibleEventSummaries,
      { limit: 10, minArticles: 3, minSources: 2 },
    );
    expect(result.queued).toBe(0);

    const jobs = await t.run(async (ctx) =>
      ctx.db.query("eventSummaryJobs").collect(),
    );
    expect(jobs).toHaveLength(0);
  });

  test("a published event with a current AI summary is not re-enqueued", async () => {
    const t = convexTest(schema, modules);
    const now = Date.now();
    await t.run(async (ctx) => {
      await ctx.db.insert("events", {
        title: "Already Summarized",
        slug: "already-summarized",
        status: "published",
        firstPublishedAt: now,
        lastUpdatedAt: now,
        lastArticleAt: now,
        articleCount: 3,
        sourceCount: 2,
        sourceIds: [],
        perspectiveSummaries: {
          neutral: "n",
          reformist: "r",
          suveranist: "s",
        },
        perspectiveSource: "ai",
        globalImpact: "g",
        lastSummarizedAt: now,
      });
    });

    const result = await t.mutation(
      internal.summarization.enqueueEligibleEventSummaries,
      { limit: 10, minArticles: 3, minSources: 2 },
    );
    expect(result.queued).toBe(0);
  });
});
