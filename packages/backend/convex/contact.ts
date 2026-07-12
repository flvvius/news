/**
 * General contact form (the /contact page). Anyone can send a message
 * (rate-limited, no auth); it is persisted for the admin dashboard and the
 * admins are emailed on arrival so it is actioned promptly.
 */

import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { requireAdminUser } from "./lib/betaAccess";
import { enforceRateLimit } from "./lib/rateLimit";

const MAX_FIELD_CHARS = 200;
const MAX_MESSAGE_CHARS = 4000;

// Deliberately liberal: enough to reject obvious non-addresses without
// bouncing valid ones (real validation is the reply landing or not).
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Public: send a contact message (no auth, rate-limited). */
export const submitContactMessage = mutation({
  args: {
    name: v.string(),
    email: v.string(),
    subject: v.string(),
    message: v.string(),
  },
  handler: async (ctx, args) => {
    const name = args.name.trim();
    const email = args.email.trim();
    const subject = args.subject.trim();
    const message = args.message.trim();

    if (name.length < 2) {
      throw new ConvexError("Numele este prea scurt.");
    }
    if (!EMAIL_RE.test(email)) {
      throw new ConvexError("Adresa de e-mail nu pare validă.");
    }
    if (message.length < 10) {
      throw new ConvexError("Mesajul este prea scurt.");
    }

    // Per-sender and global caps so the form can't be used to spam the inbox.
    await enforceRateLimit(ctx, {
      key: `contactMessage:${email.toLowerCase()}`,
      limit: 5,
      windowMs: 60 * 60 * 1000,
    });
    await enforceRateLimit(ctx, {
      key: "contactMessage:all",
      limit: 60,
      windowMs: 60 * 60 * 1000,
    });

    const trimmedSubject = subject.slice(0, MAX_FIELD_CHARS) || "(fără subiect)";
    const trimmedMessage = message.slice(0, MAX_MESSAGE_CHARS);

    const messageId = await ctx.db.insert("contactMessages", {
      name: name.slice(0, MAX_FIELD_CHARS),
      email: email.slice(0, MAX_FIELD_CHARS),
      subject: trimmedSubject,
      message: trimmedMessage,
      status: "new",
      createdAt: Date.now(),
    });

    // Email the operators so a message reaches a human promptly rather than
    // only when someone opens /admin/contact. Best-effort scheduled action;
    // the message is already persisted above.
    await ctx.scheduler.runAfter(0, internal.emails.sendContactMessageEmail, {
      messageId,
      name: name.slice(0, MAX_FIELD_CHARS),
      email: email.slice(0, MAX_FIELD_CHARS),
      subject: trimmedSubject,
      message: trimmedMessage,
    });

    return { received: true as const, messageId };
  },
});

/** Admin: list contact messages, newest first (defaults to unhandled). */
export const listContactMessagesForAdmin = query({
  args: {
    status: v.optional(v.union(v.literal("new"), v.literal("handled"))),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireAdminUser(ctx);
    const safeLimit = Math.min(Math.max(Math.floor(args.limit ?? 50), 1), 200);
    return await ctx.db
      .query("contactMessages")
      .withIndex("by_status_createdAt", (q) =>
        q.eq("status", args.status ?? "new"),
      )
      .order("desc")
      .take(safeLimit);
  },
});

/** Admin: mark a message as handled so it drops out of the queue. */
export const markContactMessageHandled = mutation({
  args: { messageId: v.id("contactMessages") },
  handler: async (ctx, { messageId }) => {
    const admin = await requireAdminUser(ctx);
    const message = await ctx.db.get(messageId);
    if (!message) {
      throw new ConvexError("Mesaj inexistent");
    }
    if (message.status === "handled") {
      return { updated: false as const };
    }
    await ctx.db.patch(messageId, {
      status: "handled",
      handledAt: Date.now(),
      handledByEmail:
        (admin as { email?: string } | null | undefined)?.email ?? undefined,
    });
    return { updated: true as const };
  },
});
