import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
  internalAction,
  internalMutation,
  internalQuery,
} from "./_generated/server";

/**
 * Morning briefing (Ticket 19). Builds on `sendPushToUser`: for each user with
 * followed topics + a push token, picks one recent story in a followed topic
 * they haven't been sent before, and pushes it. Deduped via `briefingSends` so
 * a story is never sent to the same user twice; send-failure token pruning lives
 * in `sendPushToUser`.
 *
 * Gated behind BRIEFING_ENABLED so it stays dormant until push infra is
 * configured — this is the cron T6's primer waits on before it may prompt.
 * Send time is the cron's fixed UTC hour (a basic "send-time + quiet hours"
 * floor); per-user timezone windows are a follow-up.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_CANDIDATE_USERS = 500;
const MAX_EVENTS_PER_TOPIC = 25;

/** Users who can receive a briefing: have ≥1 push token and ≥1 followed topic. */
export const getBriefingCandidates = internalQuery({
  args: {},
  handler: async (ctx) => {
    const tokens = await ctx.db.query("pushTokens").take(5000);
    const userIds = [...new Set(tokens.map((t) => String(t.userId)))];

    const candidates: Array<{
      userId: Id<"users">;
      followedTopicIds: Id<"topics">[];
    }> = [];
    for (const idStr of userIds) {
      if (candidates.length >= MAX_CANDIDATE_USERS) break;
      const user = await ctx.db.get(idStr as Id<"users">);
      const followed = user?.followedTopicIds ?? [];
      if (followed.length > 0) {
        candidates.push({ userId: user!._id, followedTopicIds: followed });
      }
    }
    return candidates;
  },
});

/**
 * Pick the most recent published event (last 24h) in one of the user's followed
 * topics that hasn't already been sent to them. Returns null when there's
 * nothing fresh to send.
 */
export const pickBriefingEventForUser = internalQuery({
  args: {
    userId: v.id("users"),
    followedTopicIds: v.array(v.id("topics")),
  },
  handler: async (ctx, args) => {
    const since = Date.now() - DAY_MS;
    let best: { eventId: Id<"events">; title: string; at: number } | null =
      null;

    for (const topicId of args.followedTopicIds) {
      const links = await ctx.db
        .query("eventTopics")
        .withIndex("by_topic", (q) => q.eq("topicId", topicId))
        .take(MAX_EVENTS_PER_TOPIC);

      for (const link of links) {
        const event = await ctx.db.get(link.eventId);
        if (!event || event.status !== "published") continue;
        if (event.firstPublishedAt < since) continue;

        // Skip stories already sent to this user.
        const already = await ctx.db
          .query("briefingSends")
          .withIndex("by_user_event", (q) =>
            q.eq("userId", args.userId).eq("eventId", event._id),
          )
          .first();
        if (already) continue;

        if (!best || event.firstPublishedAt > best.at) {
          best = {
            eventId: event._id,
            title: event.title,
            at: event.firstPublishedAt,
          };
        }
      }
    }

    return best ? { eventId: best.eventId, title: best.title } : null;
  },
});

export const recordBriefingSend = internalMutation({
  args: { userId: v.id("users"), eventId: v.id("events") },
  handler: async (ctx, { userId, eventId }) => {
    // Guard against a double-record race; the query already de-dupes.
    const existing = await ctx.db
      .query("briefingSends")
      .withIndex("by_user_event", (q) =>
        q.eq("userId", userId).eq("eventId", eventId),
      )
      .first();
    if (!existing) {
      await ctx.db.insert("briefingSends", {
        userId,
        eventId,
        sentAt: Date.now(),
      });
    }
  },
});

export const sendMorningBriefings = internalAction({
  args: {},
  handler: async (ctx): Promise<{ skipped?: boolean; sent: number }> => {
    if (process.env.BRIEFING_ENABLED?.trim() !== "true") {
      // Dormant until push infra is configured (Ticket 6 depends on this).
      return { skipped: true, sent: 0 };
    }

    const candidates = await ctx.runQuery(
      internal.briefing.getBriefingCandidates,
      {},
    );

    let sent = 0;
    for (const candidate of candidates) {
      const pick = await ctx.runQuery(
        internal.briefing.pickBriefingEventForUser,
        {
          userId: candidate.userId,
          followedTopicIds: candidate.followedTopicIds,
        },
      );
      if (!pick) continue;

      const result = await ctx.runAction(internal.notifications.sendPushToUser, {
        userId: candidate.userId,
        title: "Your morning briefing",
        body: pick.title,
        data: { type: "briefing", eventId: pick.eventId },
      });
      // Record the send regardless of delivery count so we don't re-pick the
      // same story next run for a user whose tokens were just pruned.
      await ctx.runMutation(internal.briefing.recordBriefingSend, {
        userId: candidate.userId,
        eventId: pick.eventId,
      });
      sent += result.sent;
    }

    return { sent };
  },
});
