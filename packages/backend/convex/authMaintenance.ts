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

    const userStats = await ctx.db
      .query("userStats")
      .withIndex("by_user", (q) => q.eq("userId", localUser._id))
      .unique();
    if (userStats) {
      await ctx.db.delete(userStats._id);
    }

    const privateContext = await ctx.db
      .query("userPrivateContext")
      .withIndex("by_user", (q) => q.eq("userId", localUser._id))
      .unique();
    if (privateContext) {
      await ctx.db.delete(privateContext._id);
    }

    const userInsights = await ctx.db
      .query("userInsights")
      .withIndex("by_user", (q) => q.eq("userId", localUser._id))
      .collect();
    for (const insight of userInsights) {
      await ctx.db.delete(insight._id);
    }

    const interactions = await ctx.db
      .query("interactions")
      .withIndex("by_user", (q) => q.eq("userId", localUser._id))
      .collect();
    for (const interaction of interactions) {
      await ctx.db.delete(interaction._id);
    }

    await ctx.db.delete(localUser._id);
  },
});

async function deleteBetterAuthData(
  ctx: any,
  authUser: BetterAuthUser,
) {
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
      const batch: any = await ctx.runQuery(components.betterAuth.adapter.findMany, {
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
      });

      const users = (batch.page ?? []) as BetterAuthUser[];
      for (const authUser of users) {
        try {
          await ctx.runMutation(internal.authMaintenance.deleteAppUserData, {
            authUserId: authUser._id,
          });
          await deleteBetterAuthData(ctx, authUser);
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
