import type { MutationCtx, QueryCtx } from "../_generated/server";
import { normalizeEmail } from "./betaAccess";

export async function getUserProfileByAuthUserId(
  ctx: QueryCtx | MutationCtx,
  authUserId: string,
) {
  return await ctx.db
    .query("users")
    .withIndex("by_auth_user_id", (q) => q.eq("authUserId", authUserId))
    .unique();
}

export async function ensureUserProfileForAuthUser(
  ctx: MutationCtx,
  authUser: {
    _id: string;
    email: string;
    name?: string | null;
    image?: string | null;
  },
) {
  const existingUser = await getUserProfileByAuthUserId(ctx, authUser._id);
  if (existingUser) return existingUser;

  const userId = await ctx.db.insert("users", {
    authUserId: authUser._id,
    email: normalizeEmail(authUser.email),
    profile: {
      name: authUser.name ?? undefined,
      avatar: authUser.image ?? undefined,
    },
  });

  await ctx.db.insert("userStats", {
    userId,
    currentStreak: 0,
    longestStreak: 0,
    articlesRead: 0,
    biasBalance: 0,
  });

  return await ctx.db.get(userId);
}
