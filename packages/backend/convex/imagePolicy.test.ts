// L9: image/thumbnail policy — no publisher image bytes in storage,
// og:image is hotlink-only and killable globally + per-domain, opt-out
// domains lose their thumbnails.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { convexTest, type TestConvex } from "convex-test";
import { describe, expect, test, vi } from "vitest";

import schema from "./schema";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

const modules = (
  import.meta as unknown as {
    glob: (pattern: string) => Record<string, () => Promise<unknown>>;
  }
).glob("./**/!(*.*.*)*.*s");

type ConvexT = TestConvex<typeof schema>;

const IMAGE_URL = "https://exemplu.ro/poze/hero.jpg";

async function seedEventWithImage(t: ConvexT, slug: string) {
  const now = Date.now();
  return await t.run(async (ctx) => {
    const sourceId = await ctx.db.insert("sources", {
      domain: "exemplu.ro",
      name: "Exemplu",
      baseBias: 0,
      reliabilityScore: 6,
    });
    const eventId = await ctx.db.insert("events", {
      title: `Eveniment ${slug}`,
      slug,
      status: "published",
      imageUrl: IMAGE_URL,
      imageAlt: "alt",
      firstPublishedAt: now,
      lastUpdatedAt: now,
      lastArticleAt: now,
      articleCount: 1,
      sourceCount: 1,
      sourceIds: [sourceId],
    });
    await ctx.db.insert("articles", {
      sourceId,
      eventId,
      title: "Articol",
      url: "https://exemplu.ro/articol",
      canonicalUrl: "https://exemplu.ro/articol",
      imageUrl: IMAGE_URL,
      status: "clustered",
      publishedAt: now,
    });
    return { eventId, sourceId };
  });
}

describe("og:image kill switches (L9)", () => {
  test("global kill switch strips the event thumbnail", async () => {
    const t = convexTest(schema, modules);
    await seedEventWithImage(t, "img-global");

    let result = await t.query(api.events.getEventBySlug, {
      slug: "img-global",
    });
    expect(result?.event.imageUrl).toBe(IMAGE_URL);

    await t.run(async (ctx) => {
      await ctx.db.insert("config", {
        key: "og_image_display_enabled",
        value: JSON.stringify(false),
        description: "test",
        updatedAt: Date.now(),
      });
    });

    result = await t.query(api.events.getEventBySlug, { slug: "img-global" });
    expect(result?.event.imageUrl).toBeUndefined();
  });

  test("per-domain kill switch and opt-out state strip the thumbnail", async () => {
    const t = convexTest(schema, modules);
    await seedEventWithImage(t, "img-domain");

    await t.run(async (ctx) => {
      await ctx.db.insert("domainPermissions", {
        domain: "exemplu.ro",
        state: "full",
        signals: [],
        imagesDisabled: true,
        resolvedAt: Date.now(),
        expiresAt: Date.now() + 86_400_000,
        updatedAt: Date.now(),
      });
    });
    let result = await t.query(api.events.getEventBySlug, {
      slug: "img-domain",
    });
    expect(result?.event.imageUrl).toBeUndefined();

    // Even with images re-enabled, a non-full TDM state blocks thumbnails.
    await t.run(async (ctx) => {
      const row = await ctx.db
        .query("domainPermissions")
        .withIndex("by_domain", (q) => q.eq("domain", "exemplu.ro"))
        .unique();
      await ctx.db.patch(row!._id, { imagesDisabled: false, state: "rss_only" });
    });
    result = await t.query(api.events.getEventBySlug, { slug: "img-domain" });
    expect(result?.event.imageUrl).toBeUndefined();
  });

  test("opt-out purge clears article and event thumbnails", async () => {
    vi.useFakeTimers();
    try {
      const t = convexTest(schema, modules);
      const { eventId } = await seedEventWithImage(t, "img-purge");

      await t.mutation(internal.domainPermissions.upsertDomainPermission, {
        domain: "exemplu.ro",
        state: "full",
        signals: [],
      });
      await t.mutation(internal.domainPermissions.upsertDomainPermission, {
        domain: "exemplu.ro",
        state: "rss_only",
        signals: ["noai"],
      });
      await t.finishAllScheduledFunctions(vi.runAllTimers);

      const event = await t.run(async (ctx) => ctx.db.get(eventId));
      expect(event?.imageUrl).toBeUndefined();

      const articles = await t.run(async (ctx) =>
        ctx.db.query("articles").collect(),
      );
      expect(articles.every((article) => article.imageUrl === undefined)).toBe(
        true,
      );
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("no publisher image bytes in storage (L9)", () => {
  const convexDir = __dirname;

  function sourceFiles(dir: string): string[] {
    return readdirSync(dir).flatMap((entry) => {
      const full = join(dir, entry);
      if (entry === "_generated" || entry === "node_modules") return [];
      if (statSync(full).isDirectory()) return sourceFiles(full);
      return /\.(ts|tsx)$/.test(entry) && !entry.endsWith(".test.ts")
        ? [full]
        : [];
    });
  }

  test("ctx.storage.store is used only by the own-rendered share card", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(convexDir)) {
      const content = readFileSync(file, "utf8");
      if (/storage\.store\(/.test(content) && !file.endsWith("shareAssetsNode.ts")) {
        offenders.push(file);
      }
    }
    expect(offenders).toEqual([]);
  });

  test("the share card renderer no longer downloads the publisher og:image", () => {
    const content = readFileSync(join(convexDir, "shareAssetsNode.ts"), "utf8");
    expect(content).not.toMatch(/fetchImageAsDataUri\(data\.imageUrl\)/);
  });
});
