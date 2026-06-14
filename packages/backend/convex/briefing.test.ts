import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";

import schema from "./schema";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

const modules = (
  import.meta as unknown as {
    glob: (pattern: string) => Record<string, () => Promise<unknown>>;
  }
).glob("./**/!(*.*.*)*.*s");

type ConvexT = ReturnType<typeof convexTest>;

async function seed(t: ConvexT) {
  return await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", {
      authUserId: "auth-briefing",
      email: "b@test",
      profile: {},
    });
    const topicId = await ctx.db.insert("topics", {
      slug: "world",
      displayName: "World",
    });
    const eventId = await ctx.db.insert("events", {
      title: "Big story",
      slug: "big-story",
      status: "published",
      firstPublishedAt: Date.now(), // recent
    });
    await ctx.db.insert("eventTopics", { eventId, topicId });
    return { userId, topicId, eventId };
  });
}

describe("morning briefing selection + dedupe (Ticket 19)", () => {
  test("picks a fresh followed-topic story, then de-dupes after send", async () => {
    const t = convexTest(schema, modules);
    const { userId, topicId, eventId } = await seed(t);

    const first = await t.query(internal.briefing.pickBriefingEventForUser, {
      userId,
      followedTopicIds: [topicId],
    });
    expect(first?.eventId).toBe(eventId);

    // Record the send, then the same story must not be picked again.
    await t.mutation(internal.briefing.recordBriefingSend, {
      userId,
      eventId,
    });

    const second = await t.query(internal.briefing.pickBriefingEventForUser, {
      userId,
      followedTopicIds: [topicId],
    });
    expect(second).toBeNull();
  });

  test("ignores stale (older than 24h) events", async () => {
    const t = convexTest(schema, modules);
    const { userId, topicId } = await seed(t);
    // Add a stale event in the same topic.
    await t.run(async (ctx) => {
      const stale = await ctx.db.insert("events", {
        title: "Old",
        slug: "old",
        status: "published",
        firstPublishedAt: Date.now() - 3 * 24 * 60 * 60 * 1000,
      });
      await ctx.db.insert("eventTopics", { eventId: stale, topicId });
    });

    // The fresh story (from seed) is still the only valid pick.
    const pick = await t.query(internal.briefing.pickBriefingEventForUser, {
      userId,
      followedTopicIds: [topicId],
    });
    expect(pick?.title).toBe("Big story");
  });

  test("sendMorningBriefings no-ops when BRIEFING_ENABLED is unset", async () => {
    const t = convexTest(schema, modules);
    const result = await t.action(internal.briefing.sendMorningBriefings, {});
    expect(result).toEqual({ skipped: true, sent: 0 });
  });
});
