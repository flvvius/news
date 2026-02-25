import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";

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
    const allWaitlist = await ctx.db.query("waitlist").collect();
    const maxPosition =
      allWaitlist.length > 0
        ? Math.max(...allWaitlist.map((w) => w.position))
        : 0;
    const position = maxPosition + 1;

    // Add to waitlist
    const waitlistId = await ctx.db.insert("waitlist", {
      email: normalizedEmail,
      name: args.name,
      position,
      referralSource: args.referralSource,
      createdAt: Date.now(),
      status: "pending",
      unsubscribed: false,
    });

    // Schedule welcome email (only if RESEND_API_KEY is set)
    if (process.env.RESEND_API_KEY) {
      await ctx.scheduler.runAfter(0, internal.emails.sendWelcomeEmail, {
        email: normalizedEmail,
        name: args.name,
        position,
      });

      // Update lastEmailSentAt
      await ctx.db.patch(waitlistId, {
        lastEmailSentAt: Date.now(),
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
      unsubscribed: true,
      status: "unsubscribed",
    });

    return { success: true };
  },
});

export const getWaitlistStats = query({
  args: {},
  handler: async (ctx) => {
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
