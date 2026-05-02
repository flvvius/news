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
import { normalizeEmail } from "./lib/betaAccess";
import { Resend } from "resend";

const siteUrl = process.env.SITE_URL!;
const nativeAppUrl = process.env.NATIVE_APP_URL || "news-app://";
const resend = process.env.RESEND_API_KEY
  ? new Resend(process.env.RESEND_API_KEY)
  : null;
const defaultFromAddress =
  process.env.EMAIL_FROM_ADDRESS || "Biviant <onboarding@resend.dev>";
const defaultReplyTo = process.env.EMAIL_REPLY_TO || "hello@biviant.com";
const shouldLogVerificationLinks =
  siteUrl.includes("localhost") || siteUrl.includes("127.0.0.1");
const RESEND_TEST_MODE_ERROR =
  "You can only send testing emails to your own email address";

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

async function sendVerificationEmail(
  user: { email: string; name?: string | null },
  url: string,
) {
  if (shouldLogVerificationLinks) {
    console.info(`[auth] Verification link for ${user.email}: ${url}`);
  }

  if (!resend) {
    throw new Error(
      "Email verification is unavailable because RESEND_API_KEY is not configured.",
    );
  }

  const firstName = user.name?.split(" ")[0] || "there";
  const subject = "Verify your Biviant email";
  const html = `<!DOCTYPE html>
<html lang="en">
  <body style="margin:0;padding:24px;background:#f5f5f4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#1c1917;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
      <tr>
        <td align="center">
          <table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;background:#ffffff;border:1px solid #e7e5e4;border-radius:16px;">
            <tr>
              <td style="padding:32px 32px 16px 32px;">
                <p style="margin:0 0 8px 0;font-size:14px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#2563eb;">Biviant</p>
                <h1 style="margin:0;font-size:28px;line-height:1.2;color:#0f172a;">Verify your email</h1>
              </td>
            </tr>
            <tr>
              <td style="padding:0 32px 24px 32px;font-size:16px;line-height:1.7;color:#334155;">
                <p style="margin:0 0 16px 0;">Hi ${firstName},</p>
                <p style="margin:0 0 24px 0;">Confirm your email address to finish creating your Biviant account and unlock bookmarks, personalized ranking, and alerts.</p>
                <p style="margin:0 0 24px 0;">
                  <a href="${url}" style="display:inline-block;background:#2563eb;color:#ffffff;text-decoration:none;padding:14px 22px;border-radius:999px;font-weight:600;">Verify email</a>
                </p>
                <p style="margin:0;color:#64748b;">If you didn&apos;t create this account, you can safely ignore this email.</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
  const text = `Hi ${firstName},

Verify your email to finish creating your Biviant account:
${url}

If you didn't create this account, you can safely ignore this email.`;

  try {
    const { error } = await resend.emails.send({
      from: defaultFromAddress,
      replyTo: defaultReplyTo,
      to: [user.email],
      subject,
      html,
      text,
    });

    if (error) {
      const resendMessage =
        typeof error.message === "string" ? error.message : "";
      if (
        shouldLogVerificationLinks &&
        resendMessage.includes(RESEND_TEST_MODE_ERROR)
      ) {
        console.warn(
          `[auth] Resend test-mode restriction hit for ${user.email}; using logged verification link instead.`,
        );
        return;
      }

      console.error(
        `[auth] Resend rejected verification email to ${user.email}:`,
        error,
      );
      throw new Error(error.message || "Email delivery failed.");
    }
  } catch (error) {
    console.error(
      `[auth] Failed to send verification email to ${user.email}:`,
      error,
    );
    throw new Error(
      "We couldn't send your verification email. Please try again in a moment.",
    );
  }
}

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
        maxAge: 10 * 60, // cache session in signed cookie for 10 min — skips DB on repeated get-session calls
      },
    },
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
    },
    emailVerification: {
      sendOnSignIn: true,
      sendOnSignUp: true,
      autoSignInAfterVerification: false,
      sendVerificationEmail: async ({ user, url }) => {
        await sendVerificationEmail(user, url);
      },
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
