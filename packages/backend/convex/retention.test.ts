// L11: retention crons — time-shifted fixtures prove each purge deletes only
// beyond-retention rows, logs its run, and defaults come from the central
// RETENTION_POLICY object.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { convexTest } from "convex-test";
import { afterEach, describe, expect, test, vi } from "vitest";

import schema from "./schema";
import { internal } from "./_generated/api";
import {
  RETENTION_POLICY,
  STORAGE_RETENTION_CONFIG_KEYS,
  STORAGE_RETENTION_DEFAULTS,
} from "./retention";

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

// ---------------------------------------------------------------------------
// Storage-cost retention (Convex bills per GB-month)
// ---------------------------------------------------------------------------
// convex-test stamps `_creationTime` at insert, so these tests seed fixtures at
// the real clock and then jump `Date.now()` forward past the retention window.
// Only `Date` is faked so convex-test's own async plumbing keeps working.

const CLOCK_SKIP_DAYS = 400;

function jumpClockPastRetention(base: number): number {
  const clockNow = base + CLOCK_SKIP_DAYS * DAY_MS;
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(clockNow);
  return clockNow;
}

describe("storage-cost retention purges", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  test("embeddings outside the clustering window are purged; the article row survives", async () => {
    const t = convexTest(schema, modules);
    const clockNow = Date.now() + CLOCK_SKIP_DAYS * DAY_MS;

    const ids = await t.run(async (ctx) => {
      const sourceId = await ctx.db.insert("sources", {
        domain: "storage.ro",
        name: "Storage",
        baseBias: 0,
        reliabilityScore: 5,
      });
      const staleArticleId = await ctx.db.insert("articles", {
        sourceId,
        title: "Stale",
        url: "https://storage.ro/stale",
        canonicalUrl: "https://storage.ro/stale",
        status: "clustered",
        publishedAt: clockNow - 120 * DAY_MS,
      });
      const staleEmbeddingId = await ctx.db.insert("articleEmbeddings", {
        articleId: staleArticleId,
        embedding: [0.1, 0.2, 0.3],
        version: 1,
      });
      const freshArticleId = await ctx.db.insert("articles", {
        sourceId,
        title: "Fresh",
        url: "https://storage.ro/fresh",
        canonicalUrl: "https://storage.ro/fresh",
        status: "clustered",
        publishedAt: clockNow - 1 * DAY_MS,
      });
      const freshEmbeddingId = await ctx.db.insert("articleEmbeddings", {
        articleId: freshArticleId,
        embedding: [0.4, 0.5, 0.6],
        version: 1,
      });
      return {
        staleArticleId,
        staleEmbeddingId,
        freshArticleId,
        freshEmbeddingId,
      };
    });

    jumpClockPastRetention(Date.now());

    const result = await t.mutation(
      internal.retention.purgeStaleArticleEmbeddings,
      {},
    );
    expect(result.deleted).toBe(1);
    expect(result.skipped).toBe(1);

    await t.run(async (ctx) => {
      // The vector is gone...
      expect(await ctx.db.get(ids.staleEmbeddingId)).toBeNull();
      // ...but the article it belonged to is untouched.
      expect(await ctx.db.get(ids.staleArticleId)).not.toBeNull();
      // Articles still inside the window keep their vector.
      expect(await ctx.db.get(ids.freshEmbeddingId)).not.toBeNull();
      expect(await ctx.db.get(ids.freshArticleId)).not.toBeNull();
    });
  });

  test("the embedding window is tunable via config and defaults to 45 days", async () => {
    const t = convexTest(schema, modules);
    const clockNow = Date.now() + CLOCK_SKIP_DAYS * DAY_MS;

    const embeddingId = await t.run(async (ctx) => {
      const sourceId = await ctx.db.insert("sources", {
        domain: "cfg.ro",
        name: "Cfg",
        baseBias: 0,
        reliabilityScore: 5,
      });
      const articleId = await ctx.db.insert("articles", {
        sourceId,
        title: "Sixty days old",
        url: "https://cfg.ro/a",
        canonicalUrl: "https://cfg.ro/a",
        status: "clustered",
        publishedAt: clockNow - 60 * DAY_MS,
      });
      // A longer window than the 60-day-old article -> must be kept.
      await ctx.db.insert("config", {
        key: STORAGE_RETENTION_CONFIG_KEYS.articleEmbeddingDays,
        value: JSON.stringify(180),
        description: "test override",
        updatedAt: Date.now(),
      });
      return ctx.db.insert("articleEmbeddings", {
        articleId,
        embedding: [0.1],
        version: 1,
      });
    });

    jumpClockPastRetention(Date.now());

    const held = await t.mutation(
      internal.retention.purgeStaleArticleEmbeddings,
      {},
    );
    expect(held.deleted).toBe(0);
    await t.run(async (ctx) => {
      expect(await ctx.db.get(embeddingId)).not.toBeNull();
    });

    // With the default 45-day window the same row is beyond retention.
    const purged = await t.mutation(
      internal.retention.purgeStaleArticleEmbeddings,
      { retentionDays: STORAGE_RETENTION_DEFAULTS.articleEmbeddingDays },
    );
    expect(purged.deleted).toBe(1);
    await t.run(async (ctx) => {
      expect(await ctx.db.get(embeddingId)).toBeNull();
    });
  });

  test("orphaned embeddings (article already deleted) are purged", async () => {
    const t = convexTest(schema, modules);

    const { orphanId, liveEmbeddingId } = await t.run(async (ctx) => {
      const sourceId = await ctx.db.insert("sources", {
        domain: "orphan.ro",
        name: "Orphan",
        baseBias: 0,
        reliabilityScore: 5,
      });
      const doomedArticleId = await ctx.db.insert("articles", {
        sourceId,
        title: "Doomed",
        url: "https://orphan.ro/x",
        canonicalUrl: "https://orphan.ro/x",
        status: "clustered",
        publishedAt: Date.now(),
      });
      const orphanId = await ctx.db.insert("articleEmbeddings", {
        articleId: doomedArticleId,
        embedding: [0.1],
        version: 1,
      });
      await ctx.db.delete(doomedArticleId);

      const liveArticleId = await ctx.db.insert("articles", {
        sourceId,
        title: "Live",
        url: "https://orphan.ro/y",
        canonicalUrl: "https://orphan.ro/y",
        status: "clustered",
        publishedAt: Date.now(),
      });
      const liveEmbeddingId = await ctx.db.insert("articleEmbeddings", {
        articleId: liveArticleId,
        embedding: [0.2],
        version: 1,
      });
      return { orphanId, liveEmbeddingId };
    });

    const result = await t.mutation(
      internal.retention.purgeOrphanedArticleEmbeddings,
      {},
    );
    expect(result.deleted).toBe(1);
    expect(result.done).toBe(true);

    await t.run(async (ctx) => {
      expect(await ctx.db.get(orphanId)).toBeNull();
      expect(await ctx.db.get(liveEmbeddingId)).not.toBeNull();
    });
  });

  test("archived+detached articles are purged; attached, recent and gold-set articles are not", async () => {
    const t = convexTest(schema, modules);
    const clockNow = Date.now() + CLOCK_SKIP_DAYS * DAY_MS;

    const ids = await t.run(async (ctx) => {
      const sourceId = await ctx.db.insert("sources", {
        domain: "arch.ro",
        name: "Arch",
        baseBias: 0,
        reliabilityScore: 5,
      });
      const eventId = await ctx.db.insert("events", {
        title: "Live event",
        slug: "live-event",
        status: "published",
        firstPublishedAt: clockNow,
        articleCount: 1,
        sourceCount: 1,
        sourceIds: [sourceId],
      });

      const purgeableId = await ctx.db.insert("articles", {
        sourceId,
        title: "Archived + detached",
        url: "https://arch.ro/1",
        canonicalUrl: "https://arch.ro/1",
        status: "archived",
        archivedAt: clockNow - 200 * DAY_MS,
        archivedReason: "stale_singleton",
        publishedAt: clockNow - 200 * DAY_MS,
      });
      const purgeableEmbeddingId = await ctx.db.insert("articleEmbeddings", {
        articleId: purgeableId,
        embedding: [0.1],
        version: 1,
      });

      // Recently archived — still inside the window.
      const recentlyArchivedId = await ctx.db.insert("articles", {
        sourceId,
        title: "Recently archived",
        url: "https://arch.ro/2",
        canonicalUrl: "https://arch.ro/2",
        status: "archived",
        archivedAt: clockNow - 3 * DAY_MS,
        archivedReason: "stale_singleton",
        publishedAt: clockNow - 3 * DAY_MS,
      });

      // Carries an archivedReason but was requeued into a live event: the
      // per-row guards must refuse to delete it.
      const requeuedId = await ctx.db.insert("articles", {
        sourceId,
        eventId,
        title: "Requeued",
        url: "https://arch.ro/3",
        canonicalUrl: "https://arch.ro/3",
        status: "enriched",
        archivedAt: clockNow - 200 * DAY_MS,
        archivedReason: "stale_processing",
        publishedAt: clockNow - 200 * DAY_MS,
      });

      // Old + archived + detached, but cited by the clustering gold set.
      const labeledId = await ctx.db.insert("articles", {
        sourceId,
        title: "Gold set member",
        url: "https://arch.ro/4",
        canonicalUrl: "https://arch.ro/4",
        status: "archived",
        archivedAt: clockNow - 200 * DAY_MS,
        archivedReason: "stale_singleton",
        publishedAt: clockNow - 200 * DAY_MS,
      });
      await ctx.db.insert("clusterPairLabels", {
        pairKey: `${labeledId}:${purgeableId}`,
        leftArticleId: labeledId,
        rightArticleId: purgeableId,
        sameEvent: false,
        labeledAt: clockNow - 210 * DAY_MS,
      });

      return {
        purgeableId,
        purgeableEmbeddingId,
        recentlyArchivedId,
        requeuedId,
        labeledId,
      };
    });

    jumpClockPastRetention(Date.now());

    const result = await t.mutation(
      internal.retention.purgeArchivedDetachedArticles,
      {},
    );
    // purgeableId is itself cited by the gold-set label, so nothing is deleted.
    expect(result.deleted).toBe(0);

    await t.run(async (ctx) => {
      await ctx.db.delete(
        (await ctx.db.query("clusterPairLabels").first())!._id,
      );
    });

    const second = await t.mutation(
      internal.retention.purgeArchivedDetachedArticles,
      {},
    );
    expect(second.deleted).toBe(2); // purgeable + previously-labeled
    expect(second.deletedEmbeddings).toBe(1);

    await t.run(async (ctx) => {
      expect(await ctx.db.get(ids.purgeableId)).toBeNull();
      expect(await ctx.db.get(ids.purgeableEmbeddingId)).toBeNull();
      expect(await ctx.db.get(ids.labeledId)).toBeNull();
      // Guarded rows survive.
      expect(await ctx.db.get(ids.recentlyArchivedId)).not.toBeNull();
      expect(await ctx.db.get(ids.requeuedId)).not.toBeNull();
    });
  });

  test("storage purges log their data class and deleted count", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(internal.retention.purgeStaleArticleEmbeddings, {});
    await t.mutation(internal.retention.purgeOrphanedArticleEmbeddings, {});
    await t.mutation(internal.retention.purgeArchivedDetachedArticles, {});

    const logs = await t.run(async (ctx) =>
      ctx.db.query("pipelineRunLogs").collect(),
    );
    const jobNames = logs.map((log) => log.jobName);
    expect(jobNames).toContain("retention:article_embeddings_stale");
    expect(jobNames).toContain("retention:article_embeddings_orphaned");
    expect(jobNames).toContain("retention:articles_archived_detached");
    for (const log of logs) {
      expect(log.counters.deleted).toBeDefined();
      expect(log.metadata.dataClass).toBeDefined();
    }
  });
});
