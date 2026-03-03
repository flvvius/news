/**
 * One-time migrations. Run manually via Convex Dashboard:
 *   npx convex run migrations:<functionName>
 *
 * Safe to run multiple times (idempotent — patches existing rows).
 * Can be deleted after running.
 *
 * NOTE: These migrations use .collect() which loads entire tables into memory.
 * This is fine for small datasets (<10K rows). For larger tables, refactor to
 * use cursor-based pagination with a progress doc keyed by migration name.
 */

import { internalMutation } from "./_generated/server";
import { ALL_FEEDS } from "./feeds";

export const backfillSourceMbfc = internalMutation({
  args: {},
  handler: async (ctx) => {
    const allSources = await ctx.db.query("sources").collect();

    // Build a lookup from domain → feed entry
    const feedByDomain = new Map(ALL_FEEDS.map((f) => [f.domain, f]));

    let updated = 0;
    let skipped = 0;

    for (const source of allSources) {
      const feed = feedByDomain.get(source.domain);
      if (!feed) {
        // Source not in our curated list — leave as-is
        skipped++;
        continue;
      }

      await ctx.db.patch(source._id, {
        baseBias: feed.baseBias,
        reliabilityScore: feed.reliabilityScore,
        mbfcCategory: feed.mbfc.category,
        mbfcFactual: feed.mbfc.factual,
        mbfcCredibility: feed.mbfc.credibility,
        mbfcLastChecked: Date.now(),
      });
      updated++;
    }

    console.log(
      `[migration] backfillSourceMbfc: ${updated} sources updated, ${skipped} skipped (not in curated list)`,
    );

    return { updated, skipped };
  },
});

/**
 * Migrate existing articles:
 *  1. Convert publishedAt from string to epoch ms (number)
 *  2. Move RSS snippet from `summary` to `rssSnippet` and clear `summary`
 *  3. Clear placeholder `aiBiasScore` on unprocessed articles
 *
 * Run: npx convex run migrations:migrateArticlesSchemaV2
 */
export const migrateArticlesSchemaV2 = internalMutation({
  args: {},
  handler: async (ctx) => {
    const articles = await ctx.db.query("articles").collect();

    let migrated = 0;
    let skipped = 0;

    for (const article of articles) {
      const patch: Record<string, unknown> = {};

      // 1. Convert publishedAt string → number
      if (typeof article.publishedAt === "string") {
        const parsed = new Date(article.publishedAt).getTime();
        if (Number.isNaN(parsed)) {
          console.warn(
            `[migration] Article ${article._id}: unparseable publishedAt "${article.publishedAt}" — skipping field`,
          );
          // Don't overwrite with Date.now() — leave for manual review
        } else {
          patch.publishedAt = parsed;
        }
      }

      // 2. Move summary to rssSnippet (for unprocessed articles, summary was just the RSS snippet)
      if (article.status === "unprocessed" && article.summary) {
        patch.rssSnippet = article.summary;
        patch.summary = undefined; // Clear placeholder
      }

      // 3. Clear placeholder aiBiasScore on unprocessed articles
      if (
        article.status === "unprocessed" &&
        article.aiBiasScore !== undefined
      ) {
        patch.aiBiasScore = undefined;
      }

      if (Object.keys(patch).length > 0) {
        await ctx.db.patch(article._id, patch);
        migrated++;
      } else {
        skipped++;
      }
    }

    console.log(
      `[migration] migrateArticlesSchemaV2: ${migrated} articles migrated, ${skipped} skipped`,
    );

    return { migrated, skipped };
  },
});

/**
 * Backfill sourceId on existing ingestionMeta records.
 * Matches feed URLs to sources via the feeds.ts domain mapping.
 *
 * Run: npx convex run migrations:backfillIngestionMetaSourceId
 */
export const backfillIngestionMetaSourceId = internalMutation({
  args: {},
  handler: async (ctx) => {
    const allMeta = await ctx.db.query("ingestionMeta").collect();
    const allSources = await ctx.db.query("sources").collect();

    // Build domain → sourceId lookup
    const sourceByDomain = new Map(allSources.map((s) => [s.domain, s._id]));

    // Build feedUrl → domain lookup from feeds.ts
    const domainByFeedUrl = new Map(ALL_FEEDS.map((f) => [f.url, f.domain]));

    let updated = 0;
    let skipped = 0;

    for (const meta of allMeta) {
      if (meta.sourceId) {
        skipped++; // Already has sourceId
        continue;
      }

      const domain = domainByFeedUrl.get(meta.feedUrl);
      const sourceId = domain ? sourceByDomain.get(domain) : undefined;

      if (sourceId) {
        await ctx.db.patch(meta._id, { sourceId });
        updated++;
      } else {
        skipped++;
      }
    }

    console.log(
      `[migration] backfillIngestionMetaSourceId: ${updated} records updated, ${skipped} skipped`,
    );

    return { updated, skipped };
  },
});

// =============================================================================
// Phase 3.x — Hot/Cold Split & Junction Table Migrations
// =============================================================================

/**
 * Move event.topicIds → eventTopics junction table.
 * Events no longer store topicIds inline.
 *
 * Run: npx convex run migrations:migrateEventTopicsToJunction
 */
export const migrateEventTopicsToJunction = internalMutation({
  args: {},
  handler: async (ctx) => {
    const events = await ctx.db.query("events").collect();
    let created = 0;
    let skipped = 0;

    for (const event of events) {
      // Access the legacy field via type assertion (field no longer in schema)
      const topicIds = (event as Record<string, unknown>).topicIds as
        | string[]
        | undefined;

      if (!topicIds || topicIds.length === 0) {
        skipped++;
        continue;
      }

      // Check which junction rows already exist for this event
      const existing = await ctx.db
        .query("eventTopics")
        .withIndex("by_event", (q) => q.eq("eventId", event._id))
        .collect();

      const existingTopicIds = new Set(
        existing.map((r) => r.topicId as string),
      );

      let insertedForEvent = 0;
      for (const topicId of topicIds) {
        if (!existingTopicIds.has(topicId)) {
          await ctx.db.insert("eventTopics", {
            eventId: event._id,
            topicId: topicId as any,
          });
          insertedForEvent++;
        }
      }

      if (insertedForEvent > 0) {
        created += insertedForEvent;
      } else {
        skipped++;
      }

      // Clear the legacy field (idempotent — safe to re-run)
      await ctx.db.patch(event._id, { topicIds: undefined } as any);
    }

    console.log(
      `[migration] migrateEventTopicsToJunction: ${created} junction rows created, ${skipped} events skipped`,
    );
    return { created, skipped };
  },
});

/**
 * Move event.embedding → eventEmbeddings table.
 * Also moves event.embeddingVersion → eventEmbeddings.version.
 *
 * Run: npx convex run migrations:migrateEventEmbeddings
 */
export const migrateEventEmbeddings = internalMutation({
  args: {},
  handler: async (ctx) => {
    const events = await ctx.db.query("events").collect();
    let migrated = 0;
    let skipped = 0;

    for (const event of events) {
      const legacy = event as Record<string, unknown>;
      const embedding = legacy.embedding as number[] | undefined;
      const version = (legacy.embeddingVersion as number) ?? 1;

      if (!embedding || embedding.length === 0) {
        skipped++;
        continue;
      }

      // Check if already migrated
      const existing = await ctx.db
        .query("eventEmbeddings")
        .withIndex("by_event", (q) => q.eq("eventId", event._id))
        .first();

      if (existing) {
        skipped++;
        continue;
      }

      await ctx.db.insert("eventEmbeddings", {
        eventId: event._id,
        embedding,
        version,
      });

      // Clear legacy fields
      await ctx.db.patch(event._id, {
        embedding: undefined,
        embeddingVersion: undefined,
      } as any);

      migrated++;
    }

    console.log(
      `[migration] migrateEventEmbeddings: ${migrated} migrated, ${skipped} skipped`,
    );
    return { migrated, skipped };
  },
});

/**
 * Move article.embedding → articleEmbeddings table.
 *
 * Run: npx convex run migrations:migrateArticleEmbeddings
 */
export const migrateArticleEmbeddings = internalMutation({
  args: {},
  handler: async (ctx) => {
    const articles = await ctx.db.query("articles").collect();
    let migrated = 0;
    let skipped = 0;

    for (const article of articles) {
      const legacy = article as Record<string, unknown>;
      const embedding = legacy.embedding as number[] | undefined;

      if (!embedding || embedding.length === 0) {
        skipped++;
        continue;
      }

      // Check if already migrated
      const existing = await ctx.db
        .query("articleEmbeddings")
        .withIndex("by_article", (q) => q.eq("articleId", article._id))
        .first();

      if (existing) {
        skipped++;
        continue;
      }

      await ctx.db.insert("articleEmbeddings", {
        articleId: article._id,
        embedding,
        version: 1,
      });

      // Clear legacy field
      await ctx.db.patch(article._id, { embedding: undefined } as any);

      migrated++;
    }

    console.log(
      `[migration] migrateArticleEmbeddings: ${migrated} migrated, ${skipped} skipped`,
    );
    return { migrated, skipped };
  },
});

/**
 * Move users.stats → userStats table.
 *
 * Run: npx convex run migrations:migrateUserStats
 */
export const migrateUserStats = internalMutation({
  args: {},
  handler: async (ctx) => {
    const users = await ctx.db.query("users").collect();
    let migrated = 0;
    let skipped = 0;

    for (const user of users) {
      const legacy = user as Record<string, unknown>;
      const stats = legacy.stats as
        | {
            currentStreak: number;
            longestStreak: number;
            articlesRead: number;
            biasBalance: number;
            lastActiveAt?: number;
          }
        | undefined;

      if (!stats) {
        skipped++;
        continue;
      }

      // Check if already migrated
      const existing = await ctx.db
        .query("userStats")
        .withIndex("by_user", (q) => q.eq("userId", user._id))
        .first();

      if (existing) {
        // Destination exists — still clear legacy field for idempotency
        await ctx.db.patch(user._id, { stats: undefined } as any);
        skipped++;
        continue;
      }

      await ctx.db.insert("userStats", {
        userId: user._id,
        currentStreak: stats.currentStreak,
        longestStreak: stats.longestStreak,
        articlesRead: stats.articlesRead,
        biasBalance: stats.biasBalance,
        lastActiveAt: stats.lastActiveAt,
      });

      // Clear legacy field
      await ctx.db.patch(user._id, { stats: undefined } as any);

      migrated++;
    }

    console.log(
      `[migration] migrateUserStats: ${migrated} migrated, ${skipped} skipped`,
    );
    return { migrated, skipped };
  },
});

/**
 * Move users.privateContext → userPrivateContext table.
 *
 * Run: npx convex run migrations:migrateUserPrivateContext
 */
export const migrateUserPrivateContext = internalMutation({
  args: {},
  handler: async (ctx) => {
    const users = await ctx.db.query("users").collect();
    let migrated = 0;
    let skipped = 0;

    for (const user of users) {
      const legacy = user as Record<string, unknown>;
      const pc = legacy.privateContext as
        | {
            incomeBracket?: string;
            concerns: string[];
            interests: string[];
            politicalLeaning?: string;
          }
        | undefined;

      if (!pc) {
        skipped++;
        continue;
      }

      // Check if already migrated
      const existing = await ctx.db
        .query("userPrivateContext")
        .withIndex("by_user", (q) => q.eq("userId", user._id))
        .first();

      if (existing) {
        // Destination exists — still clear legacy field for idempotency
        await ctx.db.patch(user._id, { privateContext: undefined } as any);
        skipped++;
        continue;
      }

      await ctx.db.insert("userPrivateContext", {
        userId: user._id,
        incomeBracket: pc.incomeBracket,
        concerns: pc.concerns,
        interests: pc.interests,
        politicalLeaning: pc.politicalLeaning,
      });

      // Clear legacy field
      await ctx.db.patch(user._id, { privateContext: undefined } as any);

      migrated++;
    }

    console.log(
      `[migration] migrateUserPrivateContext: ${migrated} migrated, ${skipped} skipped`,
    );
    return { migrated, skipped };
  },
});
