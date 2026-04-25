import { v, ConvexError } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import {
  normalizeEmail,
  requireAdminUser,
} from "./lib/betaAccess";

export const addToWaitlist = mutation({
  args: {
    email: v.string(),
    name: v.optional(v.string()),
    referralSource: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(args.email)) {
      throw new Error("Invalid email format");
    }

    const normalizedEmail = normalizeEmail(args.email);

    // Check if email already exists
    const existing = await ctx.db
      .query("waitlist")
      .withIndex("by_email", (q) => q.eq("email", normalizedEmail))
      .first();

    if (existing) {
      if (existing.status === "unsubscribed") {
        await ctx.db.patch(existing._id, { status: "pending" });
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

export const getWaitlistStats = query({
  args: {},
  handler: async (ctx) => {
    await requireAdminUser(ctx);

    const total = await ctx.db.query("waitlist").collect();
    const pending = total.filter((w) => w.status === "pending").length;
    const invited = total.filter((w) => w.status === "invited").length;
    const converted = total.filter((w) => w.status === "converted").length;

    return {
      total: total.length,
      pending,
      invited,
      converted,
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

    return {
      isValid: true as const,
      email: entry.email,
      name: entry.name ?? null,
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
    const entries = await ctx.db.query("waitlist").collect();
    const sortedByPosition = [...entries].sort((a, b) => a.position - b.position);
    const pending = sortedByPosition.filter((entry) => entry.status === "pending");
    const invited = entries.filter((entry) => entry.status === "invited");
    const converted = entries.filter((entry) => entry.status === "converted");

    return {
      stats: {
        total: entries.length,
        pending: pending.length,
        invited: invited.length,
        converted: converted.length,
      },
      nextPending: pending.slice(0, safeLimit).map((entry) => ({
        _id: entry._id,
        email: entry.email,
        name: entry.name ?? null,
        position: entry.position,
        createdAt: entry.createdAt,
      })),
      recentInvites: invited
        .sort((a, b) => (b.invitedAt ?? 0) - (a.invitedAt ?? 0))
        .slice(0, safeLimit)
        .map((entry) => ({
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
    const allPending = await ctx.db
      .query("waitlist")
      .withIndex("by_status", (q) => q.eq("status", "pending"))
      .order("asc")
      .collect();

    const toInvite = allPending.slice(0, count);
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
