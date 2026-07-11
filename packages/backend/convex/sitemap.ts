import { v } from "convex/values";
import { internalMutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";

const SITEMAP_KEY = "public";
// Must match the canonical host (apex 307-redirects to www).
const DEFAULT_SITE_URL = "https://www.biviant.com";
const DEFAULT_LIMIT = 5000;
const SITEMAP_PAGE_SIZE = 1000;

// Public indexable routes without per-row lastmod.
const STATIC_PATHS = [
  "/",
  "/feed",
  "/surse",
  "/cum-functioneaza",
  "/sursele-noastre",
  "/despre",
  "/parteneri",
  "/contact",
  "/termeni",
  "/politica-confidentialitate",
];

function escapeXml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function toSitemapUrl(siteUrl: string, pathname: string, lastModifiedAt?: number) {
  const url = new URL(pathname, siteUrl).toString();
  const lastmod = lastModifiedAt
    ? `<lastmod>${new Date(lastModifiedAt).toISOString()}</lastmod>`
    : "";
  return `<url><loc>${escapeXml(url)}</loc>${lastmod}</url>`;
}

async function upsertSnapshot(
  ctx: MutationCtx,
  args: { key: string; xml: string; urlCount: number; now: number },
) {
  const existing = await ctx.db
    .query("publicSitemapSnapshots")
    .withIndex("by_key", (q) => q.eq("key", args.key))
    .unique();

  const payload = {
    xml: args.xml,
    urlCount: args.urlCount,
    generatedAt: args.now,
    updatedAt: args.now,
  };

  if (existing) {
    await ctx.db.patch(existing._id, payload);
    return existing._id;
  }

  return await ctx.db.insert("publicSitemapSnapshots", {
    key: args.key,
    ...payload,
  });
}

export const getPublicSitemapXml = query({
  args: {},
  handler: async (ctx) => {
    const snapshot = await ctx.db
      .query("publicSitemapSnapshots")
      .withIndex("by_key", (q) => q.eq("key", SITEMAP_KEY))
      .unique();
    return snapshot
      ? {
          xml: snapshot.xml,
          generatedAt: snapshot.generatedAt,
          urlCount: snapshot.urlCount,
        }
      : null;
  },
});

export const rebuildPublicSitemapSnapshot = internalMutation({
  args: {
    limit: v.optional(v.number()),
    siteUrl: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const limit = Math.min(
      Math.max(Math.floor(args.limit ?? DEFAULT_LIMIT), 1),
      45000,
    );
    const siteUrl = args.siteUrl?.trim() || DEFAULT_SITE_URL;
    const now = Date.now();

    // Convex allows only one .paginate() per mutation, so events (the only
    // unbounded scan) uses it and sources falls back to .take() (the previous
    // double-paginate version threw on every cron run and the snapshot never
    // built). .paginate()'s opaque continueCursor is a stable, unique position
    // — it encodes the index tiebreaker, so events sharing a lastUpdatedAt are
    // never skipped at a page boundary the way a bare `lt(lastUpdatedAt)`
    // range cursor would skip them.
    const events: Array<Doc<"publicEventPreviews">> = [];
    let eventCursor: string | null = null;
    let readRows = 0;
    while (events.length < limit) {
      const result = await ctx.db
        .query("publicEventPreviews")
        .withIndex("by_last_updated_at")
        .order("desc")
        .paginate({ numItems: SITEMAP_PAGE_SIZE, cursor: eventCursor });
      readRows += result.page.length;
      // Thin-page gate: an event page without an AI summary is mostly
      // third-party RSS text — keep it out of the sitemap until summarized.
      for (const event of result.page) {
        if (event.perspectiveSummaries?.neutral?.trim()) {
          events.push(event);
          if (events.length >= limit) break;
        }
      }
      if (result.isDone || events.length >= limit) break;
      eventCursor = result.continueCursor;
    }

    // Sources are few dozen in practice, so a single .take() capped at
    // SITEMAP_PAGE_SIZE covers the whole table; the cap only guards against a
    // runaway payload and never truncates the real source directory.
    const sourceLimit = Math.max(0, limit - events.length);
    const sources: Array<Doc<"sources">> =
      sourceLimit === 0
        ? []
        : await ctx.db
            .query("sources")
            .withIndex("by_rolling_bias_updated_at")
            .order("desc")
            .take(Math.min(sourceLimit, SITEMAP_PAGE_SIZE));

    const entries = [
      ...STATIC_PATHS.map((path) => toSitemapUrl(siteUrl, path)),
      ...events.map((event) =>
        toSitemapUrl(siteUrl, `/event/${event.slug}`, event.lastUpdatedAt),
      ),
      ...sources.map((source) =>
        toSitemapUrl(
          siteUrl,
          `/source/${source._id}`,
          source.rollingBiasUpdatedAt ??
            source.mbfcLastChecked ??
            source._creationTime,
        ),
      ),
    ];

    const xml = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
      ...entries,
      "</urlset>",
    ].join("");

    const snapshotId = await upsertSnapshot(ctx, {
      key: SITEMAP_KEY,
      xml,
      urlCount: entries.length,
      now,
    });

    await ctx.scheduler.runAfter(
      0,
      internal.pipeline.recordPipelineIoRollup,
      {
        jobName: "rebuildPublicSitemapSnapshot",
        readRows: readRows + sources.length,
        writeRows: 1,
        vectorSearches: 0,
        status: "ok",
        estimatedPayloadBytes: xml.length,
      },
    );

    return { snapshotId, urlCount: entries.length, generatedAt: now };
  },
});
