// L11: retention crons — time-shifted fixtures prove each purge deletes only
// beyond-retention rows, logs its run, and defaults come from the central
// RETENTION_POLICY object.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";

import schema from "./schema";
import { internal } from "./_generated/api";
import { RETENTION_POLICY } from "./retention";

const modules = (
  import.meta as unknown as {
    glob: (pattern: string) => Record<string, () => Promise<unknown>>;
  }
).glob("./**/!(*.*.*)*.*s");

const DAY_MS = 24 * 60 * 60 * 1000;

describe("retention purges (L11)", () => {
  test("unengaged waitlist entries older than 90 days are purged; engaged/recent stay", async () => {
    const t = convexTest(schema, modules);
    const now = Date.now();
    const { staleId, freshId, invitedId } = await t.run(async (ctx) => {
      const staleId = await ctx.db.insert("waitlist", {
        email: "stale@example.com",
        position: 1,
        status: "pending",
        createdAt: now - 100 * DAY_MS,
      });
      const freshId = await ctx.db.insert("waitlist", {
        email: "fresh@example.com",
        position: 2,
        status: "pending",
        createdAt: now - 10 * DAY_MS,
      });
      const invitedId = await ctx.db.insert("waitlist", {
        email: "invited@example.com",
        position: 3,
        status: "invited",
        createdAt: now - 200 * DAY_MS,
        invitedAt: now - 150 * DAY_MS,
      });
      return { staleId, freshId, invitedId };
    });

    const result = await t.mutation(
      internal.retention.purgeStaleWaitlistEntries,
      {},
    );
    expect(result.deleted).toBe(1);

    await t.run(async (ctx) => {
      expect(await ctx.db.get(staleId)).toBeNull();
      expect(await ctx.db.get(freshId)).not.toBeNull();
      expect(await ctx.db.get(invitedId)).not.toBeNull();
    });
  });

  test("reading history older than 18 months is purged; recent stays", async () => {
    const t = convexTest(schema, modules);
    const now = Date.now();
    const { oldId, recentId } = await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", {
        authUserId: "auth-l11",
        email: "l11@example.com",
        profile: {},
      });
      const sourceId = await ctx.db.insert("sources", {
        domain: "example.ro",
        name: "Example",
        baseBias: 0,
        reliabilityScore: 5,
      });
      const eventId = await ctx.db.insert("events", {
        title: "Ev",
        slug: "ev-l11",
        status: "published",
        firstPublishedAt: now,
        articleCount: 1,
        sourceCount: 1,
        sourceIds: [sourceId],
      });
      const oldId = await ctx.db.insert("interactions", {
        userId,
        eventId,
        type: "view",
        metadata: {},
        timestamp: now - 600 * DAY_MS, // ~20 months
      });
      const recentId = await ctx.db.insert("interactions", {
        userId,
        eventId,
        type: "view",
        metadata: {},
        timestamp: now - 30 * DAY_MS,
      });
      return { oldId, recentId };
    });

    const result = await t.mutation(
      internal.retention.purgeOldReadingHistory,
      {},
    );
    expect(result.deleted).toBe(1);

    await t.run(async (ctx) => {
      expect(await ctx.db.get(oldId)).toBeNull();
      expect(await ctx.db.get(recentId)).not.toBeNull();
    });
  });

  test("every purge run is logged with its data class and deleted count", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(internal.retention.purgeStaleWaitlistEntries, {});
    await t.mutation(internal.retention.purgeOldReadingHistory, {});
    await t.mutation(internal.retention.purgeExpiredUserInsights, {});

    const logs = await t.run(async (ctx) =>
      ctx.db.query("pipelineRunLogs").collect(),
    );
    const jobNames = logs.map((log) => log.jobName);
    expect(jobNames).toContain("retention:waitlist_unengaged");
    expect(jobNames).toContain("retention:reading_history");
    expect(jobNames).toContain("retention:user_insights");
    for (const log of logs) {
      expect(log.counters.deleted).toBeDefined();
      expect(log.createdAt).toBeGreaterThan(0);
    }
  });

  test("RETENTION_POLICY is the single source of truth", () => {
    expect(RETENTION_POLICY.waitlistUnengagedDays).toBe(90);
    expect(RETENTION_POLICY.readingHistoryDays).toBe(548);
    // Transient body text: zero retention by construction.
    expect(RETENTION_POLICY.articleBodyTextDays).toBe(0);

    // The retention module references the policy for its defaults.
    const source = readFileSync(join(__dirname, "retention.ts"), "utf8");
    expect(source).toContain("RETENTION_POLICY.waitlistUnengagedDays");
    expect(source).toContain("RETENTION_POLICY.readingHistoryDays");
  });

  test("the purge jobs are scheduled as crons", () => {
    const cronSource = readFileSync(join(__dirname, "crons.ts"), "utf8");
    expect(cronSource).toContain("retention-purge-stale-waitlist");
    expect(cronSource).toContain("retention-purge-reading-history");
    expect(cronSource).toContain("retention-purge-expired-insights");
  });
});
