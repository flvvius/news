/**
 * L8 — report-an-error + corrections (doubles as the DSA notice-and-action
 * mechanism). Anyone can report an event summary; the admin queue offers
 * dismiss / correct (regenerate) / unpublish (instant), every action stores
 * a statement of reasons, and the reporter is notified when reachable.
 */

import { ConvexError, v } from "convex/values";
import {
  internalMutation,
  mutation,
  query,
} from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import { requireAdminUser } from "./lib/betaAccess";
import { enforceRateLimit } from "./lib/rateLimit";
import { appendGenerationAudit } from "./generationAudit";
import {
  deletePublicEventPreview,
  rebuildPublicFeedSnapshots,
} from "./lib/publicEventPreviews";

const MAX_MESSAGE_CHARS = 2000;

const CATEGORY_VALIDATOR = v.union(
  v.literal("factual_error"),
  v.literal("defamation"),
  v.literal("copyright_takedown"),
  v.literal("illegal_content"),
);

const DECISION_VALIDATOR = v.union(
  v.literal("dismiss"),
  v.literal("correct"),
  v.literal("unpublish"),
);

/** Public: report an error on an event page (no auth, rate-limited). */
export const submitContentReport = mutation({
  args: {
    eventId: v.id("events"),
    category: CATEGORY_VALIDATOR,
    message: v.string(),
    claim: v.optional(v.string()),
    reporterContact: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const message = args.message.trim();
    if (message.length < 5) {
      throw new ConvexError("Message too short");
    }
    const event = await ctx.db.get(args.eventId);
    if (!event) {
      throw new ConvexError("Event not found");
    }

    await enforceRateLimit(ctx, {
      key: `contentReport:${String(args.eventId)}`,
      limit: 5,
      windowMs: 60 * 60 * 1000,
    });
    await enforceRateLimit(ctx, {
      key: "contentReport:all",
      limit: 60,
      windowMs: 60 * 60 * 1000,
    });

    const reportId = await ctx.db.insert("contentReports", {
      eventId: args.eventId,
      category: args.category,
      message: message.slice(0, MAX_MESSAGE_CHARS),
      claim: args.claim?.slice(0, 500),
      reporterContact: args.reporterContact?.trim().slice(0, 200) || undefined,
      status: "received",
      createdAt: Date.now(),
    });

    // Defamation / illegal content triggers an immediate operator alert;
    // everything else lands in the normal alert feed.
    const urgent =
      args.category === "defamation" || args.category === "illegal_content";
    await ctx.db.insert("pipelineAlerts", {
      severity: urgent ? "error" : "warning",
      code: "content_report_received",
      message: `Content report (${args.category}) on "${event.title}"`,
      details: {
        eventId: String(args.eventId),
        eventSlug: event.slug,
        category: args.category,
      },
      createdAt: Date.now(),
    });

    return { received: true as const, reportId };
  },
});

/** Shared unpublish: flips the flag, removes every public surface, audits. */
async function unpublishEvent(
  ctx: MutationCtx,
  eventId: Id<"events">,
  reason: string,
) {
  const event = await ctx.db.get(eventId);
  if (!event) return { unpublished: false as const };
  if (!event.unpublishedAt) {
    await ctx.db.patch(eventId, { unpublishedAt: Date.now() });
    await deletePublicEventPreview(ctx, eventId);
    // Refresh the anonymous trending snapshot so the event vanishes from the
    // cached first page too, not just live queries.
    await rebuildPublicFeedSnapshots(ctx);
    await appendGenerationAudit(ctx, {
      eventId,
      action: "unpublished",
      unpublishedAt: Date.now(),
      note: reason,
    });
  }
  return { unpublished: true as const };
}

export const unpublishEventInternal = internalMutation({
  args: { eventId: v.id("events"), reason: v.string() },
  handler: async (ctx, { eventId, reason }) => {
    return await unpublishEvent(ctx, eventId, reason);
  },
});

/** One-click unpublish, independent of the report queue. */
export const unpublishEventForAdmin = mutation({
  args: { eventId: v.id("events"), reason: v.optional(v.string()) },
  handler: async (ctx, { eventId, reason }) => {
    const admin = await requireAdminUser(ctx);
    const email =
      (admin as { email?: string } | null | undefined)?.email ?? "admin";
    return await unpublishEvent(
      ctx,
      eventId,
      reason ?? `manual unpublish by ${email}`,
    );
  },
});

/** Decision core, shared by the admin mutation (and testable directly). */
export const applyReportDecision = internalMutation({
  args: {
    reportId: v.id("contentReports"),
    decision: DECISION_VALIDATOR,
    statementOfReasons: v.string(),
    decidedByEmail: v.optional(v.string()),
  },
  handler: async (
    ctx,
    { reportId, decision, statementOfReasons, decidedByEmail },
  ) => {
    const report = await ctx.db.get(reportId);
    if (!report || report.status !== "received") {
      return { decided: false as const, reason: "not_pending" };
    }
    const statement = statementOfReasons.trim();
    if (statement.length < 5) {
      throw new ConvexError("A statement of reasons is required");
    }

    const now = Date.now();

    if (decision === "unpublish") {
      await unpublishEvent(
        ctx,
        report.eventId,
        `content report ${String(reportId)}: ${statement}`,
      );
    }

    if (decision === "correct") {
      const event = await ctx.db.get(report.eventId);
      if (event) {
        // Force regeneration: clear the freshness markers so the summary
        // queue treats the event as stale, then enqueue immediately.
        await ctx.db.patch(report.eventId, {
          lastSummarizedAt: undefined,
          lastSummarySignature: undefined,
        });
        await ctx.db.insert("eventSummaryJobs", {
          eventId: report.eventId,
          status: "queued",
          reason: "correction_requested",
          attempts: 0,
          requestedAt: now,
          nextAttemptAt: now,
          updatedAt: now,
        });
        // L7: corrections create a new audit version referencing the old.
        await appendGenerationAudit(ctx, {
          eventId: report.eventId,
          action: "corrected",
          note: `content report ${String(reportId)}: ${statement}`,
        });
      }
    }

    const nextStatus =
      decision === "dismiss"
        ? ("dismissed" as const)
        : decision === "correct"
          ? ("corrected" as const)
          : ("unpublished" as const);

    await ctx.db.patch(reportId, {
      status: nextStatus,
      statementOfReasons: statement,
      decidedAt: now,
      decidedByEmail,
    });

    // DSA: notify the reporter with the statement of reasons if reachable.
    if (report.reporterContact?.includes("@")) {
      await ctx.scheduler.runAfter(0, internal.emails.sendReportOutcomeEmail, {
        reportId,
        to: report.reporterContact,
        decision,
        statementOfReasons: statement,
      });
    }

    return { decided: true as const, status: nextStatus };
  },
});

type ReportDecisionResult =
  | { decided: false; reason: string }
  | { decided: true; status: "dismissed" | "corrected" | "unpublished" };

export const decideContentReportForAdmin = mutation({
  args: {
    reportId: v.id("contentReports"),
    decision: DECISION_VALIDATOR,
    statementOfReasons: v.string(),
  },
  handler: async (ctx, args): Promise<ReportDecisionResult> => {
    const admin = await requireAdminUser(ctx);
    return (await ctx.runMutation(internal.reports.applyReportDecision, {
      ...args,
      decidedByEmail:
        (admin as { email?: string } | null | undefined)?.email ?? undefined,
    })) as ReportDecisionResult;
  },
});

export const listContentReportsForAdmin = query({
  args: {
    status: v.optional(
      v.union(
        v.literal("received"),
        v.literal("dismissed"),
        v.literal("corrected"),
        v.literal("unpublished"),
      ),
    ),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireAdminUser(ctx);
    const safeLimit = Math.min(Math.max(Math.floor(args.limit ?? 50), 1), 200);
    const rows = await ctx.db
      .query("contentReports")
      .withIndex("by_status_createdAt", (q) =>
        q.eq("status", args.status ?? "received"),
      )
      .order("desc")
      .take(safeLimit);
    return await Promise.all(
      rows.map(async (row) => {
        const event = await ctx.db.get(row.eventId);
        return {
          ...row,
          eventTitle: event?.title ?? "(eveniment șters)",
          eventSlug: event?.slug,
          eventUnpublished: Boolean(event?.unpublishedAt),
        };
      }),
    );
  },
});

/** Mark the reporter notification as sent (from the email action). */
export const markReporterNotified = internalMutation({
  args: { reportId: v.id("contentReports") },
  handler: async (ctx, { reportId }) => {
    const report = await ctx.db.get(reportId);
    if (report) {
      await ctx.db.patch(reportId, { reporterNotifiedAt: Date.now() });
    }
  },
});
