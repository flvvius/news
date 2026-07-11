/**
 * L10 — GDPR data-subject rights: self-service export (art. 15/20) and
 * account deletion (art. 17). The deletion cascade itself lives in
 * authMaintenance.deleteAppUserData (shared with the unverified-account
 * cleanup cron) and covers every table holding a userId reference — the
 * gdprCascade test cross-checks that list against schema.ts.
 */

import { ConvexError } from "convex/values";
import { components, internal } from "./_generated/api";
import { mutation, query } from "./_generated/server";
import { authComponent } from "./auth";
import { enforceRateLimit } from "./lib/rateLimit";

const EXPORT_ROW_CAP = 5000;

/** Authenticated JSON export of everything we hold about the user. */
export const exportMyData = query({
  args: {},
  handler: async (ctx) => {
    const authUser = await authComponent.safeGetAuthUser(ctx);
    if (!authUser) {
      throw new ConvexError("Not authenticated");
    }
    const user = await ctx.db
      .query("users")
      .withIndex("by_auth_user_id", (q) => q.eq("authUserId", authUser._id))
      .unique();

    const [
      stats,
      privateContext,
      interactions,
      insights,
      quizAttempts,
      pushTokens,
      guestMerges,
      briefingSends,
      waitlistRow,
    ] = user
      ? await Promise.all([
          ctx.db
            .query("userStats")
            .withIndex("by_user", (q) => q.eq("userId", user._id))
            .unique(),
          ctx.db
            .query("userPrivateContext")
            .withIndex("by_user", (q) => q.eq("userId", user._id))
            .unique(),
          ctx.db
            .query("interactions")
            .withIndex("by_user", (q) => q.eq("userId", user._id))
            .order("desc")
            .take(EXPORT_ROW_CAP),
          ctx.db
            .query("userInsights")
            .withIndex("by_user", (q) => q.eq("userId", user._id))
            .take(EXPORT_ROW_CAP),
          ctx.db
            .query("quizAttempts")
            .withIndex("by_user_quiz", (q) => q.eq("userId", user._id))
            .take(EXPORT_ROW_CAP),
          ctx.db
            .query("pushTokens")
            .withIndex("by_user", (q) => q.eq("userId", user._id))
            .collect(),
          ctx.db
            .query("guestMerges")
            .withIndex("by_user", (q) => q.eq("userId", user._id))
            .collect(),
          ctx.db
            .query("briefingSends")
            .withIndex("by_user", (q) => q.eq("userId", user._id))
            .take(EXPORT_ROW_CAP),
          ctx.db
            .query("waitlist")
            .withIndex("by_email", (q) =>
              q.eq("email", authUser.email.toLowerCase()),
            )
            .first(),
        ])
      : [null, null, [], [], [], [], [], [], null];

    return {
      exportedAt: new Date().toISOString(),
      account: {
        email: authUser.email,
        name: authUser.name,
        emailVerified: authUser.emailVerified,
        createdAt: authUser.createdAt,
      },
      profile: user?.profile ?? null,
      followedTopicIds: user?.followedTopicIds ?? [],
      stats,
      privateContext,
      // Reading history + bookmarks + shares (the immutable interaction log).
      interactions,
      insights,
      quizAttempts,
      pushTokens: pushTokens.map((token) => ({
        platform: token.platform,
        updatedAt: token.updatedAt,
      })),
      guestMerges,
      briefingSends,
      waitlist: waitlistRow
        ? {
            email: waitlistRow.email,
            status: waitlistRow.status,
            position: waitlistRow.position,
            createdAt: waitlistRow.createdAt,
            referralSource: waitlistRow.referralSource,
            // L12 consent records ride along once present on the row.
            ...("consentTextHash" in waitlistRow
              ? {
                  consent: {
                    consentTextHash: (
                      waitlistRow as { consentTextHash?: string }
                    ).consentTextHash,
                  },
                }
              : {}),
          }
        : null,
    };
  },
});

/**
 * Self-service account deletion: app-data cascade + Better Auth records +
 * a scheduled PostHog person/event erasure.
 */
export const deleteMyAccount = mutation({
  args: {},
  handler: async (ctx) => {
    const authUser = await authComponent.safeGetAuthUser(ctx);
    if (!authUser) {
      throw new ConvexError("Not authenticated");
    }
    await enforceRateLimit(ctx, {
      key: `deleteAccount:${authUser._id}`,
      limit: 3,
      windowMs: 60 * 60 * 1000,
    });

    // 1. App data (every userId table + waitlist row).
    await ctx.runMutation(internal.authMaintenance.deleteAppUserData, {
      authUserId: authUser._id,
    });

    // 2. Better Auth records (sessions, accounts, verifications, user).
    const userId = authUser._id;
    await ctx.runMutation(components.betterAuth.adapter.deleteMany, {
      paginationOpts: { cursor: null, numItems: 200 },
      input: {
        model: "session",
        where: [{ field: "userId", operator: "eq", value: userId }],
      },
    });
    await ctx.runMutation(components.betterAuth.adapter.deleteMany, {
      paginationOpts: { cursor: null, numItems: 200 },
      input: {
        model: "account",
        where: [{ field: "userId", operator: "eq", value: userId }],
      },
    });
    await ctx.runMutation(components.betterAuth.adapter.deleteMany, {
      paginationOpts: { cursor: null, numItems: 200 },
      input: {
        model: "verification",
        where: [{ field: "identifier", operator: "eq", value: authUser.email }],
      },
    });
    await ctx.runMutation(components.betterAuth.adapter.deleteMany, {
      paginationOpts: { cursor: null, numItems: 200 },
      input: {
        model: "user",
        where: [{ field: "_id", operator: "eq", value: userId }],
      },
    });

    // 3. Analytics erasure (no-ops cleanly when PostHog creds are not set).
    await ctx.scheduler.runAfter(0, internal.posthog.deletePostHogPerson, {
      distinctId: userId,
    });

    return { deleted: true as const };
  },
});
