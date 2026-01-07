import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { authComponent } from "./auth";

export const getOrCreateUser = mutation({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      return null;
    }

    const authUser = await authComponent.safeGetAuthUser(ctx);
    if (!authUser) {
      return null;
    }

    const userId = authUser._id;

    const existingUser = await ctx.db
      .query("users")
      .withIndex("by_auth_user_id", (q) => q.eq("authUserId", userId))
      .unique();

    if (existingUser) {
      return existingUser;
    }

    const newUserId = await ctx.db.insert("users", {
      authUserId: userId,
      email: authUser.email ?? "",
      profile: {
        name: authUser.name ?? undefined,
        avatar: authUser.image ?? undefined,
      },
      stats: {
        currentStreak: 0,
        longestStreak: 0,
        articlesRead: 0,
        biasBalance: 0,
      },
    });

    return await ctx.db.get(newUserId);
  },
});

export const getCurrentUser = query({
  args: {},
  handler: async (ctx) => {
    const authUser = await authComponent.safeGetAuthUser(ctx);
    if (!authUser) {
      return null;
    }

    const userId = authUser._id;

    const user = await ctx.db
      .query("users")
      .withIndex("by_auth_user_id", (q) => q.eq("authUserId", userId))
      .unique();

    if (!user) {
      return null;
    }

    return {
      // Auth data
      authUserId: authUser.userId,
      email: authUser.email,
      emailVerified: authUser.emailVerified,
      // Custom data
      _id: user._id,
      profile: user.profile,
      privateContext: user.privateContext,
      stats: user.stats,
    };
  },
});

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
      throw new Error("Not authenticated");
    }

    const userId = authUser._id;

    const user = await ctx.db
      .query("users")
      .withIndex("by_auth_user_id", (q) => q.eq("authUserId", userId))
      .unique();

    if (!user) {
      throw new Error("User not found");
    }

    await ctx.db.patch(user._id, {
      profile: { ...user.profile, ...args.profile },
    });

    return await ctx.db.get(user._id);
  },
});

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
      throw new Error("Not authenticated");
    }

    const userId = authUser._id;

    const user = await ctx.db
      .query("users")
      .withIndex("by_auth_user_id", (q) => q.eq("authUserId", userId))
      .unique();

    if (!user) {
      throw new Error("User not found");
    }

    await ctx.db.patch(user._id, {
      privateContext: args.privateContext,
    });

    return await ctx.db.get(user._id);
  },
});
