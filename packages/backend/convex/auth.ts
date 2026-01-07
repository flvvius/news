import {
  createClient,
  type GenericCtx,
  type AuthFunctions,
} from "@convex-dev/better-auth";
import { convex } from "@convex-dev/better-auth/plugins";
import { expo } from "@better-auth/expo";
import { components, internal } from "./_generated/api";
import { DataModel } from "./_generated/dataModel";
import { query } from "./_generated/server";
import { betterAuth } from "better-auth/minimal";
import { v } from "convex/values";
import authConfig from "./auth.config";
import { crossDomain } from "@convex-dev/better-auth/plugins";

const siteUrl = process.env.SITE_URL!;
const nativeAppUrl = process.env.NATIVE_APP_URL || "mybettertapp://";

const authFunctions: AuthFunctions = internal.auth;

export const authComponent = createClient<DataModel>(components.betterAuth, {
  authFunctions,
  triggers: {
    user: {
      onCreate: async (ctx, authUser) => {
        await ctx.db.insert("users", {
          authUserId: authUser._id,
          email: authUser.email,
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
      },

      onUpdate: async (ctx, newAuthUser, oldAuthUser) => {
        if (newAuthUser.email !== oldAuthUser.email) {
          const appUser = await ctx.db
            .query("users")
            .withIndex("by_auth_user_id", (q) =>
              q.eq("authUserId", newAuthUser._id)
            )
            .unique();

          if (appUser) {
            await ctx.db.patch(appUser._id, {
              email: newAuthUser.email,
            });
          }
        }
      },

      onDelete: async (ctx, authUser) => {
        const appUser = await ctx.db
          .query("users")
          .withIndex("by_auth_user_id", (q) => q.eq("authUserId", authUser._id))
          .unique();

        if (appUser) {
          // todo: check if i want soft delete (+ manage related data - insights, etc)
          await ctx.db.delete(appUser._id);
        }
      },
    },
  },
});

export const { onCreate, onUpdate, onDelete } = authComponent.triggersApi();

function createAuth(ctx: GenericCtx<DataModel>) {
  return betterAuth({
    baseURL: siteUrl,
    trustedOrigins: [siteUrl, nativeAppUrl],
    database: authComponent.adapter(ctx),
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: false,
    },
    socialProviders: {
      google: {
        clientId: process.env.GOOGLE_CLIENT_ID!,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      },
    },
    plugins: [
      expo(),
      convex({
        authConfig,
        jwksRotateOnTokenGenerationError: true,
      }),
      crossDomain({ siteUrl }),
    ],
  });
}

export { createAuth };

export const getCurrentUser = query({
  args: {},
  returns: v.any(),
  handler: async function (ctx, args) {
    return authComponent.getAuthUser(ctx);
  },
});
