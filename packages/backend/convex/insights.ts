import { v } from "convex/values";
import { query } from "./_generated/server";
import { authComponent } from "./auth";
import { getUserProfileByAuthUserId } from "./lib/userProfile";

/**
 * The signed-in user's personalized "So What?" insight for an event, or null
 * when signed out, never generated, or expired.
 */
export const getMyEventInsight = query({
  args: { eventId: v.id("events") },
  handler: async (ctx, args) => {
    const authUser = await authComponent.safeGetAuthUser(ctx);
    if (!authUser) return null;

    const user = await getUserProfileByAuthUserId(ctx, authUser._id);
    if (!user) return null;

    const insight = await ctx.db
      .query("userInsights")
      .withIndex("by_user_event", (q) =>
        q.eq("userId", user._id).eq("eventId", args.eventId),
      )
      .unique();

    if (!insight || insight.expiresAt < Date.now()) return null;

    return {
      personalImpact: insight.content.personalImpact,
      actionableTip: insight.content.actionableTip,
      generatedAt: insight.generatedAt,
    };
  },
});
