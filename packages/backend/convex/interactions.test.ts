import { convexTest, type TestConvex } from "convex-test";
import { describe, expect, test } from "vitest";

import { recordInteraction, replayGuestMerge } from "./interactions";
import schema from "./schema";
import type { Id } from "./_generated/dataModel";

// Documented convex-test glob: `!(*.*.*)` drops files with a second dot, which
// here also excludes `convex.config.ts` (so the Better Auth component is never
// instantiated — these tests exercise the merge core directly via `t.run`,
// never the auth gate), plus `*.test.ts` and `*.d.ts`. `import.meta.glob` is a
// Vite/vitest feature whose types aren't in the Convex tsconfig, so we type the
// access to match convex-test's `modules` parameter.
const modules = (
  import.meta as unknown as {
    glob: (pattern: string) => Record<string, () => Promise<unknown>>;
  }
).glob("./**/!(*.*.*)*.*s");

const DAY_MS = 24 * 60 * 60 * 1000;
const BIAS_CYCLE = [-5, -2, 0, 3, 5];

type ConvexT = TestConvex<typeof schema>;

type Read = {
  eventId: Id<"events">;
  timestamp: number;
  timeSpentSeconds?: number;
  scrollDepthPercentage?: number;
  biasRating?: number;
  sourceReliability?: number;
};

/** Mirror Better Auth's onCreate: a user row plus a zeroed stats row. */
async function seedUserWithStats(t: ConvexT, email: string) {
  return await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", {
      authUserId: `auth-${email}`,
      email,
      profile: {},
    });
    await ctx.db.insert("userStats", {
      userId,
      currentStreak: 0,
      longestStreak: 0,
      articlesRead: 0,
      biasBalance: 0,
    });
    return userId;
  });
}

async function seedEvents(t: ConvexT, count: number) {
  return await t.run(async (ctx) => {
    const ids: Id<"events">[] = [];
    for (let i = 0; i < count; i++) {
      ids.push(
        await ctx.db.insert("events", {
          title: `Event ${i}`,
          slug: `event-${i}`,
          status: "published",
          firstPublishedAt: 0,
        }),
      );
    }
    return ids;
  });
}

async function readStats(t: ConvexT, userId: Id<"users">) {
  const stats = await t.run(async (ctx) =>
    ctx.db
      .query("userStats")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique(),
  );
  if (!stats) throw new Error("expected userStats row");
  return {
    currentStreak: stats.currentStreak,
    longestStreak: stats.longestStreak,
    articlesRead: stats.articlesRead,
    biasBalance: stats.biasBalance,
    lastActiveAt: stats.lastActiveAt,
  };
}

async function countInteractions(t: ConvexT, userId: Id<"users">) {
  return await t.run(async (ctx) =>
    ctx.db
      .query("interactions")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect()
      .then((rows) => rows.length),
  );
}

/**
 * Replay reads one at a time through the live per-view path (`recordInteraction`
 * → `updateUserStatsForView`). This is the "day-by-day replay" the folded merge
 * must reproduce. Runs inside a single transaction, which is exactly the shape
 * the folded merge replaces.
 */
async function dayByDayReplay(
  t: ConvexT,
  userId: Id<"users">,
  reads: Read[],
) {
  const ascending = [...reads].sort((a, b) => a.timestamp - b.timestamp);
  await t.run(async (ctx) => {
    for (const read of ascending) {
      const context =
        read.biasRating !== undefined
          ? {
              biasRating: read.biasRating,
              sourceReliability: read.sourceReliability ?? 0,
            }
          : undefined;
      await recordInteraction(ctx, {
        userId,
        eventId: read.eventId,
        type: "view",
        context,
        metadata: {
          deviceType: "mobile",
          timeSpentSeconds: read.timeSpentSeconds,
          scrollDepthPercentage: read.scrollDepthPercentage,
        },
        timestamp: read.timestamp,
      });
    }
  });
}

/**
 * 1000 reads spread 50/day across 20 consecutive UTC days, cycling through a
 * pool of events (so the event-existence cache and repeated events are
 * exercised) and a spread of bias ratings (so bias compounding is non-trivial).
 * Returned newest-first to prove the merge sorts before replaying.
 */
function buildReads(events: Id<"events">[]): Read[] {
  const reads: Read[] = [];
  const baseDay = 20000; // arbitrary day index, keeps timestamps > 0
  let i = 0;
  for (let day = 0; day < 20; day++) {
    for (let n = 0; n < 50; n++) {
      reads.push({
        eventId: events[i % events.length],
        // distinct within-day offsets, all < DAY_MS so the day bucket is stable
        timestamp: (baseDay + day) * DAY_MS + n * 1000,
        timeSpentSeconds: 45,
        scrollDepthPercentage: 0.8,
        biasRating: BIAS_CYCLE[i % BIAS_CYCLE.length],
        sourceReliability: 0.5,
      });
      i++;
    }
  }
  return reads.reverse();
}

describe("replayGuestMerge (Ticket 1: memory-folded merge)", () => {
  test("folds a 1000-read queue in one call, matching a day-by-day replay", async () => {
    const t = convexTest(schema, modules);
    const events = await seedEvents(t, 37);
    const reads = buildReads(events);
    expect(reads).toHaveLength(1000);

    // Folded merge — a single mutation. If this blew the read/write/time
    // limits (the Ticket 1 bug) convex-test would reject here.
    const folder = await seedUserWithStats(t, "folder@test");
    const result = await t.run((ctx) =>
      replayGuestMerge(ctx, folder, {
        deviceId: "device-folder",
        reads,
        followedTopicIds: [],
      }),
    );

    expect(result.merged).toBe(true);
    expect(result.readsReplayed).toBe(1000);

    // Independent reference: the same reads applied one at a time.
    const replayer = await seedUserWithStats(t, "replayer@test");
    await dayByDayReplay(t, replayer, reads);

    const foldedStats = await readStats(t, folder);
    const replayStats = await readStats(t, replayer);

    // Folded result must equal the day-by-day replay, field for field.
    expect(foldedStats).toEqual(replayStats);

    // Concrete, formula-independent expectations: 20 consecutive active days,
    // every read counted, history rows persisted.
    expect(foldedStats.articlesRead).toBe(1000);
    expect(foldedStats.currentStreak).toBe(20);
    expect(foldedStats.longestStreak).toBe(20);
    expect(result.streakDays).toBe(20);
    expect(await countInteractions(t, folder)).toBe(1000);
  });

  test("is idempotent: a second merge for the same device writes nothing", async () => {
    const t = convexTest(schema, modules);
    const events = await seedEvents(t, 5);
    const user = await seedUserWithStats(t, "idem@test");
    const reads: Read[] = [
      {
        eventId: events[0],
        timestamp: 20000 * DAY_MS,
        biasRating: 2,
        timeSpentSeconds: 60,
      },
      {
        eventId: events[1],
        timestamp: 20001 * DAY_MS,
        biasRating: -3,
        timeSpentSeconds: 60,
      },
    ];

    const first = await t.run((ctx) =>
      replayGuestMerge(ctx, user, {
        deviceId: "device-idem",
        reads,
        followedTopicIds: [],
      }),
    );
    expect(first.merged).toBe(true);
    expect(first.readsReplayed).toBe(2);

    const statsAfterFirst = await readStats(t, user);
    const countAfterFirst = await countInteractions(t, user);
    expect(countAfterFirst).toBe(2);

    // Re-run with the same deviceId — must no-op via the guestMerges ledger.
    const second = await t.run((ctx) =>
      replayGuestMerge(ctx, user, {
        deviceId: "device-idem",
        reads,
        followedTopicIds: [],
      }),
    );

    expect(second.merged).toBe(false);
    expect(second).toMatchObject({
      reason: "already_merged",
      readsReplayed: 0,
      topicsReplayed: 0,
      streakDays: 0,
    });

    // Nothing changed: no duplicated history, no stats drift.
    expect(await countInteractions(t, user)).toBe(countAfterFirst);
    expect(await readStats(t, user)).toEqual(statsAfterFirst);
  });

  test("skips reads whose event no longer exists (never dangles)", async () => {
    const t = convexTest(schema, modules);
    const [liveEvent] = await seedEvents(t, 1);
    // Mint an event id then delete it, so the read references a gone event.
    const goneEvent = await t.run(async (ctx) => {
      const id = await ctx.db.insert("events", {
        title: "Gone",
        slug: "gone",
        status: "published",
        firstPublishedAt: 0,
      });
      await ctx.db.delete(id);
      return id;
    });

    const user = await seedUserWithStats(t, "dangle@test");
    const result = await t.run((ctx) =>
      replayGuestMerge(ctx, user, {
        deviceId: "device-dangle",
        reads: [
          {
            eventId: goneEvent,
            timestamp: 20000 * DAY_MS,
            biasRating: 1,
            timeSpentSeconds: 60,
          },
          {
            eventId: liveEvent,
            timestamp: 20000 * DAY_MS + 1000,
            biasRating: 1,
            timeSpentSeconds: 60,
          },
        ],
        followedTopicIds: [],
      }),
    );

    expect(result.merged).toBe(true);
    expect(result.readsReplayed).toBe(1);
    expect(await countInteractions(t, user)).toBe(1);
    expect((await readStats(t, user)).articlesRead).toBe(1);
  });
});
