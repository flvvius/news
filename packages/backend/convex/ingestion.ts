/**
 * RSS Ingestion Pipeline — Phase 3.1 + 3.3
 *
 * Responsibilities:
 *  1. Fetch & parse RSS/Atom feeds
 *  2. Deduplicate by canonical URL
 *  3. Create or match sources by domain
 *  4. Insert articles as "unprocessed"
 *  5. Track feed health in ingestionMeta
 *
 * This file uses Convex actions (Node.js runtime) so it can make HTTP
 * requests. Database writes are delegated to internal mutations to keep
 * the action idempotent-safe.
 */

import { v } from "convex/values";
import {
  internalAction,
  internalMutation,
  internalQuery,
} from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { ALL_FEEDS, type FeedEntry } from "./feeds";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Max articles to ingest per feed per run (prevents runaway on first ingest) */
const MAX_ARTICLES_PER_FEED = 25;

/** User-Agent for RSS fetches. Be a good citizen. */
const USER_AGENT = "Biviant/1.0 (news aggregator; +https://biviant.com)";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ParsedArticle {
  title: string;
  url: string;
  snippet: string;
  publishedAt: string; // ISO-8601 or raw date string
}

// ---------------------------------------------------------------------------
// RSS/Atom XML Parsing (lightweight, no dependencies)
// ---------------------------------------------------------------------------

/**
 * Extremely minimal RSS/Atom parser. Extracts title, link, description/summary,
 * and pubDate/updated from XML text. No dependency needed — just regex + string ops.
 *
 * Handles:
 *  - RSS 2.0 (<item>)
 *  - Atom (<entry>)
 */
function parseRSSXml(xml: string): ParsedArticle[] {
  const articles: ParsedArticle[] = [];

  // Detect Atom vs RSS
  const isAtom = xml.includes("<feed") && xml.includes("<entry");

  if (isAtom) {
    // Atom: <entry> ... </entry>
    const entries = xml.match(/<entry[\s>][\s\S]*?<\/entry>/gi) ?? [];
    for (const entry of entries) {
      const title = extractTag(entry, "title");
      const link = extractAtomLink(entry) ?? extractTag(entry, "link") ?? "";
      const snippet =
        extractTag(entry, "summary") ?? extractTag(entry, "content") ?? "";
      const publishedAt =
        extractTag(entry, "published") ?? extractTag(entry, "updated") ?? "";

      if (title && link) {
        articles.push({
          title: stripHtml(title).slice(0, 500),
          url: link.trim(),
          snippet: stripHtml(snippet).slice(0, 1000),
          publishedAt,
        });
      }
    }
  } else {
    // RSS 2.0: <item> ... </item>
    const items = xml.match(/<item[\s>][\s\S]*?<\/item>/gi) ?? [];
    for (const item of items) {
      const title = extractTag(item, "title");
      const link = extractTag(item, "link");
      const snippet =
        extractTag(item, "description") ??
        extractTag(item, "content:encoded") ??
        "";
      const publishedAt =
        extractTag(item, "pubDate") ?? extractTag(item, "dc:date") ?? "";

      if (title && link) {
        articles.push({
          title: stripHtml(title).slice(0, 500),
          url: link.trim(),
          snippet: stripHtml(snippet).slice(0, 1000),
          publishedAt,
        });
      }
    }
  }

  return articles;
}

/** Extract text content of an XML tag. Returns null if missing. */
function extractTag(xml: string, tag: string): string | null {
  // Handle CDATA sections: <tag><![CDATA[...]]></tag>
  const cdataPattern = new RegExp(
    `<${tag}[^>]*>\\s*<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>\\s*</${tag}>`,
    "i",
  );
  const cdataMatch = xml.match(cdataPattern);
  if (cdataMatch) return cdataMatch[1]?.trim() ?? null;

  // Plain text: <tag>...</tag>
  const plainPattern = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i");
  const plainMatch = xml.match(plainPattern);
  return plainMatch?.[1]?.trim() ?? null;
}

/** Extract href from Atom <link rel="alternate" href="..."/> */
function extractAtomLink(entry: string): string | null {
  // Try rel="alternate" first
  const altMatch = entry.match(
    /<link[^>]*rel\s*=\s*["']alternate["'][^>]*href\s*=\s*["']([^"']+)["'][^>]*\/?>/i,
  );
  if (altMatch) return altMatch[1] ?? null;

  // Reversed order: href before rel
  const altMatch2 = entry.match(
    /<link[^>]*href\s*=\s*["']([^"']+)["'][^>]*rel\s*=\s*["']alternate["'][^>]*\/?>/i,
  );
  if (altMatch2) return altMatch2[1] ?? null;

  // Fallback: first <link href="..."/>
  const fallback = entry.match(
    /<link[^>]*href\s*=\s*["']([^"']+)["'][^>]*\/?>/i,
  );
  return fallback?.[1] ?? null;
}

/** Strip HTML tags and decode common entities. */
function stripHtml(text: string): string {
  return text
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&#(\d+);/g, (_m, code) =>
      String.fromCharCode(Number.parseInt(code, 10)),
    )
    .replace(/\s+/g, " ")
    .trim();
}

// ---------------------------------------------------------------------------
// URL Canonicalization
// ---------------------------------------------------------------------------

/**
 * Normalize a URL for dedup purposes:
 *  - Strip tracking params (utm_*, fbclid, etc.)
 *  - Remove trailing slashes
 *  - Force lowercase on host
 *  - Remove fragments
 */
function canonicalizeUrl(raw: string): string {
  try {
    const url = new URL(raw);
    url.hash = "";
    // Remove common tracking params
    const trackingParams = [
      "utm_source",
      "utm_medium",
      "utm_campaign",
      "utm_term",
      "utm_content",
      "fbclid",
      "gclid",
      "ref",
      "source",
    ];
    for (const param of trackingParams) {
      url.searchParams.delete(param);
    }
    // Lowercase host
    url.hostname = url.hostname.toLowerCase();
    // Remove trailing slash (but not root "/")
    let normalized = url.toString();
    if (normalized.endsWith("/") && url.pathname !== "/") {
      normalized = normalized.slice(0, -1);
    }
    return normalized;
  } catch {
    // If URL parsing fails, return as-is
    return raw.trim();
  }
}

/** Extract domain from a URL (e.g. "nytimes.com" from "https://www.nytimes.com/...") */
function extractDomain(url: string): string {
  try {
    const host = new URL(url).hostname.toLowerCase();
    // Strip "www." prefix
    return host.replace(/^www\./, "");
  } catch {
    return "";
  }
}

// ---------------------------------------------------------------------------
// Internal Queries
// ---------------------------------------------------------------------------

/** Check if a canonical URL already exists in articles table. */
export const articleExistsByCanonicalUrl = internalQuery({
  args: { canonicalUrl: v.string() },
  handler: async (ctx, { canonicalUrl }) => {
    const existing = await ctx.db
      .query("articles")
      .withIndex("by_canonical_url", (q) => q.eq("canonicalUrl", canonicalUrl))
      .first();
    return existing !== null;
  },
});

/** Batch-check canonical URLs for dedup. Returns the set of URLs that already exist. */
export const findExistingCanonicalUrls = internalQuery({
  args: { urls: v.array(v.string()) },
  handler: async (ctx, { urls }) => {
    const results = await Promise.all(
      urls.map((url) =>
        ctx.db
          .query("articles")
          .withIndex("by_canonical_url", (q) => q.eq("canonicalUrl", url))
          .first(),
      ),
    );
    const existing = new Set<string>();
    for (let i = 0; i < urls.length; i++) {
      if (results[i]) existing.add(urls[i]!);
    }
    return [...existing];
  },
});

/** Find a source by domain, or return null. */
export const getSourceByDomain = internalQuery({
  args: { domain: v.string() },
  handler: async (ctx, { domain }) => {
    return ctx.db
      .query("sources")
      .withIndex("by_domain", (q) => q.eq("domain", domain))
      .first();
  },
});

/** Get ingestion meta for a feed URL. */
export const getIngestionMeta = internalQuery({
  args: { feedUrl: v.string() },
  handler: async (ctx, { feedUrl }) => {
    return ctx.db
      .query("ingestionMeta")
      .withIndex("by_feed_url", (q) => q.eq("feedUrl", feedUrl))
      .first();
  },
});

// ---------------------------------------------------------------------------
// Internal Mutations
// ---------------------------------------------------------------------------

/** Create a source record for a new domain, using curated MBFC data from feeds.ts. */
export const createSource = internalMutation({
  args: {
    domain: v.string(),
    name: v.string(),
    baseBias: v.number(),
    reliabilityScore: v.number(),
    mbfcCategory: v.string(),
    mbfcFactual: v.optional(v.string()),
    mbfcCredibility: v.optional(v.string()),
  },
  handler: async (
    ctx,
    {
      domain,
      name,
      baseBias,
      reliabilityScore,
      mbfcCategory,
      mbfcFactual,
      mbfcCredibility,
    },
  ): Promise<Id<"sources">> => {
    return ctx.db.insert("sources", {
      domain,
      name,
      baseBias,
      reliabilityScore,
      logoUrl: `https://logo.clearbit.com/${domain}`,
      mbfcCategory,
      mbfcFactual,
      mbfcCredibility,
      mbfcLastChecked: Date.now(),
    });
  },
});

/** Insert a batch of articles. */
export const insertArticles = internalMutation({
  args: {
    articles: v.array(
      v.object({
        sourceId: v.id("sources"),
        title: v.string(),
        url: v.string(),
        canonicalUrl: v.string(),
        rssSnippet: v.optional(v.string()),
        status: v.union(
          v.literal("unprocessed"),
          v.literal("enriched"),
          v.literal("clustered"),
          v.literal("discarded"),
        ),
        publishedAt: v.number(), // Epoch ms
      }),
    ),
  },
  handler: async (ctx, { articles }) => {
    const ids: Id<"articles">[] = [];
    for (const article of articles) {
      const id = await ctx.db.insert("articles", article);
      ids.push(id);
    }
    return ids;
  },
});

/** Update or create ingestion meta for a feed. */
export const upsertIngestionMeta = internalMutation({
  args: {
    feedUrl: v.string(),
    success: v.boolean(),
    articleCount: v.number(),
    error: v.optional(v.string()),
    sourceId: v.id("sources"),
  },
  handler: async (ctx, { feedUrl, success, articleCount, error, sourceId }) => {
    const existing = await ctx.db
      .query("ingestionMeta")
      .withIndex("by_feed_url", (q) => q.eq("feedUrl", feedUrl))
      .first();

    const now = Date.now();

    if (existing) {
      await ctx.db.patch(existing._id, {
        lastIngestedAt: now,
        ...(success
          ? {
              lastSuccessAt: now,
              consecutiveFailures: 0,
              lastError: undefined,
            }
          : {
              consecutiveFailures: existing.consecutiveFailures + 1,
              lastError: error?.slice(0, 500),
            }),
        articleCount: existing.articleCount + articleCount,
      });
    } else {
      await ctx.db.insert("ingestionMeta", {
        feedUrl,
        sourceId,
        lastIngestedAt: now,
        lastSuccessAt: success ? now : undefined,
        consecutiveFailures: success ? 0 : 1,
        lastError: success ? undefined : error?.slice(0, 500),
        articleCount,
      });
    }
  },
});

// ---------------------------------------------------------------------------
// Main Ingestion Action
// ---------------------------------------------------------------------------

/**
 * Ingest a single RSS feed: fetch XML, parse articles, deduplicate, insert.
 * Called by the cron scheduler or manually for testing.
 */
export const ingestSingleFeed = internalAction({
  args: {
    feedUrl: v.string(),
    feedName: v.string(),
    feedDomain: v.string(),
    baseBias: v.number(),
    reliabilityScore: v.number(),
    mbfcCategory: v.string(),
    mbfcFactual: v.optional(v.string()),
    mbfcCredibility: v.optional(v.string()),
  },
  handler: async (
    ctx,
    {
      feedUrl,
      feedName,
      feedDomain,
      baseBias,
      reliabilityScore,
      mbfcCategory,
      mbfcFactual,
      mbfcCredibility,
    },
  ): Promise<{ inserted: number; skipped: number; error?: string }> => {
    let articlesInserted = 0;

    // Ensure source exists first — needed for all ingestionMeta updates
    const existingSource = await ctx.runQuery(
      internal.ingestion.getSourceByDomain,
      { domain: feedDomain },
    );

    const sourceId: Id<"sources"> = existingSource
      ? existingSource._id
      : await ctx.runMutation(internal.ingestion.createSource, {
          domain: feedDomain,
          name: feedName,
          baseBias,
          reliabilityScore,
          mbfcCategory,
          mbfcFactual,
          mbfcCredibility,
        });

    try {
      // 1. Fetch RSS XML
      const response = await fetch(feedUrl, {
        headers: { "User-Agent": USER_AGENT },
        signal: AbortSignal.timeout(15_000), // 15s timeout
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status} ${response.statusText}`);
      }

      const xml = await response.text();
      const parsed = parseRSSXml(xml);

      if (parsed.length === 0) {
        console.warn(`[ingestion] No articles parsed from ${feedUrl}`);
        await ctx.runMutation(internal.ingestion.upsertIngestionMeta, {
          feedUrl,
          success: true,
          articleCount: 0,
          sourceId,
        });
        return { inserted: 0, skipped: 0 };
      }

      // 2. Canonicalize URLs
      const articlesWithCanonical = parsed
        .slice(0, MAX_ARTICLES_PER_FEED)
        .map((a) => ({
          ...a,
          canonicalUrl: canonicalizeUrl(a.url),
        }));

      // 2.5 Filter out articles older than 72 hours
      const cutoffMs = Date.now() - 72 * 60 * 60 * 1000;
      const recentArticles = articlesWithCanonical.filter((a) => {
        if (!a.publishedAt) return true; // Keep articles with no date (err on side of inclusion)
        const pubTime = new Date(a.publishedAt).getTime();
        return Number.isNaN(pubTime) || pubTime > cutoffMs;
      });

      // 3. Batch dedup check
      const canonicalUrls = recentArticles.map((a) => a.canonicalUrl);
      const existingUrls = await ctx.runQuery(
        internal.ingestion.findExistingCanonicalUrls,
        { urls: canonicalUrls },
      );
      const existingSet = new Set(existingUrls);

      const newArticles = recentArticles.filter(
        (a) => !existingSet.has(a.canonicalUrl),
      );

      if (newArticles.length === 0) {
        await ctx.runMutation(internal.ingestion.upsertIngestionMeta, {
          feedUrl,
          success: true,
          articleCount: 0,
          sourceId,
        });
        return { inserted: 0, skipped: recentArticles.length };
      }

      // 4. Build article records (no placeholder summary/aiBiasScore — enrichment pipeline fills those)
      const articleRecords = newArticles.map((a) => ({
        sourceId: sourceId,
        title: a.title,
        url: a.url,
        canonicalUrl: a.canonicalUrl,
        rssSnippet: a.snippet || undefined,
        status: "unprocessed" as const,
        publishedAt: a.publishedAt
          ? new Date(a.publishedAt).getTime() || Date.now()
          : Date.now(),
      }));

      // 6. Insert articles in batches of 50 (Convex mutation limits)
      const BATCH_SIZE = 50;
      for (let i = 0; i < articleRecords.length; i += BATCH_SIZE) {
        const batch = articleRecords.slice(i, i + BATCH_SIZE);
        await ctx.runMutation(internal.ingestion.insertArticles, {
          articles: batch,
        });
        articlesInserted += batch.length;
      }

      // 7. Update feed health (with sourceId link)
      await ctx.runMutation(internal.ingestion.upsertIngestionMeta, {
        feedUrl,
        success: true,
        articleCount: articlesInserted,
        sourceId,
      });

      console.log(
        `[ingestion] ${feedName}: ${articlesInserted} new, ${existingSet.size} deduped`,
      );

      return {
        inserted: articlesInserted,
        skipped: existingSet.size,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      console.error(`[ingestion] Failed to ingest ${feedUrl}: ${message}`);

      await ctx.runMutation(internal.ingestion.upsertIngestionMeta, {
        feedUrl,
        success: false,
        articleCount: 0,
        error: message,
        sourceId,
      });

      return { inserted: 0, skipped: 0, error: message };
    }
  },
});

// ---------------------------------------------------------------------------
// Batch Ingestion — runs all feeds
// ---------------------------------------------------------------------------

/**
 * Ingest all curated feeds. This is the entry point called by the cron job.
 * Processes feeds sequentially to avoid overwhelming external servers.
 */
export const ingestAllFeeds = internalAction({
  args: {},
  handler: async (
    ctx,
  ): Promise<{
    totalInserted: number;
    feedsProcessed: number;
    failedFeeds: number;
  }> => {
    // Kill-switch: skip entire run when pipeline is paused
    const paused = await ctx.runQuery(internal.config.isPipelinePaused, {});
    if (paused) {
      console.log("[ingestion] Pipeline paused — skipping ingestAllFeeds");
      return { totalInserted: 0, feedsProcessed: 0, failedFeeds: 0 };
    }

    console.log(
      `[ingestion] Starting batch ingest of ${ALL_FEEDS.length} feeds`,
    );
    const results: Array<{
      feed: string;
      inserted: number;
      error?: string;
    }> = [];

    for (const feed of ALL_FEEDS) {
      const result = await ctx.runAction(internal.ingestion.ingestSingleFeed, {
        feedUrl: feed.url,
        feedName: feed.name,
        feedDomain: feed.domain,
        baseBias: feed.baseBias,
        reliabilityScore: feed.reliabilityScore,
        mbfcCategory: feed.mbfc.category,
        mbfcFactual: feed.mbfc.factual,
        mbfcCredibility: feed.mbfc.credibility,
      });

      results.push({
        feed: feed.name,
        inserted: result.inserted,
        error: result.error,
      });
    }

    const totalInserted = results.reduce((sum, r) => sum + r.inserted, 0);
    let failedFeeds = results.filter((r) => r.error);

    console.log(
      `[ingestion] Batch complete: ${totalInserted} articles inserted, ${failedFeeds.length} feeds failed`,
    );

    // Retry failed feeds once after a short delay (helps with transient errors)
    let retryInserted = 0;
    if (failedFeeds.length > 0) {
      console.log(`[ingestion] Retrying ${failedFeeds.length} failed feeds...`);
      await new Promise((resolve) => setTimeout(resolve, 3000));

      const failedFeedNames = new Set(failedFeeds.map((f) => f.feed));
      const feedsToRetry = ALL_FEEDS.filter((f) => failedFeedNames.has(f.name));
      const retrySuccesses = new Set<string>();

      for (const feed of feedsToRetry) {
        const retryResult = await ctx.runAction(
          internal.ingestion.ingestSingleFeed,
          {
            feedUrl: feed.url,
            feedName: feed.name,
            feedDomain: feed.domain,
            baseBias: feed.baseBias,
            reliabilityScore: feed.reliabilityScore,
            mbfcCategory: feed.mbfc.category,
            mbfcFactual: feed.mbfc.factual,
            mbfcCredibility: feed.mbfc.credibility,
          },
        );

        if (!retryResult.error) {
          retryInserted += retryResult.inserted;
          retrySuccesses.add(feed.name);
          console.log(
            `[ingestion] Retry succeeded for ${feed.name}: ${retryResult.inserted} articles`,
          );
        }
      }

      // Remove feeds that succeeded on retry
      failedFeeds = failedFeeds.filter((f) => !retrySuccesses.has(f.feed));
    }

    if (failedFeeds.length > 0) {
      console.warn(
        `[ingestion] Failed feeds: ${failedFeeds.map((f) => `${f.feed}: ${f.error}`).join("; ")}`,
      );
    }

    return {
      totalInserted: totalInserted + retryInserted,
      feedsProcessed: results.length,
      failedFeeds: failedFeeds.length,
    };
  },
});
