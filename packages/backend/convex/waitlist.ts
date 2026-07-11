import { v, ConvexError } from "convex/values";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import { internal } from "./_generated/api";
import {
  getWaitlistRecordByEmail,
  isAdminEmail,
  normalizeEmail,
  requireAdminUser,
} from "./lib/betaAccess";
import {
  hashConsentText,
  WAITLIST_CONSENT_TEXT,
  WAITLIST_CONSENT_TEXT_VERSION,
} from "./lib/consent";
import { authComponent } from "./auth";

export const addToWaitlist = mutation({
  args: {
    email: v.string(),
    name: v.optional(v.string()),
    referralSource: v.optional(v.string()),
    // L12 — consent provenance recorded per signup.
    consentSourcePage: v.optional(v.string()),
    clientIp: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(args.email)) {
      throw new Error("Invalid email format");
    }

    const normalizedEmail = normalizeEmail(args.email);

    // L12 — exact consent statement version + hash, timestamp, IP, source.
    const consentRecord = {
      consentAt: Date.now(),
      consentIp: args.clientIp?.slice(0, 64),
      consentTextVersion: WAITLIST_CONSENT_TEXT_VERSION,
      consentTextHash: hashConsentText(WAITLIST_CONSENT_TEXT),
      consentSourcePage: args.consentSourcePage?.slice(0, 200),
    };

    // Check if email already exists
    const existing = await getWaitlistRecordByEmail(ctx, normalizedEmail);

    if (existing) {
      if (existing.status === "unsubscribed") {
        // Re-subscribing is a fresh consent event.
        await ctx.db.patch(existing._id, {
          status: "pending",
          ...consentRecord,
          unsubscribeToken: existing.unsubscribeToken ?? crypto.randomUUID(),
        });
        return {
          success: true,
          alreadyExists: false,
          position: existing.position,
        };
      }

      return {
        success: true,
        alreadyExists: true,
        position: existing.position,
      };
    }

    // Calculate position (max position + 1, or 1 if first)
    const highest = await ctx.db
      .query("waitlist")
      .withIndex("by_position")
      .order("desc")
      .first();
    const position = (highest?.position ?? 0) + 1;

    // Add to waitlist
    const waitlistId = await ctx.db.insert("waitlist", {
      email: normalizedEmail,
      name: args.name,
      position,
      referralSource: args.referralSource,
      createdAt: Date.now(),
      status: "pending",
      ...consentRecord,
      unsubscribeToken: crypto.randomUUID(),
    });

    // Schedule welcome email (only if RESEND_API_KEY is set)
    if (process.env.RESEND_API_KEY) {
      await ctx.scheduler.runAfter(0, internal.emails.sendWelcomeEmail, {
        email: normalizedEmail,
        name: args.name,
        position,
        waitlistId,
      });
    }

    return {
      success: true,
      alreadyExists: false,
      position,
      waitlistId,
    };
  },
});

/**
 * Internal mutation to mark lastEmailSentAt after a successful send.
 * Called from the sendWelcomeEmail action.
 */
export const markEmailSent = internalMutation({
  args: { waitlistId: v.id("waitlist") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.waitlistId, {
      lastEmailSentAt: Date.now(),
    });
  },
});

export const unsubscribe = mutation({
  args: {
    email: v.string(),
  },
  handler: async (ctx, args) => {
    const record = await ctx.db
      .query("waitlist")
      .withIndex("by_email", (q) =>
        q.eq("email", normalizeEmail(args.email)),
      )
      .first();

    if (!record) {
      // Return success anyway — don't reveal whether email exists
      return { success: true };
    }

    await ctx.db.patch(record._id, {
      status: "unsubscribed",
    });

    return { success: true };
  },
});

/**
 * L12 — one-click unsubscribe by token (no login, no e-mail knowledge
 * required). Takes effect immediately: `unsubscribed` suppresses every send
 * path (checked server-side in getSendableWaitlistEntry).
 */
export const unsubscribeByToken = mutation({
  args: {
    token: v.string(),
  },
  handler: async (ctx, args) => {
    const token = args.token.trim();
    if (!token) {
      return { success: false as const };
    }
    const record = await ctx.db
      .query("waitlist")
      .withIndex("by_unsubscribe_token", (q) =>
        q.eq("unsubscribeToken", token),
      )
      .unique();
    if (!record) {
      // Do not reveal token validity beyond a generic failure.
      return { success: false as const };
    }
    await ctx.db.patch(record._id, { status: "unsubscribed" });
    return { success: true as const, email: record.email };
  },
});

/**
 * L12 — suppression gate for every send path: returns the entry only when
 * it may still receive e-mail, and guarantees it carries an unsubscribe
 * token (legacy rows get one lazily via ensureUnsubscribeToken).
 */
export const getSendableWaitlistEntry = internalQuery({
  args: { waitlistId: v.id("waitlist") },
  handler: async (ctx, { waitlistId }) => {
    const entry = await ctx.db.get(waitlistId);
    if (!entry) return null;
    if (entry.status === "unsubscribed" || entry.status === "bounced") {
      return null;
    }
    return {
      _id: entry._id,
      email: entry.email,
      name: entry.name,
      position: entry.position,
      status: entry.status,
      unsubscribeToken: entry.unsubscribeToken ?? null,
    };
  },
});

/** Assign a token to a legacy row (called from send actions when missing). */
export const ensureUnsubscribeToken = internalMutation({
  args: { waitlistId: v.id("waitlist") },
  handler: async (ctx, { waitlistId }) => {
    const entry = await ctx.db.get(waitlistId);
    if (!entry) return null;
    if (entry.unsubscribeToken) return entry.unsubscribeToken;
    const token = crypto.randomUUID();
    await ctx.db.patch(waitlistId, { unsubscribeToken: token });
    return token;
  },
});

export const getWaitlistStats = query({
  args: {},
  handler: async (ctx) => {
    await requireAdminUser(ctx);

    const [pendingRows, invitedRows, convertedRows, bouncedRows, unsubscribedRows] =
      await Promise.all([
      ctx.db
        .query("waitlist")
        .withIndex("by_status", (q) => q.eq("status", "pending"))
        .collect(),
      ctx.db
        .query("waitlist")
        .withIndex("by_status", (q) => q.eq("status", "invited"))
        .collect(),
      ctx.db
        .query("waitlist")
        .withIndex("by_status", (q) => q.eq("status", "converted"))
        .collect(),
      ctx.db
        .query("waitlist")
        .withIndex("by_status", (q) => q.eq("status", "bounced"))
        .collect(),
      ctx.db
        .query("waitlist")
        .withIndex("by_status", (q) => q.eq("status", "unsubscribed"))
        .collect(),
    ]);

    return {
      total:
        pendingRows.length +
        invitedRows.length +
        convertedRows.length +
        bouncedRows.length +
        unsubscribedRows.length,
      pending: pendingRows.length,
      invited: invitedRows.length,
      converted: convertedRows.length,
    };
  },
});

export const getInvitePreview = query({
  args: {
    inviteCode: v.string(),
  },
  handler: async (ctx, args) => {
    const inviteCode = args.inviteCode.trim();
    if (!inviteCode) {
      return { isValid: false as const };
    }

    const entry = await ctx.db
      .query("waitlist")
      .withIndex("by_invite_code", (q) => q.eq("inviteCode", inviteCode))
      .unique();

    if (!entry) {
      return { isValid: false as const };
    }

    if (
      entry.status !== "invited" &&
      entry.status !== "converted"
    ) {
      return { isValid: false as const };
    }

    const authUser = await authComponent.safeGetAuthUser(ctx);
    const canRevealPII = authUser
      ? isAdminEmail(authUser.email) ||
        normalizeEmail(authUser.email) === entry.email
      : false;

    return {
      isValid: true as const,
      email: canRevealPII ? entry.email : null,
      name: canRevealPII ? entry.name ?? null : null,
      status: entry.status,
      position: entry.position,
      invitedAt: entry.invitedAt ?? null,
      convertedAt: entry.convertedAt ?? null,
    };
  },
});

export const getWaitlistAdminOverview = query({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireAdminUser(ctx);

    const safeLimit = Math.min(Math.max(args.limit ?? 10, 1), 50);
    const [
      pendingRows,
      invitedRows,
      convertedRows,
      bouncedRows,
      unsubscribedRows,
      nextPending,
      recentInvites,
    ] = await Promise.all([
      ctx.db
        .query("waitlist")
        .withIndex("by_status", (q) => q.eq("status", "pending"))
        .collect(),
      ctx.db
        .query("waitlist")
        .withIndex("by_status", (q) => q.eq("status", "invited"))
        .collect(),
      ctx.db
        .query("waitlist")
        .withIndex("by_status", (q) => q.eq("status", "converted"))
        .collect(),
      ctx.db
        .query("waitlist")
        .withIndex("by_status", (q) => q.eq("status", "bounced"))
        .collect(),
      ctx.db
        .query("waitlist")
        .withIndex("by_status", (q) => q.eq("status", "unsubscribed"))
        .collect(),
      ctx.db
        .query("waitlist")
        .withIndex("by_status", (q) => q.eq("status", "pending"))
        .order("asc")
        .take(safeLimit),
      ctx.db
        .query("waitlist")
        .withIndex("by_status_invitedAt", (q) => q.eq("status", "invited"))
        .order("desc")
        .take(safeLimit),
    ]);

    return {
      stats: {
        total:
          pendingRows.length +
          invitedRows.length +
          convertedRows.length +
          bouncedRows.length +
          unsubscribedRows.length,
        pending: pendingRows.length,
        invited: invitedRows.length,
        converted: convertedRows.length,
      },
      nextPending: nextPending.map((entry) => ({
        _id: entry._id,
        email: entry.email,
        name: entry.name ?? null,
        position: entry.position,
        createdAt: entry.createdAt,
      })),
      recentInvites: recentInvites.map((entry) => ({
        _id: entry._id,
        email: entry.email,
        name: entry.name ?? null,
        position: entry.position,
        invitedAt: entry.invitedAt ?? null,
      })),
    };
  },
});

export const inviteWaitlistUser = mutation({
  args: {
    waitlistId: v.id("waitlist"),
  },
  handler: async (ctx, args) => {
    await requireAdminUser(ctx);

    if (!process.env.RESEND_API_KEY) {
      throw new ConvexError("RESEND_API_KEY is not configured");
    }

    const entry = await ctx.db.get(args.waitlistId);
    if (!entry) {
      throw new ConvexError("Waitlist entry not found");
    }

    if (entry.status === "converted") {
      throw new ConvexError("This user has already converted");
    }
    if (entry.status === "unsubscribed" || entry.status === "bounced") {
      throw new ConvexError("This waitlist entry cannot receive invites");
    }

    const inviteCode = entry.inviteCode ?? crypto.randomUUID();
    const invitedAt = entry.invitedAt ?? Date.now();

    await ctx.db.patch(entry._id, {
      inviteCode,
      invitedAt,
      status: "invited",
    });

    await ctx.scheduler.runAfter(0, internal.emails.sendInviteEmail, {
      waitlistId: entry._id,
      email: entry.email,
      name: entry.name,
      inviteCode,
    });

    return {
      success: true,
      email: entry.email,
      inviteCode,
      emailQueued: true,
    };
  },
});

export const inviteNextPendingUsers = mutation({
  args: {
    count: v.number(),
  },
  handler: async (ctx, args) => {
    await requireAdminUser(ctx);

    if (!process.env.RESEND_API_KEY) {
      throw new ConvexError("RESEND_API_KEY is not configured");
    }

    const count = Math.min(Math.max(Math.floor(args.count), 1), 100);
    const toInvite = await ctx.db
      .query("waitlist")
      .withIndex("by_status", (q) => q.eq("status", "pending"))
      .order("asc")
      .take(count);
    const now = Date.now();
    const invitedEmails: string[] = [];

    for (const entry of toInvite) {
      const inviteCode = entry.inviteCode ?? crypto.randomUUID();
      await ctx.db.patch(entry._id, {
        inviteCode,
        invitedAt: now,
        status: "invited",
      });

      await ctx.scheduler.runAfter(0, internal.emails.sendInviteEmail, {
        waitlistId: entry._id,
        email: entry.email,
        name: entry.name,
        inviteCode,
      });

      invitedEmails.push(entry.email);
    }

    return {
      success: true,
      invitedCount: toInvite.length,
      invitedEmails,
      emailQueued: true,
    };
  },
});
