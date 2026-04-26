import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import type { ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);

// Hardcoded fallbacks — overridden at runtime via the config table
const DEFAULT_UNSUB_BASE = "https://biviant.com/unsubscribe";
const DEFAULT_PHYSICAL_ADDRESS = "Biviant, Bucharest, Romania";
const DEFAULT_FROM_ADDRESS = "Biviant <hello@biviant.com>";
const DEFAULT_REPLY_TO = "hello@biviant.com";
const DEFAULT_SITE_URL = "https://biviant.com";

/** Shape returned by getEmailConfig — keeps template function signatures clean. */
interface EmailConfig {
  fromAddress: string;
  replyTo: string;
  unsubBase: string;
  physicalAddress: string;
}

/** Check that a value is a non-empty string after trimming. */
function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

/** Fetch all email-related config in one round-trip. */
async function getEmailConfig(ctx: ActionCtx): Promise<EmailConfig> {
  const cfg = await ctx.runQuery(internal.config.getBatch, {
    keys: [
      "email_from_address",
      "email_reply_to",
      "email_physical_address",
      "unsubscribe_base_url",
    ],
  });
  return {
    fromAddress: isNonEmptyString(cfg.email_from_address)
      ? cfg.email_from_address
      : DEFAULT_FROM_ADDRESS,
    replyTo: isNonEmptyString(cfg.email_reply_to)
      ? cfg.email_reply_to
      : DEFAULT_REPLY_TO,
    unsubBase: isNonEmptyString(cfg.unsubscribe_base_url)
      ? cfg.unsubscribe_base_url
      : DEFAULT_UNSUB_BASE,
    physicalAddress: isNonEmptyString(cfg.email_physical_address)
      ? cfg.email_physical_address
      : DEFAULT_PHYSICAL_ADDRESS,
  };
}

function resolveSiteUrl(): string {
  const siteUrl = process.env.SITE_URL?.trim();
  return siteUrl && siteUrl.length > 0 ? siteUrl : DEFAULT_SITE_URL;
}

/**
 * Send welcome email to new waitlist signups
 */
export const sendWelcomeEmail = internalAction({
  args: {
    email: v.string(),
    name: v.optional(v.string()),
    position: v.number(),
    waitlistId: v.id("waitlist"),
  },
  handler: async (ctx, args) => {
    try {
      const emailCfg = await getEmailConfig(ctx);
      const firstName = args.name?.split(" ")[0] || "there";
      const unsubUrl = `${emailCfg.unsubBase}?email=${encodeURIComponent(args.email)}`;

      const { data, error } = await resend.emails.send({
        from: emailCfg.fromAddress,
        replyTo: emailCfg.replyTo,
        to: [args.email],
        subject: `You're #${args.position} on the Biviant waitlist`,
        headers: {
          "List-Unsubscribe": `<${unsubUrl}>`,
          "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
          "X-Entity-Ref-ID": `welcome-${args.position}-${Date.now()}`,
        },
        html: getWelcomeEmailHTML(
          firstName,
          args.position,
          args.email,
          emailCfg,
        ),
        text: getWelcomeEmailText(
          firstName,
          args.position,
          args.email,
          emailCfg,
        ),
      });

      if (error) {
        console.error("Resend error:", error);
        throw new Error(`Failed to send email: ${error.message}`);
      }

      // Only mark lastEmailSentAt after a confirmed successful send
      await ctx.runMutation(internal.waitlist.markEmailSent, {
        waitlistId: args.waitlistId,
      });

      console.log("Welcome email sent:", data);
      return { success: true, emailId: data?.id };
    } catch (error) {
      console.error("Error sending welcome email:", error);
      throw error;
    }
  },
});

/**
 * Send invite email with access code
 */
export const sendInviteEmail = internalAction({
  args: {
    waitlistId: v.id("waitlist"),
    email: v.string(),
    name: v.optional(v.string()),
    inviteCode: v.string(),
  },
  handler: async (ctx, args) => {
    try {
      const emailCfg = await getEmailConfig(ctx);
      const firstName = args.name?.split(" ")[0] || "there";
      const siteUrl = resolveSiteUrl();
      const inviteUrl = `${siteUrl}/dashboard?mode=signup&code=${encodeURIComponent(args.inviteCode)}`;
      const unsubUrl = `${emailCfg.unsubBase}?email=${encodeURIComponent(args.email)}`;

      const { data, error } = await resend.emails.send({
        from: emailCfg.fromAddress,
        replyTo: emailCfg.replyTo,
        to: [args.email],
        subject: "Your Biviant early access is ready",
        headers: {
          "List-Unsubscribe": `<${unsubUrl}>`,
          "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
          "X-Entity-Ref-ID": `invite-${args.inviteCode}-${Date.now()}`,
        },
        html: getInviteEmailHTML(
          firstName,
          inviteUrl,
          args.email,
          emailCfg,
          siteUrl,
        ),
        text: getInviteEmailText(firstName, inviteUrl, args.email, emailCfg),
      });

      if (error) {
        console.error("Resend error:", error);
        throw new Error(`Failed to send email: ${error.message}`);
      }

      await ctx.runMutation(internal.waitlist.markEmailSent, {
        waitlistId: args.waitlistId,
      });

      console.log("Invite email sent:", data);
      return { success: true, emailId: data?.id };
    } catch (error) {
      console.error("Error sending invite email:", error);
      throw error;
    }
  },
});

// ==================== EMAIL TEMPLATES ====================

function getWelcomeEmailHTML(
  firstName: string,
  position: number,
  email: string,
  cfg: EmailConfig,
): string {
  const unsubUrl = `${cfg.unsubBase}?email=${encodeURIComponent(email)}`;

  return `<!DOCTYPE html>
<html lang="en" xmlns="https://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
  <meta charset="utf-8">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Welcome to Biviant</title>
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
  <!-- Preview text -->
  <div style="display:none; max-height:0; overflow:hidden;">
    You're #${position} in line. Here's what happens next...
  </div>

  <!-- Outer wrapper -->
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f4f4f5;">
    <tr>
      <td align="center" style="padding:40px 20px;">

        <!-- Main container -->
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="background-color:#ffffff; border-radius:8px; border:1px solid #e5e7eb; max-width:600px;">

          <!-- Header -->
          <tr>
            <td align="center" style="padding:40px 40px 20px 40px;">
              <span style="font-size:28px; font-weight:bold; color:#2563eb;">Biviant</span>
              <br><br>
              <span style="font-size:22px; font-weight:bold; color:#111827;">Welcome to the Waitlist</span>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:0 40px 20px 40px; font-size:16px; line-height:1.6; color:#374151;">
              <p style="margin:0 0 16px 0;">Hi ${firstName},</p>
              <p style="margin:0 0 24px 0;">Thanks for joining Biviant. You're officially on the waitlist.</p>
            </td>
          </tr>

          <!-- Position badge -->
          <tr>
            <td align="center" style="padding:0 40px 24px 40px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td align="center" style="background-color:#6366f1; color:#ffffff; padding:14px 32px; border-radius:50px; font-size:22px; font-weight:bold;">
                    You're #${position} in line
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- What happens next -->
          <tr>
            <td style="padding:0 40px 12px 40px;">
              <span style="font-size:18px; font-weight:bold; color:#111827;">What happens next</span>
            </td>
          </tr>
          <tr>
            <td style="padding:0 40px 24px 40px; font-size:16px; line-height:1.6; color:#374151;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="padding:8px 0; vertical-align:top; width:24px; color:#6366f1; font-weight:bold;">1.</td>
                  <td style="padding:8px 0;"><strong>We're building</strong> &mdash; Our AI is learning to scan news from across the political spectrum and cluster stories intelligently.</td>
                </tr>
                <tr>
                  <td style="padding:8px 0; vertical-align:top; width:24px; color:#6366f1; font-weight:bold;">2.</td>
                  <td style="padding:8px 0;"><strong>You'll get updates</strong> &mdash; We'll keep you posted on our progress every few weeks.</td>
                </tr>
                <tr>
                  <td style="padding:8px 0; vertical-align:top; width:24px; color:#6366f1; font-weight:bold;">3.</td>
                  <td style="padding:8px 0;"><strong>Early access</strong> &mdash; When we're ready to launch, you'll be among the first to get an invite.</td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Referral section -->
          <tr>
            <td style="padding:0 40px 12px 40px;">
              <span style="font-size:18px; font-weight:bold; color:#111827;">Move up the list</span>
            </td>
          </tr>
          <tr>
            <td style="padding:0 40px 24px 40px; font-size:16px; line-height:1.6; color:#374151;">
              <p style="margin:0 0 16px 0;">Share Biviant with friends who are tired of their news bubble. The more people who join from your referral, the higher you climb.</p>
            </td>
          </tr>

          <!-- CTA button -->
          <tr>
            <td align="center" style="padding:0 40px 40px 40px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td align="center" style="background-color:#2563eb; border-radius:6px;">
                    <a href="https://biviant.com?ref=${position}" target="_blank" style="display:inline-block; padding:14px 28px; font-size:16px; font-weight:600; color:#ffffff; text-decoration:none;">Share with Friends</a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:24px 40px; border-top:1px solid #e5e7eb;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td align="center" style="font-size:14px; line-height:1.6; color:#6b7280;">
                    <p style="margin:0 0 8px 0;">See every side of the story.</p>
                    <p style="margin:0 0 8px 0;">
                      <a href="https://biviant.com" style="color:#2563eb; text-decoration:underline;">biviant.com</a>
                    </p>
                    <p style="margin:0 0 8px 0; font-size:12px;">${cfg.physicalAddress}</p>
                    <p style="margin:0; font-size:12px;">
                      <a href="${unsubUrl}" style="color:#6b7280; text-decoration:underline;">Unsubscribe</a>
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

function getWelcomeEmailText(
  firstName: string,
  position: number,
  email: string,
  cfg: EmailConfig,
): string {
  const unsubUrl = `${cfg.unsubBase}?email=${encodeURIComponent(email)}`;

  return `Hi ${firstName},

Thanks for joining Biviant. You're officially on the waitlist.

You're #${position} in line.

What happens next:

1. We're building - Our AI is learning to scan news from across the political spectrum and cluster stories intelligently.
2. You'll get updates - We'll keep you posted on our progress every few weeks.
3. Early access - When we're ready to launch, you'll be among the first to get an invite.

Move up the list:
Share Biviant with friends who are tired of their news bubble: https://biviant.com?ref=${position}

---
See every side of the story.
${cfg.physicalAddress}

Unsubscribe: ${unsubUrl}`;
}

function getInviteEmailHTML(
  firstName: string,
  inviteUrl: string,
  email: string,
  cfg: EmailConfig,
  siteUrl: string,
): string {
  const unsubUrl = `${cfg.unsubBase}?email=${encodeURIComponent(email)}`;

  return `<!DOCTYPE html>
<html lang="en" xmlns="https://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
  <meta charset="utf-8">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Your Biviant Invite</title>
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
  <!-- Preview text -->
  <div style="display:none; max-height:0; overflow:hidden;">
    Your early access to Biviant is ready. See news from every perspective.
  </div>

  <!-- Outer wrapper -->
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f4f4f5;">
    <tr>
      <td align="center" style="padding:40px 20px;">

        <!-- Main container -->
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="background-color:#ffffff; border-radius:8px; border:1px solid #e5e7eb; max-width:600px;">

          <!-- Header -->
          <tr>
            <td align="center" style="padding:40px 40px 20px 40px;">
              <span style="font-size:28px; font-weight:bold; color:#2563eb;">Biviant</span>
              <br><br>
              <span style="font-size:22px; font-weight:bold; color:#111827;">Your Early Access is Ready</span>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:0 40px 20px 40px; font-size:16px; line-height:1.6; color:#374151;">
              <p style="margin:0 0 16px 0;">Hi ${firstName},</p>
              <p style="margin:0 0 24px 0;">The wait is over. You now have early access to Biviant.</p>
              <p style="margin:0 0 16px 0;">Create your account using <strong>${email}</strong> to unlock the beta.</p>
            </td>
          </tr>

          <!-- Features -->
          <tr>
            <td style="padding:0 40px 12px 40px;">
              <span style="font-size:18px; font-weight:bold; color:#111827;">What you can do now</span>
            </td>
          </tr>
          <tr>
            <td style="padding:0 40px 24px 40px; font-size:16px; line-height:1.6; color:#374151;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="padding:6px 0; vertical-align:top; width:20px;">&#8226;</td>
                  <td style="padding:6px 0;">Browse today's events from multiple perspectives</td>
                </tr>
                <tr>
                  <td style="padding:6px 0; vertical-align:top; width:20px;">&#8226;</td>
                  <td style="padding:6px 0;">Read the same story as told by left, center, and right sources</td>
                </tr>
                <tr>
                  <td style="padding:6px 0; vertical-align:top; width:20px;">&#8226;</td>
                  <td style="padding:6px 0;">Track your reading balance and break out of your bubble</td>
                </tr>
                <tr>
                  <td style="padding:6px 0; vertical-align:top; width:20px;">&#8226;</td>
                  <td style="padding:6px 0;">Get personalized insights on how stories affect you</td>
                </tr>
                <tr>
                  <td style="padding:6px 0; vertical-align:top; width:20px;">&#8226;</td>
                  <td style="padding:6px 0;">Your beta access is reserved for <strong>${email}</strong></td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- CTA button -->
          <tr>
            <td align="center" style="padding:0 40px 16px 40px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td align="center" style="background-color:#2563eb; border-radius:6px;">
                    <a href="${inviteUrl}" target="_blank" style="display:inline-block; padding:16px 36px; font-size:18px; font-weight:600; color:#ffffff; text-decoration:none;">Get Started</a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Expiry note -->
          <tr>
            <td align="center" style="padding:0 40px 40px 40px; font-size:13px; color:#9ca3af;">
              Use the same email address when you create your account.
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:24px 40px; border-top:1px solid #e5e7eb;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td align="center" style="font-size:14px; line-height:1.6; color:#6b7280;">
                    <p style="margin:0 0 8px 0;">See every side of the story.</p>
                    <p style="margin:0 0 8px 0;">
                      <a href="${siteUrl}" style="color:#2563eb; text-decoration:underline;">biviant.com</a>
                    </p>
                    <p style="margin:0 0 8px 0; font-size:12px;">${cfg.physicalAddress}</p>
                    <p style="margin:0; font-size:12px;">
                      <a href="${unsubUrl}" style="color:#6b7280; text-decoration:underline;">Unsubscribe</a>
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

function getInviteEmailText(
  firstName: string,
  inviteUrl: string,
  email: string,
  cfg: EmailConfig,
): string {
  const unsubUrl = `${cfg.unsubBase}?email=${encodeURIComponent(email)}`;

  return `Hi ${firstName},

The wait is over. You now have early access to Biviant.

Create your account using this email: ${email}

What you can do now:
- Browse today's events from multiple perspectives
- Read the same story as told by left, center, and right sources
- Track your reading balance and break out of your bubble
- Get personalized insights on how stories affect you
- Your beta access is reserved for ${email}

Get started: ${inviteUrl}

Use the same email address when you create your account.

---
See every side of the story.
${cfg.physicalAddress}

Unsubscribe: ${unsubUrl}`;
}
