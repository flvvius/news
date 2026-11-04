// Gemini Batch API path for event summaries (summaryBatchNode.ts).
import { convexTest, type TestConvex } from "convex-test";
import { describe, expect, test, vi } from "vitest";

import schema from "./schema";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

// The poller reaches Gemini only through geminiBatchProvider; swap in a fake
// batch API so the test controls status and results.
const fakeBatch = vi.hoisted(() => ({
  status: "completed" as "pending" | "completed" | "failed",
  items: [] as unknown[],
  cancelled: [] as string[],
}));
vi.mock("./lib/llmProviders", () => ({
  languageModelFor: () => {
    throw new Error("no live calls in this test");
  },
  embeddingModelFor: () => {
    throw new Error("no live calls in this test");
  },
  geminiBatchProvider: () => ({
    specificationVersion: "v4",
    provider: "google.batch",
    supportedUrls: {},
    doStartBatch: async () => {
      throw new Error("not used");
    },
    doGetBatchStatus: async () => ({ status: fakeBatch.status }),
    doCancelBatch: async ({ batchId }: { batchId: string }) => {
      fakeBatch.cancelled.push(batchId);
      return {};
    },
    doGetBatchResults: async () =>
      new ReadableStream({
        start(controller) {
          for (const item of fakeBatch.items) controller.enqueue(item);
          controller.close();
        },
      }),
  }),
}));

const { batchedSummary } = await import("./summarizationNode");

const modules = (
  import.meta as unknown as {
    glob: (pattern: string) => Record<string, () => Promise<unknown>>;
  }
).glob("./**/!(*.*.*)*.*s");

type ConvexT = TestConvex<typeof schema>;

const SUMMARY = {
  neutral: "Guvernul a anunțat un nou buget pentru sănătate.",
  reformist: "",
  suveranist: "",
  globalImpact: "Impact limitat în afara țării.",
  perspectiveApplicable: true,
};

async function seedQueuedJob(
  t: ConvexT,
  status: "queued" | "succeeded" = "queued",
): Promise<{ eventId: Id<"events">; jobId: Id<"eventSummaryJobs"> }> {
  const now = Date.now();
  return t.run(async (ctx) => {
    const eventId = await ctx.db.insert("events", {
      title: "Buget sănătate",
      slug: `buget-${Math.random()}`,
      status: "processing",
      firstPublishedAt: now,
      lastUpdatedAt: now,
      lastArticleAt: now,
      articleCount: 3,
      sourceCount: 2,
      sourceIds: [],
    });
    const jobId = await ctx.db.insert("eventSummaryJobs", {
      eventId,
      status,
      attempts: 0,
      requestedAt: now,
      nextAttemptAt: now,
      updatedAt: now,
    });
    return { eventId, jobId };
  });
}

function succeededItem(jobId: string, input: unknown) {
  return {
    type: "text",
    id: jobId,
    status: "succeeded",
    result: {
      content: [
        {
          type: "tool-call",
          toolCallId: "call_1",
          toolName: "submit_event_summary",
          input: JSON.stringify(input),
        },
      ],
      finishReason: { unified: "tool-calls", raw: "STOP" },
      usage: {
        inputTokens: { total: 800, noCache: 800, cacheRead: 0, cacheWrite: 0 },
        outputTokens: { total: 300, text: 200, reasoning: 100 },
      },
      warnings: [],
    },
  };
}

async function scheduledCalls(t: ConvexT) {
  return t.run(async (ctx) =>
    ctx.db.system.query("_scheduled_functions").collect(),
  );
}

describe("batchedSummary (reusing a batch result in processSummaryJob)", () => {
  const batched = {
    model: "gemini-3.5-flash",
    summarySignature: "sig-1",
    outputJson: JSON.stringify(SUMMARY),
    inputTokens: 800,
    outputTokens: 300,
  };

  test("uses the batch output when the event is unchanged", () => {
    const result = batchedSummary(batched, "sig-1", "Buget");
    expect(result?.model).toBe("gemini-3.5-flash");
    expect(result?.generated.summary.neutral).toBe(SUMMARY.neutral);
    expect(result?.generated.outputTokens).toBe(300);
  });

  test("falls back to live generation when the event changed", () => {
    expect(batchedSummary(batched, "sig-2", "Buget")).toBeNull();
  });

  test("falls back when the batch output breaks the word caps", () => {
    const long = { ...SUMMARY, neutral: "cuvânt ".repeat(200) };
    expect(
      batchedSummary(
        { ...batched, outputJson: JSON.stringify(long) },
        "sig-1",
        "Buget",
      ),
    ).toBeNull();
  });

  test("falls back when the batch output is not JSON", () => {
    expect(
      batchedSummary({ ...batched, outputJson: "{oops" }, "sig-1", "Buget"),
    ).toBeNull();
  });

  test("no batch result means live generation", () => {
    expect(batchedSummary(undefined, "sig-1", "Buget")).toBeNull();
  });
});

describe("summary batch bookkeeping", () => {
  test("submitted jobs are held until the deadline; release only touches waiting jobs", async () => {
    const t = convexTest(schema, modules);
    const waiting = await seedQueuedJob(t);
    const done = await seedQueuedJob(t, "succeeded");

    const { batchRowId } = await t.mutation(
      internal.summaryBatches.recordSubmittedSummaryBatch,
      {
        provider: "google.batch",
        batchId: "batches/1",
        model: "gemini-3.5-flash",
        jobs: [
          { ...waiting, summarySignature: "a" },
          { ...done, summarySignature: "b" },
        ],
        maxWaitMs: 60 * 60 * 1000,
      },
    );

    const held = await t.run(async (ctx) => ctx.db.get(waiting.jobId));
    expect(held!.nextAttemptAt).toBeGreaterThan(Date.now() + 59 * 60 * 1000);
    expect(held!.lastError).toBe("batched: batches/1");

    // Nothing due on the live path while the batch is pending.
    const due = await t.query(internal.summarization.listDueSummaryJobs, {
      limit: 10,
    });
    expect(due).toHaveLength(0);

    const { released } = await t.mutation(
      internal.summaryBatches.finishSummaryBatch,
      {
        batchRowId,
        status: "failed",
        error: "batch_failed",
        succeededCount: 0,
        releaseJobIds: [waiting.jobId, done.jobId],
      },
    );
    expect(released).toBe(1);
    const dueAfter = await t.query(internal.summarization.listDueSummaryJobs, {
      limit: 10,
    });
    expect(dueAfter.map((job) => job._id)).toEqual([waiting.jobId]);
  });
});

describe("pollSummaryBatches", () => {
  async function submitted(t: ConvexT, maxWaitMs = 60 * 60 * 1000) {
    const ok = await seedQueuedJob(t);
    const bad = await seedQueuedJob(t);
    const { batchRowId } = await t.mutation(
      internal.summaryBatches.recordSubmittedSummaryBatch,
      {
        provider: "google.batch",
        batchId: "batches/2",
        model: "gemini-3.5-flash",
        jobs: [
          { ...ok, summarySignature: "sig-ok" },
          { ...bad, summarySignature: "sig-bad" },
        ],
        maxWaitMs,
      },
    );
    return { ok, bad, batchRowId };
  }

  test("a completed batch schedules processSummaryJob with the result and sends failures live", async () => {
    const t = convexTest(schema, modules);
    const { ok, bad, batchRowId } = await submitted(t);
    fakeBatch.status = "completed";
    fakeBatch.items = [
      succeededItem(ok.jobId, SUMMARY),
      {
        type: "text",
        id: bad.jobId,
        status: "failed",
        error: { message: "INTERNAL" },
      },
    ];

    const result = await t.action(
      internal.summaryBatchNode.pollSummaryBatches,
      {},
    );
    expect(result).toEqual({ polled: 1, collectedJobs: 1 });

    const scheduled = await scheduledCalls(t);
    expect(scheduled).toHaveLength(1);
    const args = scheduled[0]!.args[0] as {
      jobId: string;
      batched: { summarySignature: string; outputJson: string; outputTokens: number };
    };
    expect(args.jobId).toBe(ok.jobId);
    expect(args.batched.summarySignature).toBe("sig-ok");
    expect(JSON.parse(args.batched.outputJson)).toEqual(SUMMARY);
    expect(args.batched.outputTokens).toBe(300);

    const row = await t.run(async (ctx) => ctx.db.get(batchRowId));
    expect(row).toMatchObject({
      status: "collected",
      succeededCount: 1,
      failedCount: 1,
    });
    const badJob = await t.run(async (ctx) => ctx.db.get(bad.jobId));
    expect(badJob!.nextAttemptAt).toBeLessThanOrEqual(Date.now());

    // Batch usage is logged at the batch price.
    const usage = await t.run(async (ctx) => ctx.db.query("aiUsage").collect());
    expect(usage).toHaveLength(1);
    expect(usage[0]).toMatchObject({ inputTokens: 800, outputTokens: 300 });
  });

  test("a pending batch past its deadline is cancelled and its jobs go live", async () => {
    const t = convexTest(schema, modules);
    const { ok, bad, batchRowId } = await submitted(t, -1000);
    fakeBatch.status = "pending";
    fakeBatch.cancelled = [];

    await t.action(internal.summaryBatchNode.pollSummaryBatches, {});

    expect(fakeBatch.cancelled).toEqual(["batches/2"]);
    const row = await t.run(async (ctx) => ctx.db.get(batchRowId));
    expect(row).toMatchObject({ status: "failed", error: "deadline_exceeded" });
    const due = await t.query(internal.summarization.listDueSummaryJobs, {
      limit: 10,
    });
    expect(due.map((job) => job._id).sort()).toEqual(
      [ok.jobId, bad.jobId].sort(),
    );
  });

  test("a pending batch inside its deadline is left alone", async () => {
    const t = convexTest(schema, modules);
    const { batchRowId } = await submitted(t);
    fakeBatch.status = "pending";

    await t.action(internal.summaryBatchNode.pollSummaryBatches, {});

    const row = await t.run(async (ctx) => ctx.db.get(batchRowId));
    expect(row!.status).toBe("pending");
    expect(row!.lastPolledAt).toBeDefined();
  });
});
