import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { authComponent } from "./auth";
import { ConvexError } from "convex/values";

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
      privateContext: user.privateContext,
      stats: user.stats,
    };
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

/**
 * Update the current user's private context (for personalized insights).
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

    await ctx.db.patch(user._id, {
      privateContext: args.privateContext,
    });

    return await ctx.db.get(user._id);
  },
});
