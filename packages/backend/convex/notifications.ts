import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
} from "./_generated/server";
import { authComponent } from "./auth";
import { enforceRateLimit } from "./lib/rateLimit";
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

    // Ticket 18: bound token registrations per user.
    await enforceRateLimit(ctx, {
      key: `pushToken:${user._id}`,
      limit: 10,
      windowMs: 60_000,
    });

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

/**
 * Delete tokens Expo reported as undeliverable (DeviceNotRegistered) so a dead
 * device stops being targeted on every future send (Ticket 19).
 */
export const pruneInvalidTokens = internalMutation({
  args: { tokens: v.array(v.string()) },
  handler: async (ctx, { tokens }) => {
    for (const token of tokens) {
      const row = await ctx.db
        .query("pushTokens")
        .withIndex("by_token", (q) => q.eq("token", token))
        .first();
      if (row) await ctx.db.delete(row._id);
    }
    return { pruned: tokens.length };
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

      // Prune tokens Expo reports as DeviceNotRegistered so dead devices stop
      // being targeted (Ticket 19). Receipts line up 1:1 with `messages`.
      const payload = (await response.json()) as {
        data?: Array<{ status?: string; details?: { error?: string } }>;
      };
      const deadTokens: string[] = [];
      payload.data?.forEach((ticket, index) => {
        if (
          ticket.status === "error" &&
          ticket.details?.error === "DeviceNotRegistered"
        ) {
          const token = tokens[index];
          if (token) deadTokens.push(token);
        }
      });
      if (deadTokens.length > 0) {
        await ctx.runMutation(internal.notifications.pruneInvalidTokens, {
          tokens: deadTokens,
        });
      }
      return { sent: tokens.length - deadTokens.length };
    } catch (error) {
      console.error("[notifications] Expo push send threw", error);
      return { sent: 0 };
    }
  },
});
