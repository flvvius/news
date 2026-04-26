import {
  createClient,
  type GenericCtx,
  type AuthFunctions,
} from "@convex-dev/better-auth";
import { convex } from "@convex-dev/better-auth/plugins";
import { expo } from "@better-auth/expo";
import { components, internal } from "./_generated/api";
import type { DataModel } from "./_generated/dataModel";
import { betterAuth } from "better-auth/minimal";
import authConfig from "./auth.config";
import { crossDomain } from "@convex-dev/better-auth/plugins";
import { getWaitlistRecordByEmail, normalizeEmail } from "./lib/betaAccess";

const siteUrl = process.env.SITE_URL!;
const nativeAppUrl = process.env.NATIVE_APP_URL || "news-app://";

const authFunctions: AuthFunctions = internal.auth;

export const authComponent = createClient<DataModel>(components.betterAuth, {
  authFunctions,
  triggers: {
    user: {
      onCreate: async (ctx, authUser) => {
        const normalizedEmail = normalizeEmail(authUser.email);
        const userId = await ctx.db.insert("users", {
          authUserId: authUser._id,
          email: normalizedEmail,
          profile: {
            name: authUser.name ?? undefined,
            avatar: authUser.image ?? undefined,
          },
        });

        // Initialize stats in the separate userStats table
        await ctx.db.insert("userStats", {
          userId,
          currentStreak: 0,
          longestStreak: 0,
          articlesRead: 0,
          biasBalance: 0,
        });

        const waitlistRecord = await getWaitlistRecordByEmail(
          ctx,
          normalizedEmail,
        );

        if (waitlistRecord && waitlistRecord.status === "invited") {
          await ctx.db.patch(waitlistRecord._id, {
            status: "converted",
            convertedAt: Date.now(),
          });
        }
      },

      onUpdate: async (ctx, newAuthUser, oldAuthUser) => {
        if (newAuthUser.email !== oldAuthUser.email) {
          const normalizedEmail = normalizeEmail(newAuthUser.email);
          const appUser = await ctx.db
            .query("users")
            .withIndex("by_auth_user_id", (q) =>
              q.eq("authUserId", newAuthUser._id),
            )
            .unique();

          if (appUser) {
            await ctx.db.patch(appUser._id, {
              email: normalizedEmail,
            });
          }

          const waitlistRecord = await getWaitlistRecordByEmail(
            ctx,
            normalizedEmail,
          );

          if (waitlistRecord && waitlistRecord.status === "invited") {
            await ctx.db.patch(waitlistRecord._id, {
              status: "converted",
              convertedAt: Date.now(),
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
          // Clean up related userStats so no orphaned rows remain
          const stats = await ctx.db
            .query("userStats")
            .withIndex("by_user", (q) => q.eq("userId", appUser._id))
            .unique();
          if (stats) {
            await ctx.db.delete(stats._id);
          }

          // Clean up related userPrivateContext
          const privateCtx = await ctx.db
            .query("userPrivateContext")
            .withIndex("by_user", (q) => q.eq("userId", appUser._id))
            .unique();
          if (privateCtx) {
            await ctx.db.delete(privateCtx._id);
          }

          // todo: check if i want soft delete (+ manage related data - insights, interactions, etc)
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
    session: {
      expiresIn: 60 * 60 * 24 * 7, // 7 days
      updateAge: 60 * 60 * 24, // refresh session token once per day
      cookieCache: {
        enabled: true,
        maxAge: 7 * 60, // cache session in signed cookie for 7 min — skips DB on repeated get-session calls
      },
    },
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
