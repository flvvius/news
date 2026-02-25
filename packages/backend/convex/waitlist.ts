import { v, ConvexError } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { authComponent } from "./auth";

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

    const normalizedEmail = args.email.toLowerCase();

    // Check if email already exists
    const existing = await ctx.db
      .query("waitlist")
      .withIndex("by_email", (q) => q.eq("email", normalizedEmail))
      .first();

    if (existing) {
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
      .withIndex("by_email", (q) => q.eq("email", args.email.toLowerCase()))
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
    // Admin-only: require authentication and admin email
    const authUser = await authComponent.safeGetAuthUser(ctx);
    if (!authUser) {
      throw new ConvexError("Not authenticated");
    }

    const adminEmails = (process.env.ADMIN_EMAILS ?? "")
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean);

    if (!adminEmails.includes(authUser.email.toLowerCase())) {
      throw new ConvexError("Unauthorized: admin access required");
    }

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
