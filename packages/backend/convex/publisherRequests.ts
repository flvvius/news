/**
 * L6 — publisher opt-out/takedown requests. Public form submission →
 * requests table + pipeline alert; admin approval executes the block
 * (domainPermissions → blocked, content purged) as a single action, with
 * the full lifecycle logged (received → decided → executed timestamps).
 */

import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { requireAdminUser } from "./lib/betaAccess";
import { enforceRateLimit } from "./lib/rateLimit";
import { normalizeDomain } from "./lib/tdmPolicy";

const MAX_MESSAGE_CHARS = 2000;

/** Public: submit an opt-out/takedown request (rate-limited, no auth). */
export const submitPublisherRequest = mutation({
  args: {
    domain: v.string(),
    contact: v.string(),
    requestType: v.union(
      v.literal("opt_out"),
      v.literal("takedown"),
      v.literal("other"),
    ),
    message: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const domain = normalizeDomain(args.domain);
    if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(domain)) {
      throw new ConvexError("Invalid domain");
    }
    const contact = args.contact.trim();
    if (contact.length < 5 || contact.length > 200) {
      throw new ConvexError("Invalid contact");
    }

    // One submission window per domain plus a global lid, since the form is
    // reachable without auth.
    await enforceRateLimit(ctx, {
      key: `publisherRequest:${domain}`,
      limit: 3,
      windowMs: 60 * 60 * 1000,
    });
    await enforceRateLimit(ctx, {
      key: "publisherRequest:all",
      limit: 30,
      windowMs: 60 * 60 * 1000,
    });

    const requestId = await ctx.db.insert("publisherRequests", {
      domain,
      contact,
      requestType: args.requestType,
      message: args.message?.slice(0, MAX_MESSAGE_CHARS),
      status: "received",
      receivedAt: Date.now(),
    });

    // Alert the operator (surfaces in the pipeline admin alert feed).
    await ctx.db.insert("pipelineAlerts", {
      severity: "warning",
      code: "publisher_request_received",
      message: `Publisher ${args.requestType} request for ${domain}`,
      details: { domain, requestType: args.requestType, contact },
      createdAt: Date.now(),
    });

    return { received: true as const, requestId };
  },
});

export const listPublisherRequestsForAdmin = query({
  args: {
    status: v.optional(
      v.union(
        v.literal("received"),
        v.literal("approved"),
        v.literal("denied"),
        v.literal("executed"),
      ),
    ),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireAdminUser(ctx);
    const safeLimit = Math.min(Math.max(Math.floor(args.limit ?? 50), 1), 200);
    return await ctx.db
      .query("publisherRequests")
      .withIndex("by_status_receivedAt", (q) =>
        q.eq("status", args.status ?? "received"),
      )
      .order("desc")
      .take(safeLimit);
  },
});

/**
 * Single admin action: approve executes the domain block + content purge
 * immediately (received → approved → executed in one call); deny just logs.
 */
export const decidePublisherRequest = mutation({
  args: {
    requestId: v.id("publisherRequests"),
    decision: v.union(v.literal("approve"), v.literal("deny")),
    note: v.optional(v.string()),
  },
  handler: async (ctx, { requestId, decision, note }) => {
    const admin = await requireAdminUser(ctx);
    const request = await ctx.db.get(requestId);
    if (!request || request.status !== "received") {
      return { decided: false as const, reason: "not_pending" };
    }
    const decidedByEmail =
      (admin as { email?: string } | null | undefined)?.email ?? undefined;
    const now = Date.now();

    if (decision === "deny") {
      await ctx.db.patch(requestId, {
        status: "denied",
        decidedAt: now,
        decidedByEmail,
        decisionNote: note,
      });
      return { decided: true as const, executed: false as const };
    }

    await ctx.db.patch(requestId, {
      status: "approved",
      decidedAt: now,
      decidedByEmail,
      decisionNote: note,
    });

    // Execute: flip the domain to blocked (manual override) — the upsert
    // schedules the content purge automatically (L5).
    await ctx.runMutation(internal.domainPermissions.upsertDomainPermission, {
      domain: request.domain,
      state: "blocked",
      signals: [`publisher_request:${String(requestId)}`],
      manualOverride: true,
    });

    await ctx.db.patch(requestId, {
      status: "executed",
      executedAt: Date.now(),
    });

    return { decided: true as const, executed: true as const };
  },
});
