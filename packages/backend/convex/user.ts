import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { authComponent } from "./auth";
import { ConvexError } from "convex/values";
import { isAdminEmail } from "./lib/betaAccess";

/**
 * Get the current user's full profile.
 * Returns null if not authenticated.
 */
export const getCurrentUser = query({
  args: {},
  handler: async (ctx) => {
    const authUser = await authComponent.safeGetAuthUser(ctx);
    if (!authUser) {
      return null;
    }

    const user = await ctx.db
      .query("users")
      .withIndex("by_auth_user_id", (q) => q.eq("authUserId", authUser._id))
      .unique();

    if (!user) {
      return null;
    }

    // Load stats from separate table
    const stats = await ctx.db
      .query("userStats")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .unique();

    // Load private context from separate table
    const privateContext = await ctx.db
      .query("userPrivateContext")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .unique();

    return {
      // Auth metadata
      authUserId: authUser._id,
      email: authUser.email,
      emailVerified: authUser.emailVerified,
      name: authUser.name,
      image: authUser.image,
      // Custom data
      _id: user._id,
      profile: user.profile,
      privateContext: privateContext
        ? {
            incomeBracket: privateContext.incomeBracket,
            concerns: privateContext.concerns,
            interests: privateContext.interests,
            politicalLeaning: privateContext.politicalLeaning,
          }
        : undefined,
      stats: stats
        ? {
            currentStreak: stats.currentStreak,
            longestStreak: stats.longestStreak,
            articlesRead: stats.articlesRead,
            biasBalance: stats.biasBalance,
          }
        : {
            currentStreak: 0,
            longestStreak: 0,
            articlesRead: 0,
            biasBalance: 0,
          },
    };
  },
});

export const isCurrentUserAdmin = query({
  args: {},
  handler: async (ctx) => {
    const authUser = await authComponent.safeGetAuthUser(ctx);
    if (!authUser) {
      return false;
    }
    return isAdminEmail(authUser.email);
  },
});

/**
 * Update the current user's profile.
 * Throws ConvexError if not authenticated or user not found.
 */
export const updateProfile = mutation({
  args: {
    profile: v.object({
      name: v.optional(v.string()),
      age: v.optional(v.number()),
      avatar: v.optional(v.string()),
      job: v.optional(v.string()),
      location: v.optional(v.string()),
      preferredLanguage: v.optional(
        v.union(v.literal("ro"), v.literal("en")),
      ),
    }),
  },
  handler: async (ctx, args) => {
    const authUser = await authComponent.safeGetAuthUser(ctx);
    if (!authUser) {
      throw new ConvexError("Not authenticated");
    }

    const user = await ctx.db
      .query("users")
      .withIndex("by_auth_user_id", (q) => q.eq("authUserId", authUser._id))
      .unique();

    if (!user) {
      throw new ConvexError("User not found - please refresh and try again");
    }

    await ctx.db.patch(user._id, {
      profile: { ...user.profile, ...args.profile },
    });

    return await ctx.db.get(user._id);
  },
});

export const updatePreferredLanguage = mutation({
  args: {
    language: v.union(v.literal("ro"), v.literal("en")),
  },
  handler: async (ctx, { language }) => {
    const authUser = await authComponent.safeGetAuthUser(ctx);
    if (!authUser) {
      throw new ConvexError("Not authenticated");
    }

    const user = await ctx.db
      .query("users")
      .withIndex("by_auth_user_id", (q) => q.eq("authUserId", authUser._id))
      .unique();

    if (!user) {
      throw new ConvexError("User not found - please refresh and try again");
    }

    await ctx.db.patch(user._id, {
      profile: { ...user.profile, preferredLanguage: language },
    });

    return { ok: true };
  },
});

/**
 * Update the current user's private context (for personalized insights).
 * Writes to the separate userPrivateContext table.
 * Throws ConvexError if not authenticated or user not found.
 */
export const updatePrivateContext = mutation({
  args: {
    privateContext: v.object({
      incomeBracket: v.optional(v.string()),
      concerns: v.array(v.string()),
      interests: v.array(v.string()),
      politicalLeaning: v.optional(v.string()),
    }),
  },
  handler: async (ctx, args) => {
    const authUser = await authComponent.safeGetAuthUser(ctx);
    if (!authUser) {
      throw new ConvexError("Not authenticated");
    }

    const user = await ctx.db
      .query("users")
      .withIndex("by_auth_user_id", (q) => q.eq("authUserId", authUser._id))
      .unique();

    if (!user) {
      throw new ConvexError("User not found - please refresh and try again");
    }

    // Upsert into userPrivateContext table
    const existing = await ctx.db
      .query("userPrivateContext")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, args.privateContext);
    } else {
      await ctx.db.insert("userPrivateContext", {
        userId: user._id,
        ...args.privateContext,
      });
    }

    return { success: true };
  },
});
