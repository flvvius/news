// L7: append-only generation audit — every pipeline action writes a linked,
// versioned record; a single query reconstructs the chain; the module
// exposes no way to mutate an existing row.
import { convexTest, type TestConvex } from "convex-test";
import { describe, expect, test } from "vitest";

import schema from "./schema";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import * as generationAuditModule from "./generationAudit";

const modules = (
  import.meta as unknown as {
    glob: (pattern: string) => Record<string, () => Promise<unknown>>;
  }
).glob("./**/!(*.*.*)*.*s");

type ConvexT = TestConvex<typeof schema>;

async function seedProcessingJob(
  t: ConvexT,
  slug: string,
): Promise<{
  eventId: Id<"events">;
  jobId: Id<"eventSummaryJobs">;
  runId: string;
}> {
  const now = Date.now();
  const runId = `run-${slug}`;
  const eventId = await t.run(async (ctx) =>
    ctx.db.insert("events", {
      title: `Eveniment ${slug}`,
      slug,
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

const PASSING_CHECKS = {
  overlapCheck: {
    passed: true,
    maxNgram: 8,
    attempts: 0,
    matchedSpans: [] as Array<{ field: string; text: string; length: number }>,
  },
};

describe("generation audit chain (L7)", () => {
  test("publishing writes a full audit record with sources and checks", async () => {
    const t = convexTest(schema, modules);
    const { eventId, jobId, runId } = await seedProcessingJob(t, "audit-pub");
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

    await t.mutation(internal.summarization.applyEventSummaryResult, {
      jobId,
      eventId,
      runId,
      neutral: "Rezumat.",
      reformist: "R.",
      suveranist: "S.",
      globalImpact: "Impact.",
      modelUsed: "test-model",
      ...PASSING_CHECKS,
      auditSources: [
        {
          articleId,
          canonicalUrl: "https://example.ro/a",
          contentHash: "abc123",
          fetchedAt: Date.now(),
          permissionState: "full",
        },
      ],
    });

    const chain = await t.run(async (ctx) =>
      ctx.db
        .query("generationAudit")
        .withIndex("by_event_version", (q) => q.eq("eventId", eventId))
        .order("asc")
        .collect(),
    );
    expect(chain).toHaveLength(1);
    const record = chain[0]!;
    expect(record.action).toBe("published");
    expect(record.version).toBe(1);
    expect(record.model).toBe("test-model");
    expect(record.summary?.neutral).toBe("Rezumat.");
    expect(record.sourceArticles[0]).toMatchObject({
      articleId,
      canonicalUrl: "https://example.ro/a",
      contentHash: "abc123",
      permissionState: "full",
    });
    expect(JSON.parse(record.overlapCheckJson ?? "{}").passed).toBe(true);
    expect(record.publishedAt).toBeGreaterThan(0);
  });

  test("blocked and held actions append linked versions", async () => {
    const t = convexTest(schema, modules);
    const { eventId, jobId, runId } = await seedProcessingJob(t, "audit-block");

    await t.mutation(internal.summarization.markSummaryJobBlockedVerbatim, {
      jobId,
      runId,
      overlapCheckJson: JSON.stringify({ passed: false }),
    });

    const secondRunId = "run-audit-block-2";
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
      proposed: {
        neutral: "Text.",
        reformist: "",
        suveranist: "",
        globalImpact: "Impact.",
        perspectiveApplicable: false,
        modelUsed: "test-model",
      },
      flaggedSentences: [
        { field: "neutral", sentence: "Text.", entity: "X Y", term: "fraudă" },
      ],
    });

    const chain = await t.run(async (ctx) =>
      ctx.db
        .query("generationAudit")
        .withIndex("by_event_version", (q) => q.eq("eventId", eventId))
        .order("asc")
        .collect(),
    );
    expect(chain.map((entry) => entry.action)).toEqual([
      "blocked_verbatim",
      "held_for_review",
    ]);
    expect(chain[0]!.version).toBe(1);
    expect(chain[1]!.version).toBe(2);
    // Corrections/new versions reference the record they supersede.
    expect(chain[1]!.supersedesAuditId).toBe(chain[0]!._id);
    expect(chain[0]!.supersedesAuditId).toBeUndefined();
  });

  test("the audit module exposes no update or delete mutation", () => {
    // Immutability by construction: the only writer is the internal
    // appendGenerationAudit helper; no exported Convex function can patch,
    // replace or delete an audit row.
    const exportNames = Object.keys(generationAuditModule);
    expect(exportNames).toContain("appendGenerationAudit");
    for (const name of exportNames) {
      expect(name).not.toMatch(/update|patch|delete|remove|edit/i);
    }
  });

  test("failed grounding appends a blocked_ungrounded record", async () => {
    const t = convexTest(schema, modules);
    const { eventId, jobId } = await seedProcessingJob(t, "audit-ground");

    await t.mutation(internal.summarization.recordSummaryGrounding, {
      eventId,
      jobId,
      grounding: {
        model: "test-model",
        passed: false,
        results: [],
        strippedSentences: [{ field: "neutral", sentence: "Fals." }],
      },
    });

    const chain = await t.run(async (ctx) =>
      ctx.db
        .query("generationAudit")
        .withIndex("by_event_version", (q) => q.eq("eventId", eventId))
        .collect(),
    );
    expect(chain).toHaveLength(1);
    expect(chain[0]!.action).toBe("blocked_ungrounded");
    expect(JSON.parse(chain[0]!.groundingJson ?? "{}").passed).toBe(false);
  });
});
