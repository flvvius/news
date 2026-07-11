import { v } from "convex/values";
import { internalAction, internalMutation } from "./_generated/server";
import { components, internal } from "./_generated/api";

const UNVERIFIED_ACCOUNT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const CLEANUP_BATCH_SIZE = 100;

type BetterAuthUser = {
  _id: string;
  email: string;
  emailVerified: boolean;
  createdAt: number;
};

/**
 * L10 — full GDPR cascade over every table holding a userId reference (the
 * gdprCascade test cross-checks this list against `v.id("users")` usages in
 * schema.ts, so adding a new user-linked table without covering it here
 * fails the build). The waitlist row is keyed by email and removed too.
 */
export const deleteAppUserData = internalMutation({
  args: { authUserId: v.string() },
  handler: async (ctx, args) => {
    const localUser = await ctx.db
      .query("users")
      .withIndex("by_auth_user_id", (q) => q.eq("authUserId", args.authUserId))
      .unique();

    if (!localUser) {
      return;
    }
    const userId = localUser._id;

    const deleteByUserIndex = async (
      table:
        | "userStats"
        | "userPrivateContext"
        | "userInsights"
        | "interactions"
        | "guestMerges"
        | "pushTokens"
        | "briefingSends",
    ) => {
      const rows = await ctx.db
        .query(table)
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .collect();
      for (const row of rows) {
        await ctx.db.delete(row._id);
      }
    };

    await deleteByUserIndex("userStats");
    await deleteByUserIndex("userPrivateContext");
    await deleteByUserIndex("userInsights");
    await deleteByUserIndex("interactions");
    await deleteByUserIndex("guestMerges");
    await deleteByUserIndex("pushTokens");
    await deleteByUserIndex("briefingSends");

    // quizAttempts indexes start with (userId, quizId/dateKey) — the prefix
    // matches on userId alone.
    const quizAttempts = await ctx.db
      .query("quizAttempts")
      .withIndex("by_user_quiz", (q) => q.eq("userId", userId))
      .collect();
    for (const attempt of quizAttempts) {
      await ctx.db.delete(attempt._id);
    }

    // Waitlist entry (keyed by email, not userId).
    const waitlistRow = await ctx.db
      .query("waitlist")
      .withIndex("by_email", (q) =>
        q.eq("email", localUser.email.toLowerCase()),
      )
      .first();
    if (waitlistRow) {
      await ctx.db.delete(waitlistRow._id);
    }

    await ctx.db.delete(userId);
  },
});

async function deleteBetterAuthData(ctx: any, authUser: BetterAuthUser) {
  const userId = authUser._id;

  await ctx.runMutation(components.betterAuth.adapter.deleteMany, {
    model: "session",
    where: [{ field: "userId", operator: "eq", value: userId }],
  });
  await ctx.runMutation(components.betterAuth.adapter.deleteMany, {
    model: "account",
    where: [{ field: "userId", operator: "eq", value: userId }],
  });
  await ctx.runMutation(components.betterAuth.adapter.deleteMany, {
    model: "twoFactor",
    where: [{ field: "userId", operator: "eq", value: userId }],
  });
  await ctx.runMutation(components.betterAuth.adapter.deleteMany, {
    model: "passkey",
    where: [{ field: "userId", operator: "eq", value: userId }],
  });
  await ctx.runMutation(components.betterAuth.adapter.deleteMany, {
    model: "verification",
    where: [{ field: "identifier", operator: "eq", value: authUser.email }],
  });
  await ctx.runMutation(components.betterAuth.adapter.deleteMany, {
    model: "user",
    where: [{ field: "_id", operator: "eq", value: userId }],
  });
}

export const cleanupExpiredUnverifiedAccounts = internalAction({
  args: {},
  handler: async (ctx) => {
    const cutoff = Date.now() - UNVERIFIED_ACCOUNT_TTL_MS;
    let cursor: string | null = null;
    let deletedCount = 0;
    let failedCount = 0;

    while (true) {
      const batch: any = await ctx.runQuery(
        components.betterAuth.adapter.findMany,
        {
          model: "user",
          paginationOpts: {
            cursor,
            numItems: CLEANUP_BATCH_SIZE,
          },
          sortBy: { field: "createdAt", direction: "asc" },
          where: [
            { field: "emailVerified", operator: "eq", value: false },
            { field: "createdAt", operator: "lte", value: cutoff },
          ],
        },
      );

      const users = (batch.page ?? []) as BetterAuthUser[];
      for (const authUser of users) {
        try {
          const currentSnapshot: any = await ctx.runQuery(
            components.betterAuth.adapter.findMany,
            {
              model: "user",
              paginationOpts: {
                cursor: null,
                numItems: 1,
              },
              sortBy: { field: "createdAt", direction: "asc" },
              where: [{ field: "_id", operator: "eq", value: authUser._id }],
            },
          );
          const currentUser = (currentSnapshot.page ?? [])[0] as
            | BetterAuthUser
            | undefined;
          if (!currentUser) {
            continue;
          }
          if (currentUser.emailVerified || currentUser.createdAt > cutoff) {
            continue;
          }

          await ctx.runMutation(internal.authMaintenance.deleteAppUserData, {
            authUserId: currentUser._id,
          });
          await deleteBetterAuthData(ctx, currentUser);
          deletedCount += 1;
        } catch (error) {
          failedCount += 1;
          console.error(
            `[authMaintenance] Failed to delete user ${authUser._id}:`,
            error,
          );
        }
      }

      if (batch.isDone) {
        break;
      }

      cursor = batch.continueCursor;
      if (!cursor) {
        break;
      }
    }

    return { deletedCount, failedCount, cutoff };
  },
});
