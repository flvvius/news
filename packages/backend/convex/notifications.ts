import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
  internalAction,
  internalQuery,
  mutation,
} from "./_generated/server";
import { authComponent } from "./auth";
import { getUserProfileByAuthUserId } from "./lib/userProfile";

const PLATFORM_VALIDATOR = v.union(v.literal("ios"), v.literal("android"));

/**
 * Register (or reassign) an Expo push token for the current user. Deduped by
 * token: a device that signs into a different account reassigns its row rather
 * than creating a duplicate.
 */
export const registerPushToken = mutation({
  args: { token: v.string(), platform: v.optional(PLATFORM_VALIDATOR) },
  handler: async (ctx, { token, platform }) => {
    const authUser = await authComponent.safeGetAuthUser(ctx);
    if (!authUser) throw new ConvexError("Not authenticated");
    const user = await getUserProfileByAuthUserId(ctx, authUser._id);
    if (!user) throw new ConvexError("User not found");

    const existing = await ctx.db
      .query("pushTokens")
      .withIndex("by_token", (q) => q.eq("token", token))
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        userId: user._id,
        platform,
        updatedAt: Date.now(),
      });
    } else {
      await ctx.db.insert("pushTokens", {
        userId: user._id,
        token,
        platform,
        updatedAt: Date.now(),
      });
    }

    return { ok: true as const };
  },
});

/**
 * Unregister a token (logout). Silent when unauthenticated or not owned — the
 * caller treats this as best-effort.
 */
export const removePushToken = mutation({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const authUser = await authComponent.safeGetAuthUser(ctx);
    if (!authUser) return { ok: false as const };
    const user = await getUserProfileByAuthUserId(ctx, authUser._id);
    if (!user) return { ok: false as const };

    const existing = await ctx.db
      .query("pushTokens")
      .withIndex("by_token", (q) => q.eq("token", token))
      .first();
    if (existing && existing.userId === user._id) {
      await ctx.db.delete(existing._id);
    }
    return { ok: true as const };
  },
});

export const getUserPushTokens = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    const rows = await ctx.db
      .query("pushTokens")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    return rows.map((row) => row.token);
  },
});

const EXPO_PUSH_ENDPOINT = "https://exp.host/--/api/v2/push/send";

/**
 * Send pipeline primitive: deliver a push to every device a user has
 * registered, via Expo's push service. The morning-briefing job (follow-on)
 * fans out to followed-topic events by calling this per user.
 */
export const sendPushToUser = internalAction({
  args: {
    userId: v.id("users"),
    title: v.string(),
    body: v.string(),
    data: v.optional(v.any()),
  },
  handler: async (ctx, args): Promise<{ sent: number }> => {
    const tokens: string[] = await ctx.runQuery(
      internal.notifications.getUserPushTokens,
      { userId: args.userId as Id<"users"> },
    );
    if (tokens.length === 0) return { sent: 0 };

    const messages = tokens.map((token) => ({
      to: token,
      title: args.title,
      body: args.body,
      data: args.data ?? {},
      sound: "default" as const,
    }));

    try {
      const response = await fetch(EXPO_PUSH_ENDPOINT, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(messages),
      });
      if (!response.ok) {
        console.error(
          `[notifications] Expo push send failed: ${response.status}`,
        );
        return { sent: 0 };
      }
    } catch (error) {
      console.error("[notifications] Expo push send threw", error);
      return { sent: 0 };
    }

    return { sent: tokens.length };
  },
});
