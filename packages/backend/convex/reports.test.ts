// L8: notice-and-action — report → queue → decision round-trip; unpublished
// events vanish from every public surface; every handled report carries a
// statement of reasons and timestamps.
import { convexTest, type TestConvex } from "convex-test";
import { describe, expect, test, vi } from "vitest";

import schema from "./schema";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

const modules = (
  import.meta as unknown as {
    glob: (pattern: string) => Record<string, () => Promise<unknown>>;
  }
).glob("./**/!(*.*.*)*.*s");

type ConvexT = TestConvex<typeof schema>;

async function seedPublishedEvent(
  t: ConvexT,
  slug: string,
): Promise<Id<"events">> {
  const now = Date.now();
  const eventId = await t.run(async (ctx) =>
    ctx.db.insert("events", {
      title: `Eveniment ${slug}`,
      slug,
      status: "published",
      firstPublishedAt: now,
      lastUpdatedAt: now,
      lastArticleAt: now,
      articleCount: 3,
      sourceCount: 2,
      sourceIds: [],
      perspectiveSummaries: { neutral: "Rezumat." },
      globalImpact: "Impact.",
      lastSummarizedAt: now,
      aiGenerated: true,
      humanReviewed: false,
    }),
  );
  await t.run(async (ctx) =>
    ctx.db.insert("publicEventPreviews", {
      eventId,
      slug,
      title: `Eveniment ${slug}`,
      firstPublishedAt: now,
      lastUpdatedAt: now,
      articleCount: 3,
      sourceCount: 2,
      topicIds: [],
      trendingScore: 10,
      sourceBiasCounts: { left: 0, center: 2, right: 0 },
      sources: [],
      updatedAt: now,
    }),
  );
  return eventId;
}

describe("content reports (L8)", () => {
  test("a report is stored and defamation triggers an error-severity alert", async () => {
    const t = convexTest(schema, modules);
    const eventId = await seedPublishedEvent(t, "raport-1");

    const result = await t.mutation(api.reports.submitContentReport, {
      eventId,
      category: "defamation",
      message: "Rezumatul afirmă ceva fals despre o persoană.",
      claim: "Persoana X ar fi comis frauda Y",
      reporterContact: "cititor@example.com",
    });
    expect(result.received).toBe(true);

    const reports = await t.run(async (ctx) =>
      ctx.db.query("contentReports").collect(),
    );
    expect(reports).toHaveLength(1);
    expect(reports[0]!.status).toBe("received");
    expect(reports[0]!.createdAt).toBeGreaterThan(0);

    const alerts = await t.run(async (ctx) =>
      ctx.db.query("pipelineAlerts").collect(),
    );
    const alert = alerts.find((a) => a.code === "content_report_received");
    expect(alert?.severity).toBe("error");
  });

  test("submitting a report schedules an admin alert email", async () => {
    const t = convexTest(schema, modules);
    const eventId = await seedPublishedEvent(t, "raport-alert");

    await t.mutation(api.reports.submitContentReport, {
      eventId,
      category: "illegal_content",
      message: "Conținut care necesită atenție imediată.",
      reporterContact: "cititor@example.com",
    });

    // The email is a scheduled internal action (it hits Resend), so we assert
    // it was enqueued rather than running it.
    const scheduled = await t.run(async (ctx) =>
      ctx.db.system.query("_scheduled_functions").collect(),
    );
    const emailJob = scheduled.find((fn) =>
      fn.name.includes("sendReportAlertEmail"),
    );
    expect(emailJob, "report submit must schedule the admin alert").toBeTruthy();
    const jobArgs = emailJob?.args?.[0] as
      | { eventSlug?: string; urgent?: boolean; category?: string }
      | undefined;
    expect(jobArgs?.eventSlug).toBe("raport-alert");
    expect(jobArgs?.urgent).toBe(true);
    expect(jobArgs?.category).toBe("illegal_content");
  });

  test("unpublish decision removes the event from every public surface", async () => {
    vi.useFakeTimers();
    try {
      const t = convexTest(schema, modules);
      const eventId = await seedPublishedEvent(t, "raport-unpub");

      const { reportId } = await t.mutation(api.reports.submitContentReport, {
        eventId,
        category: "illegal_content",
        message: "Conținut problematic.",
      });

      const decision = await t.mutation(internal.reports.applyReportDecision, {
        reportId,
        decision: "unpublish",
        statementOfReasons:
          "Conținutul încalcă politica; retras imediat din platformă.",
        decidedByEmail: "admin@test",
      });
      expect(decision.decided).toBe(true);
      await t.finishAllScheduledFunctions(vi.runAllTimers);

      // Public event page → null (renders the removed/404 state).
      const publicEvent = await t.query(api.events.getEventBySlug, {
        slug: "raport-unpub",
      });
      expect(publicEvent).toBeNull();

      // Feed preview gone.
      const preview = await t.run(async (ctx) =>
        ctx.db
          .query("publicEventPreviews")
          .withIndex("by_event", (q) => q.eq("eventId", eventId))
          .unique(),
      );
      expect(preview).toBeNull();

      // Report closed with statement of reasons + timestamps.
      const report = await t.run(async (ctx) => ctx.db.get(reportId));
      expect(report?.status).toBe("unpublished");
      expect(report?.statementOfReasons).toContain("politica");
      expect(report?.decidedAt).toBeGreaterThan(0);

      // L7 audit: unpublish recorded.
      const audit = await t.run(async (ctx) =>
        ctx.db
          .query("generationAudit")
          .withIndex("by_event_version", (q) => q.eq("eventId", eventId))
          .collect(),
      );
      expect(audit.some((entry) => entry.action === "unpublished")).toBe(true);

      // Unpublished events are ineligible for re-summarization.
      const enqueue = await t.mutation(
        internal.summarization.enqueueEligibleEventSummaries,
        { limit: 10, minArticles: 3, minSources: 2 },
      );
      expect(enqueue.queued).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  test("correct decision queues a regeneration and audits the correction", async () => {
    vi.useFakeTimers();
    try {
      const t = convexTest(schema, modules);
      const eventId = await seedPublishedEvent(t, "raport-corect");
      const { reportId } = await t.mutation(api.reports.submitContentReport, {
        eventId,
        category: "factual_error",
        message: "Cifra din rezumat este greșită.",
      });

      const decision = await t.mutation(internal.reports.applyReportDecision, {
        reportId,
        decision: "correct",
        statementOfReasons: "Cifra corectată; rezumat regenerat din surse.",
      });
      expect(decision.decided).toBe(true);
      await t.finishAllScheduledFunctions(vi.runAllTimers);

      const jobs = await t.run(async (ctx) =>
        ctx.db.query("eventSummaryJobs").collect(),
      );
      expect(jobs.some((job) => job.reason === "correction_requested")).toBe(
        true,
      );

      const event = await t.run(async (ctx) => ctx.db.get(eventId));
      // Freshness markers cleared so the pipeline regenerates.
      expect(event?.lastSummarizedAt).toBeUndefined();

      const audit = await t.run(async (ctx) =>
        ctx.db
          .query("generationAudit")
          .withIndex("by_event_version", (q) => q.eq("eventId", eventId))
          .collect(),
      );
      expect(audit.some((entry) => entry.action === "corrected")).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  test("dismiss requires a statement of reasons", async () => {
    const t = convexTest(schema, modules);
    const eventId = await seedPublishedEvent(t, "raport-dismiss");
    const { reportId } = await t.mutation(api.reports.submitContentReport, {
      eventId,
      category: "factual_error",
      message: "Ceva vag.",
    });

    await expect(
      t.mutation(internal.reports.applyReportDecision, {
        reportId,
        decision: "dismiss",
        statementOfReasons: "  ",
      }),
    ).rejects.toThrow();

    const ok = await t.mutation(internal.reports.applyReportDecision, {
      reportId,
      decision: "dismiss",
      statementOfReasons: "Afirmația raportată este susținută de surse.",
    });
    expect(ok.decided).toBe(true);
  });

  test("per-event report submissions are rate limited", async () => {
    const t = convexTest(schema, modules);
    const eventId = await seedPublishedEvent(t, "raport-limit");
    for (let i = 0; i < 5; i++) {
      await t.mutation(api.reports.submitContentReport, {
        eventId,
        category: "factual_error",
        message: `Raport ${i} suficient de lung.`,
      });
    }
    await expect(
      t.mutation(api.reports.submitContentReport, {
        eventId,
        category: "factual_error",
        message: "Al șaselea raport.",
      }),
    ).rejects.toThrow();
  });
});
