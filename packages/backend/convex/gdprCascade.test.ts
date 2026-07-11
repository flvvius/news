// L10: GDPR deletion cascade — a user with data in EVERY userId-referencing
// table is fully erased, and the covered-table list is cross-checked against
// schema.ts so a new user-linked table can't silently escape the cascade.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";

import schema from "./schema";
import { internal } from "./_generated/api";

const modules = (
  import.meta as unknown as {
    glob: (pattern: string) => Record<string, () => Promise<unknown>>;
  }
).glob("./**/!(*.*.*)*.*s");

// Every table the cascade in authMaintenance.deleteAppUserData covers.
const CASCADE_TABLES = [
  "userStats",
  "userPrivateContext",
  "userInsights",
  "interactions",
  "guestMerges",
  "pushTokens",
  "briefingSends",
  "quizAttempts",
] as const;

describe("GDPR deletion cascade (L10)", () => {
  test("every table referencing v.id(\"users\") in the schema is covered", () => {
    const schemaSource = readFileSync(join(__dirname, "schema.ts"), "utf8");
    // Split the schema into per-table chunks: each chunk runs from one
    // `name: defineTable(` to the next.
    const headers = [...schemaSource.matchAll(/(\w+):\s*defineTable\(/g)];
    const referencing: string[] = [];
    for (let i = 0; i < headers.length; i++) {
      const name = headers[i]![1]!;
      const start = headers[i]!.index!;
      const end = headers[i + 1]?.index ?? schemaSource.length;
      const body = schemaSource.slice(start, end);
      if (name !== "users" && body.includes('v.id("users")')) {
        referencing.push(name);
      }
    }

    expect(referencing.length).toBeGreaterThanOrEqual(CASCADE_TABLES.length);
    for (const table of referencing) {
      expect(
        CASCADE_TABLES as readonly string[],
        `table "${table}" references v.id("users") but is not in the deletion cascade`,
      ).toContain(table);
    }
  });

  test("deleteAppUserData erases every row across all tables + waitlist", async () => {
    const t = convexTest(schema, modules);
    const authUserId = "auth-user-l10";
    const email = "gdpr@example.com";

    const seeded = await t.run(async (ctx) => {
      const now = Date.now();
      const userId = await ctx.db.insert("users", {
        authUserId,
        email,
        profile: { name: "GDPR Test" },
      });
      const sourceId = await ctx.db.insert("sources", {
        domain: "example.ro",
        name: "Example",
        baseBias: 0,
        reliabilityScore: 5,
      });
      const eventId = await ctx.db.insert("events", {
        title: "Ev",
        slug: "ev-gdpr",
        status: "published",
        firstPublishedAt: now,
        articleCount: 1,
        sourceCount: 1,
        sourceIds: [sourceId],
      });
      const articleId = await ctx.db.insert("articles", {
        sourceId,
        eventId,
        title: "A",
        url: "https://example.ro/a",
        canonicalUrl: "https://example.ro/a",
        status: "clustered",
        publishedAt: now,
      });
      const quizId = await ctx.db.insert("dailyQuizzes", {
        dateKey: "2026-07-10",
        status: "ready",
        questions: [],
        sourceEventIds: [eventId],
        inputSignature: "sig",
        model: "m",
        generatedAt: now,
      });

      await ctx.db.insert("userStats", {
        userId,
        currentStreak: 1,
        longestStreak: 2,
        articlesRead: 3,
        biasBalance: 0,
      });
      await ctx.db.insert("userPrivateContext", { userId, concerns: ["x"] });
      await ctx.db.insert("userInsights", {
        userId,
        eventId,
        content: { personalImpact: "i", actionableTip: "t" },
        eventLastUpdated: now,
        generatedAt: now,
        expiresAt: now + 1000,
      });
      await ctx.db.insert("interactions", {
        userId,
        eventId,
        articleId,
        type: "bookmark",
        metadata: {},
        timestamp: now,
      });
      await ctx.db.insert("guestMerges", {
        userId,
        deviceId: "device-1",
        mergedAt: now,
        readsMerged: 2,
      });
      await ctx.db.insert("pushTokens", {
        userId,
        token: "push-token",
        platform: "ios",
        updatedAt: now,
      });
      await ctx.db.insert("briefingSends", { userId, eventId, sentAt: now });
      await ctx.db.insert("quizAttempts", {
        userId,
        quizId,
        dateKey: "2026-07-10",
        answers: [],
        score: 0,
        maxScore: 4,
        completedAt: now,
      });
      await ctx.db.insert("waitlist", {
        email,
        position: 1,
        status: "converted",
        createdAt: now,
      });
      return { userId };
    });

    await t.mutation(internal.authMaintenance.deleteAppUserData, {
      authUserId,
    });

    await t.run(async (ctx) => {
      expect(await ctx.db.get(seeded.userId)).toBeNull();
      for (const table of CASCADE_TABLES) {
        const rows = await ctx.db.query(table).collect();
        expect(rows, `rows left in ${table}`).toHaveLength(0);
      }
      const waitlistRows = await ctx.db.query("waitlist").collect();
      expect(waitlistRows).toHaveLength(0);
    });
  });

  test("google OAuth requests only minimal scopes (no scope expansion in config)", () => {
    // Better Auth's Google provider defaults to openid/email/profile; the
    // config must not add scopes. Guard: auth.ts contains no `scope`
    // configuration for social providers.
    const authSource = readFileSync(join(__dirname, "auth.ts"), "utf8");
    const socialBlock = authSource.slice(authSource.indexOf("socialProviders"));
    expect(socialBlock.slice(0, 800)).not.toMatch(/scope\s*:/);
  });
});
