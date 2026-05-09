import {
  createClient,
  type GenericCtx,
  type AuthFunctions,
} from "@convex-dev/better-auth";
import { convex } from "@convex-dev/better-auth/plugins";
import { expo } from "@better-auth/expo";
import { components, internal } from "./_generated/api";
import type { DataModel } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { betterAuth } from "better-auth/minimal";
import authConfig from "./auth.config";
import { getWaitlistRecordByEmail, normalizeEmail } from "./lib/betaAccess";
import { Resend } from "resend";

function requireEnv(name: string) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`[auth] Missing required env var: ${name}`);
  }
  return value;
}

function isProductionDeployment() {
  const nodeEnv = process.env.NODE_ENV?.trim().toLowerCase();
  if (nodeEnv === "production") {
    return true;
  }

  const convexDeployment = process.env.CONVEX_DEPLOYMENT?.trim().toLowerCase();
  return convexDeployment?.startsWith("prod:") ?? false;
}

const siteUrl = requireEnv("SITE_URL");
const googleClientId = requireEnv("GOOGLE_CLIENT_ID");
const googleClientSecret = requireEnv("GOOGLE_CLIENT_SECRET");
const nativeAppUrl = process.env.NATIVE_APP_URL || "news-app://";
const resendApiKey = process.env.RESEND_API_KEY?.trim() || null;
const resend = resendApiKey ? new Resend(resendApiKey) : null;
const isProduction = isProductionDeployment();
const emailFromAddress =
  process.env.EMAIL_FROM_ADDRESS?.trim() || "Biviant <hello@biviant.com>";
const emailReplyTo =
  process.env.EMAIL_REPLY_TO?.trim() || "hello@biviant.com";

const authFunctions: AuthFunctions = internal.auth;

function summarizeEmailForLogs(email: string) {
  const normalized = email.trim().toLowerCase();
  const atIndex = normalized.indexOf("@");
  if (atIndex <= 0 || atIndex === normalized.length - 1) {
    return "<redacted_email>";
  }
  return `***@${normalized.slice(atIndex + 1)}`;
}

function collectTrustedOrigins() {
  const configuredOrigins = new Set<string>([siteUrl]);
  const allowLocalhostOrigins =
    process.env.NODE_ENV !== "production" ||
    process.env.CONVEX_ALLOW_LOCALHOST === "true";

  if (allowLocalhostOrigins) {
    configuredOrigins.add("http://localhost:3001");
    configuredOrigins.add("http://127.0.0.1:3001");
  }

  if (process.env.CONVEX_SITE_URL?.trim()) {
    configuredOrigins.add(process.env.CONVEX_SITE_URL.trim());
  }

  for (const value of (process.env.ALLOWED_ORIGINS || "").split(",")) {
    const origin = value.trim();
    if (origin) {
      configuredOrigins.add(origin);
    }
  }

  return [...configuredOrigins, nativeAppUrl];
}

function normalizeAuthActionUrl(url: string) {
  return new URL(url, siteUrl).toString();
}

async function sendAuthEmail({
  to,
  subject,
  html,
  text,
  debugLabel,
  actionUrl,
}: {
  to: string;
  subject: string;
  html: string;
  text: string;
  debugLabel: string;
  actionUrl: string;
}) {
  if (!resend) {
    if (isProduction) {
      throw new Error(
        `[auth] ${debugLabel} email failed: RESEND_API_KEY missing in production.`,
      );
    }

    console.warn(
      `[auth] ${debugLabel} email not sent because RESEND_API_KEY is missing.`,
      {
        recipient: summarizeEmailForLogs(to),
        actionUrl: "<redacted_action_url>",
      },
    );
    return;
  }

  const { error } = await resend.emails.send({
    from: emailFromAddress,
    replyTo: emailReplyTo,
    to: [to],
    subject,
    html,
    text,
  });

  if (error) {
    throw new Error(error.message);
  }
}

async function convertWaitlistRecordForEmail(
  ctx: MutationCtx,
  email: string,
) {
  const waitlistRecord = await getWaitlistRecordByEmail(ctx, email);

  if (waitlistRecord && waitlistRecord.status === "invited") {
    await ctx.db.patch(waitlistRecord._id, {
      status: "converted",
      convertedAt: Date.now(),
    });
  }
}

function getResetPasswordEmailHTML(resetUrl: string) {
  return `<!DOCTYPE html>
<html lang="en" xmlns="https://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
  <meta charset="utf-8">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Reset your Biviant password</title>
  <!--[if mso]>
  <noscript>
    <xml>
      <o:OfficeDocumentSettings>
        <o:PixelsPerInch>96</o:PixelsPerInch>
      </o:OfficeDocumentSettings>
    </xml>
  </noscript>
  <![endif]-->
</head>
<body style="margin:0; padding:0; background-color:#f4f4f5; font-family:-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;">
  <div style="display:none; max-height:0; overflow:hidden;">
    Reset your Biviant password and get back to the full story.
  </div>

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f4f4f5;">
    <tr>
      <td align="center" style="padding:40px 20px;">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="background-color:#ffffff; border-radius:8px; border:1px solid #e5e7eb; max-width:600px;">
          <tr>
            <td align="center" style="padding:40px 40px 20px 40px;">
              <span style="font-size:28px; font-weight:bold; color:#2563eb;">Biviant</span>
              <br><br>
              <span style="font-size:22px; font-weight:bold; color:#111827;">Reset Your Password</span>
            </td>
          </tr>

          <tr>
            <td style="padding:0 40px 20px 40px; font-size:16px; line-height:1.6; color:#374151;">
              <p style="margin:0 0 16px 0;">We received a request to reset your Biviant password.</p>
              <p style="margin:0 0 24px 0;">Use the button below to choose a new password and get back into your account.</p>
            </td>
          </tr>

          <tr>
            <td align="center" style="padding:0 40px 28px 40px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td align="center" style="background-color:#2563eb; border-radius:6px;">
                    <a href="${resetUrl}" target="_blank" style="display:inline-block; padding:14px 28px; font-size:16px; font-weight:600; color:#ffffff; text-decoration:none;">Choose a New Password</a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <tr>
            <td style="padding:0 40px 16px 40px;">
              <span style="font-size:18px; font-weight:bold; color:#111827;">Security note</span>
            </td>
          </tr>

          <tr>
            <td style="padding:0 40px 32px 40px; font-size:16px; line-height:1.6; color:#374151;">
              <p style="margin:0 0 16px 0;">If you didn’t request this change, you can safely ignore this email and your current password will keep working until the link is used.</p>
              <p style="margin:0;">If the button doesn’t work, paste this link into your browser:</p>
              <p style="margin:12px 0 0 0; word-break:break-all;">
                <a href="${resetUrl}" target="_blank" style="color:#2563eb; text-decoration:underline;">${resetUrl}</a>
              </p>
            </td>
          </tr>

          <tr>
            <td style="padding:24px 40px; border-top:1px solid #e5e7eb;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td align="center" style="font-size:14px; line-height:1.6; color:#6b7280;">
                    <p style="margin:0 0 8px 0;">See every side of the story.</p>
                    <p style="margin:0;">
                      <a href="${siteUrl}" style="color:#2563eb; text-decoration:underline;">biviant.com</a>
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function getResetPasswordEmailText(resetUrl: string) {
  return `Reset your Biviant password

We received a request to reset your Biviant password.

Choose a new password here:
${resetUrl}

If you didn't request this change, you can ignore this email and your current password will keep working until the link is used.

See every side of the story.
${siteUrl}`;
}

function getVerificationEmailHTML(verificationUrl: string) {
  return `<!DOCTYPE html>
<html lang="en" xmlns="https://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
  <meta charset="utf-8">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Verify your Biviant email</title>
  <!--[if mso]>
  <noscript>
    <xml>
      <o:OfficeDocumentSettings>
        <o:PixelsPerInch>96</o:PixelsPerInch>
      </o:OfficeDocumentSettings>
    </xml>
  </noscript>
  <![endif]-->
</head>
<body style="margin:0; padding:0; background-color:#f4f4f5; font-family:-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;">
  <div style="display:none; max-height:0; overflow:hidden;">
    Verify your Biviant email to activate your account and unlock synced features.
  </div>

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f4f4f5;">
    <tr>
      <td align="center" style="padding:40px 20px;">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="background-color:#ffffff; border-radius:8px; border:1px solid #e5e7eb; max-width:600px;">
          <tr>
            <td align="center" style="padding:40px 40px 20px 40px;">
              <span style="font-size:28px; font-weight:bold; color:#2563eb;">Biviant</span>
              <br><br>
              <span style="font-size:22px; font-weight:bold; color:#111827;">Verify Your Email</span>
            </td>
          </tr>

          <tr>
            <td style="padding:0 40px 20px 40px; font-size:16px; line-height:1.6; color:#374151;">
              <p style="margin:0 0 16px 0;">Thanks for creating your Biviant account.</p>
              <p style="margin:0 0 24px 0;">Confirm your email address to activate your account and unlock bookmarks, personalized ranking, and future notifications.</p>
            </td>
          </tr>

          <tr>
            <td align="center" style="padding:0 40px 28px 40px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td align="center" style="background-color:#2563eb; border-radius:6px;">
                    <a href="${verificationUrl}" target="_blank" style="display:inline-block; padding:14px 28px; font-size:16px; font-weight:600; color:#ffffff; text-decoration:none;">Confirm Email Address</a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <tr>
            <td style="padding:0 40px 16px 40px;">
              <span style="font-size:18px; font-weight:bold; color:#111827;">Didn’t request this?</span>
            </td>
          </tr>

          <tr>
            <td style="padding:0 40px 32px 40px; font-size:16px; line-height:1.6; color:#374151;">
              <p style="margin:0 0 16px 0;">If you didn’t create a Biviant account, you can safely ignore this email.</p>
              <p style="margin:0;">If the button doesn’t work, paste this link into your browser:</p>
              <p style="margin:12px 0 0 0; word-break:break-all;">
                <a href="${verificationUrl}" target="_blank" style="color:#2563eb; text-decoration:underline;">${verificationUrl}</a>
              </p>
            </td>
          </tr>

          <tr>
            <td style="padding:24px 40px; border-top:1px solid #e5e7eb;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td align="center" style="font-size:14px; line-height:1.6; color:#6b7280;">
                    <p style="margin:0 0 8px 0;">See every side of the story.</p>
                    <p style="margin:0;">
                      <a href="${siteUrl}" style="color:#2563eb; text-decoration:underline;">biviant.com</a>
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function getVerificationEmailText(verificationUrl: string) {
  return `Verify your Biviant email

Thanks for creating your Biviant account.

Confirm your email address here:
${verificationUrl}

Once verified, you can sign in and unlock bookmarks, personalized ranking, and future notifications.

If you didn't create a Biviant account, you can ignore this email.

See every side of the story.
${siteUrl}`;
}

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

        if (authUser.emailVerified) {
          await convertWaitlistRecordForEmail(ctx, normalizedEmail);
        }
      },

      onUpdate: async (ctx, newAuthUser, oldAuthUser) => {
        const normalizedEmail = normalizeEmail(newAuthUser.email);
        const emailChanged = newAuthUser.email !== oldAuthUser.email;
        const justVerified =
          newAuthUser.emailVerified && !oldAuthUser.emailVerified;

        if (emailChanged || justVerified) {
          const appUser = await ctx.db
            .query("users")
            .withIndex("by_auth_user_id", (q) =>
              q.eq("authUserId", newAuthUser._id),
            )
            .unique();

          if (appUser && emailChanged) {
            await ctx.db.patch(appUser._id, {
              email: normalizedEmail,
            });
          }

          if (newAuthUser.emailVerified) {
            await convertWaitlistRecordForEmail(ctx, normalizedEmail);
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
    trustedOrigins: collectTrustedOrigins(),
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
      requireEmailVerification: true,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user, url }) => {
        const normalizedUrl = normalizeAuthActionUrl(url);
        await sendAuthEmail({
          to: user.email,
          subject: "Reset your Biviant password",
          actionUrl: normalizedUrl,
          html: getResetPasswordEmailHTML(normalizedUrl),
          text: getResetPasswordEmailText(normalizedUrl),
          debugLabel: "password reset",
        });
      },
    },
    emailVerification: {
      sendOnSignUp: true,
      autoSignInAfterVerification: false,
      sendVerificationEmail: async ({ user, url }) => {
        const normalizedUrl = normalizeAuthActionUrl(url);
        await sendAuthEmail({
          to: user.email,
          subject: "Verify your Biviant email",
          actionUrl: normalizedUrl,
          html: getVerificationEmailHTML(normalizedUrl),
          text: getVerificationEmailText(normalizedUrl),
          debugLabel: "verification",
        });
      },
    },
    socialProviders: {
      google: {
        clientId: googleClientId,
        clientSecret: googleClientSecret,
      },
    },
    plugins: [
      expo(),
      convex({
        authConfig,
        jwksRotateOnTokenGenerationError: true,
      }),
    ],
  });
}

export { createAuth };
