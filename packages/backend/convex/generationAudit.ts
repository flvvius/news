/**
 * L7 — immutable generation audit log. One append-only record per pipeline
 * action on a summary (publish, block, hold, review decision, correction,
 * unpublish). This module is the ONLY writer to the generationAudit table
 * and deliberately exposes no update or delete mutation: corrections append
 * a new version whose supersedesAuditId points at the superseded record.
 */

import { v } from "convex/values";
import { internalQuery, query } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { requireAdminUser } from "./lib/betaAccess";

export const AUDIT_SOURCE_VALIDATOR = v.array(
  v.object({
    articleId: v.id("articles"),
    canonicalUrl: v.string(),
    contentHash: v.optional(v.string()),
    fetchedAt: v.optional(v.number()),
    permissionState: v.optional(v.string()),
  }),
);

export type GenerationAuditAction = Doc<"generationAudit">["action"];

export type AppendAuditArgs = {
  eventId: Id<"events">;
  jobId?: Id<"eventSummaryJobs">;
  runId?: string;
  action: GenerationAuditAction;
  model?: string;
  promptVersion?: string;
  summary?: {
    neutral: string;
    reformist: string;
    suveranist: string;
    globalImpact: string;
    perspectiveApplicable: boolean;
  };
  sourceArticles?: Array<{
    articleId: Id<"articles">;
    canonicalUrl: string;
    contentHash?: string;
    fetchedAt?: number;
    permissionState?: string;
  }>;
  overlapCheckJson?: string;
  groundingJson?: string;
  reviewOutcome?: string;
  disclosureLabelVersion?: string;
  publishedAt?: number;
  unpublishedAt?: number;
  note?: string;
};

/**
 * Append the next audit version for an event. Called from inside the
 * pipeline mutations (same transaction as the state change it documents).
 * Non-exported as a Convex function on purpose: only trusted mutation code
 * can write audit rows, and nothing can rewrite them.
 */
export async function appendGenerationAudit(
  ctx: MutationCtx,
  args: AppendAuditArgs,
): Promise<Id<"generationAudit">> {
  const latest = await ctx.db
    .query("generationAudit")
    .withIndex("by_event_version", (q) => q.eq("eventId", args.eventId))
    .order("desc")
    .first();

  return await ctx.db.insert("generationAudit", {
    eventId: args.eventId,
    jobId: args.jobId,
    runId: args.runId,
    version: (latest?.version ?? 0) + 1,
    supersedesAuditId: latest?._id,
    action: args.action,
    model: args.model,
    promptVersion: args.promptVersion,
    summary: args.summary,
    sourceArticles: args.sourceArticles ?? [],
    overlapCheckJson: args.overlapCheckJson,
    groundingJson: args.groundingJson,
    reviewOutcome: args.reviewOutcome,
    disclosureLabelVersion: args.disclosureLabelVersion,
    publishedAt: args.publishedAt,
    unpublishedAt: args.unpublishedAt,
    note: args.note,
    createdAt: Date.now(),
  });
}

/** Full audit chain for one event (admin). Single query reconstructs
 * sources → checks → publication → corrections. */
export const getGenerationAuditForAdmin = query({
  args: { eventId: v.id("events") },
  handler: async (ctx, { eventId }) => {
    await requireAdminUser(ctx);
    return await ctx.db
      .query("generationAudit")
      .withIndex("by_event_version", (q) => q.eq("eventId", eventId))
      .order("asc")
      .collect();
  },
});

export const getLatestAuditForEvent = internalQuery({
  args: { eventId: v.id("events") },
  handler: async (ctx, { eventId }) => {
    return await ctx.db
      .query("generationAudit")
      .withIndex("by_event_version", (q) => q.eq("eventId", eventId))
      .order("desc")
      .first();
  },
});
