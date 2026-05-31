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
import { paginationOptsValidator, type PaginationResult } from "convex/server";
import {
  internalAction,
  internalMutation,
  internalQuery,
} from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { ALL_FEEDS, type FeedEntry } from "./feeds";
import { refreshEventClaimCoverage } from "./lib/eventClaimCoverage";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Max articles to ingest per feed per run (prevents runaway on first ingest) */
const MAX_ARTICLES_PER_FEED = 25;

/** User-Agent for RSS fetches. Be a good citizen. */
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36";

/** Run-level lease for ingestAllFeeds; prevents overlapping cron/manual runs. */
const INGEST_ALL_FEEDS_LOCK_KEY = "ingestAllFeeds";
const INGEST_ALL_FEEDS_LOCK_TTL_MS = 20 * 60 * 1000;
const EVENT_EMBEDDING_DIMENSIONS = 512;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ParsedArticle {
  title: string;
  url: string;
  snippet: string;
  publishedAt: string; // ISO-8601 or raw date string
  imageUrl?: string;
  imageWidth?: number;
  imageHeight?: number;
  imageAlt?: string;
  imageSource?: "rss";
}

const KNOWN_HEADLINE_SUFFIXES = [
  "Reuters",
  "AP News",
  "Associated Press",
  "BBC News",
  "PBS NewsHour",
  "ABC News",
  "CBS News",
  "NBC News",
  "CNN",
  "NPR",
  "The Hill",
  "Axios",
  "Politico",
  "Bloomberg",
  "Bloomberg.com",
  "CNBC",
  "The Guardian",
  "Fox News",
  "Financial Times",
  "The Wall Street Journal",
  "Wall Street Journal",
  "The New York Times",
  "New York Times",
  "The Washington Post",
  "Washington Post",
  "USA Today",
];

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
      const rssImage = extractFeedImage(entry, link ?? "");

      if (title && link) {
        articles.push({
          title: normalizeArticleTitle(title).slice(0, 500),
          url: link.trim(),
          snippet: normalizeArticleSnippet(snippet).slice(0, 1000),
          publishedAt,
          ...rssImage,
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
      const rssImage = extractFeedImage(item, link ?? "");

      if (title && link) {
        articles.push({
          title: normalizeArticleTitle(title).slice(0, 500),
          url: link.trim(),
          snippet: normalizeArticleSnippet(snippet).slice(0, 1000),
          publishedAt,
          ...rssImage,
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

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&#(\d+);/g, (_m, code) =>
      String.fromCharCode(Number.parseInt(code, 10)),
    );
}

function parseOptionalInteger(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function absolutizeUrl(candidate: string | undefined, baseUrl: string): string | undefined {
  if (!candidate) return undefined;
  try {
    return new URL(candidate, baseUrl).toString();
  } catch {
    return undefined;
  }
}

function isLikelyImageUrl(url: string | undefined): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    const path = parsed.pathname.toLowerCase();
    if (!/^https?:$/.test(parsed.protocol)) return false;
    return (
      /\.(avif|gif|jpe?g|png|webp|bmp)(?:$|\?)/i.test(path) ||
      path.includes("/image") ||
      path.includes("/photo") ||
      path.includes("/media")
    );
  } catch {
    return false;
  }
}

function extractAttribute(tag: string, attribute: string): string | undefined {
  const patterns = [
    new RegExp(`${attribute}=["']([^"']+)["']`, "i"),
    new RegExp(`${attribute}=([^\\s>]+)`, "i"),
  ];
  for (const pattern of patterns) {
    const match = tag.match(pattern);
    const value = match?.[1]?.trim();
    if (value) return decodeHtmlEntities(value);
  }
  return undefined;
}

function extractImageFromHtmlSnippet(
  html: string,
  articleUrl: string,
): Pick<
  ParsedArticle,
  "imageUrl" | "imageWidth" | "imageHeight" | "imageAlt" | "imageSource"
> {
  const matches = Array.from(html.matchAll(/<img\b[^>]*>/gi));
  for (const match of matches) {
    const tag = match[0];
    const src =
      extractAttribute(tag, "src") ?? extractAttribute(tag, "data-src");
    const imageUrl = absolutizeUrl(src, articleUrl);
    if (!imageUrl || !isLikelyImageUrl(imageUrl)) continue;

    return {
      imageUrl,
      imageWidth: parseOptionalInteger(extractAttribute(tag, "width")),
      imageHeight: parseOptionalInteger(extractAttribute(tag, "height")),
      imageAlt: extractAttribute(tag, "alt") ?? extractAttribute(tag, "title"),
      imageSource: "rss",
    };
  }

  return {};
}

function extractFeedImage(
  itemXml: string,
  articleUrl: string,
): Pick<
  ParsedArticle,
  "imageUrl" | "imageWidth" | "imageHeight" | "imageAlt" | "imageSource"
> {
  const patterns = [
    /<media:content\b[^>]*url=["']([^"']+)["'][^>]*>/i,
    /<media:thumbnail\b[^>]*url=["']([^"']+)["'][^>]*>/i,
    /<enclosure\b[^>]*type=["']image\/[^"']+["'][^>]*url=["']([^"']+)["'][^>]*>/i,
    /<enclosure\b[^>]*url=["']([^"']+)["'][^>]*type=["']image\/[^"']+["'][^>]*>/i,
  ];

  for (const pattern of patterns) {
    const match = itemXml.match(pattern);
    const tag = match?.[0];
    const imageUrl = absolutizeUrl(match?.[1], articleUrl);
    if (!tag || !imageUrl || !isLikelyImageUrl(imageUrl)) continue;

    return {
      imageUrl,
      imageWidth: parseOptionalInteger(extractAttribute(tag, "width")),
      imageHeight: parseOptionalInteger(extractAttribute(tag, "height")),
      imageAlt: extractAttribute(tag, "alt") ?? extractAttribute(tag, "title"),
      imageSource: "rss",
    };
  }

  const htmlImage = extractImageFromHtmlSnippet(itemXml, articleUrl);
  if (htmlImage.imageUrl) {
    return htmlImage;
  }

  return {};
}

/** Strip HTML tags and decode common entities. */
function stripHtml(text: string): string {
  return decodeHtmlEntities(text)
    .replace(/<a\s+href=["'][^"']*["']?/gi, " ")
    .replace(/<\/?a>/gi, " ")
    .replace(/<[^>\n]*$/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/www\.\S+/gi, " ")
    .replace(/\bView Full Coverage on Google News\b/gi, " ")
    .replace(/\bRead more\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeArticleTitle(title: string): string {
  const cleaned = stripHtml(title).replace(/\s+/g, " ").trim();
  for (const suffix of KNOWN_HEADLINE_SUFFIXES) {
    const escapedSuffix = suffix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const suffixPattern = new RegExp(`\\s+-\\s+${escapedSuffix}$`, "i");
    if (suffixPattern.test(cleaned)) {
      return cleaned.replace(suffixPattern, "").trim();
    }
  }
  return cleaned;
}

export function normalizeArticleSnippet(snippet: string): string {
  return stripHtml(snippet)
    .replace(/\s*[•·]\s*/g, " ")
    .replace(/\b[A-Z]{2,5}\s*-\s*/g, " ")
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
    url.protocol = "https:";
    url.hostname = normalizeCanonicalHostname(url.hostname);
    url.pathname = normalizeCanonicalPath(url.pathname);

    // Remove common tracking/session params. Keep unknown params because some
    // publishers use query strings as stable article identifiers.
    const trackingParams = [
      "utm_source",
      "utm_medium",
      "utm_campaign",
      "utm_term",
      "utm_content",
      "utm_name",
      "utm_cid",
      "utm_reader",
      "utm_viz_id",
      "utm_pubreferrer",
      "utm_swu",
      "fbclid",
      "gclid",
      "dclid",
      "mc_cid",
      "mc_eid",
      "mkt_tok",
    ];
    for (const param of trackingParams) {
      url.searchParams.delete(param);
    }
    for (const param of Array.from(url.searchParams.keys())) {
      if (param.toLowerCase().startsWith("utm_")) {
        url.searchParams.delete(param);
      }
    }
    url.searchParams.sort();
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

function normalizeCanonicalHostname(hostname: string): string {
  let host = hostname.toLowerCase();
  host = host.replace(/^(www|m|mobile|amp)\./, "");
  host = host.replace(/^edition\./, "");

  const aliases: Record<string, string> = {
    "bbc.co.uk": "bbc.com",
    "www.bbc.co.uk": "bbc.com",
    "edition.cnn.com": "cnn.com",
    "m.cnn.com": "cnn.com",
    "amp.cnn.com": "cnn.com",
  };

  return aliases[host] ?? host;
}

function normalizeCanonicalPath(pathname: string): string {
  let path = pathname.replace(/\/+/g, "/");
  path = path.replace(/\/amp\/?$/i, "");
  path = path.replace(/\/amp(?=\/)/i, "");
  path = path.replace(/\.amp\.html$/i, ".html");
  return path || "/";
}

function normalizeFingerprintText(value: string): string {
  return normalizeArticleSnippet(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function stableStringHash(value: string): string {
  let hashA = 2166136261;
  let hashB = 0x811c9dc5 ^ 0x9e3779b9;
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    hashA ^= code;
    hashA = Math.imul(hashA, 16777619);
    hashB ^= code + i;
    hashB = Math.imul(hashB, 16777619);
  }
  return `${(hashA >>> 0).toString(36)}${(hashB >>> 0).toString(36)}`;
}

function articleContentFingerprint(article: Pick<ParsedArticle, "title" | "snippet">): string {
  const fingerprintText = [
    normalizeFingerprintText(article.title),
    normalizeFingerprintText(article.snippet).slice(0, 600),
  ]
    .filter(Boolean)
    .join(" ");
  return stableStringHash(fingerprintText);
}

function feedFingerprint(
  articles: Array<{ canonicalUrl: string; contentFingerprint: string }>,
) {
  return stableStringHash(
    articles
      .map((article) => `${article.canonicalUrl}:${article.contentFingerprint}`)
      .sort()
      .join("|"),
  );
}

function parsePublishedAt(raw: string): number | undefined {
  if (!raw.trim()) return undefined;
  const parsed = new Date(raw).getTime();
  return Number.isFinite(parsed) ? parsed : undefined;
}

function toEventEmbedding(articleEmbedding: number[]): number[] {
  const padded = new Array(EVENT_EMBEDDING_DIMENSIONS).fill(0);
  const limit = Math.min(articleEmbedding.length, EVENT_EMBEDDING_DIMENSIONS);
  for (let i = 0; i < limit; i++) {
    padded[i] = articleEmbedding[i]!;
  }
  return padded;
}

function formatUtcDayBucket(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 10);
}

function buildEventEmbeddingFilterFields(args: {
  status?: "processing" | "published";
  lastArticleAt: number;
  articleCount: number;
  referenceTime?: number;
}) {
  const referenceTime = args.referenceTime ?? Date.now();
  const recentWindowBucket =
    referenceTime - args.lastArticleAt <= 48 * 60 * 60 * 1000
      ? "recent_2d"
      : "stale";
  const singletonBucket = args.articleCount <= 2 ? "singleton" : "multi";
  const updatedDayBucket = formatUtcDayBucket(args.lastArticleAt);
  const status = args.status ?? "processing";
  return {
    recentWindowBucket,
    singletonBucket,
    updatedDayBucket,
    mergeSearchBucket: `${status}::${recentWindowBucket}::${updatedDayBucket}`,
    singletonSearchBucket: `${status}::${singletonBucket}::${updatedDayBucket}`,
  };
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

export const findExistingContentFingerprints = internalQuery({
  args: {
    sourceId: v.id("sources"),
    fingerprints: v.array(v.string()),
  },
  handler: async (ctx, { sourceId, fingerprints }) => {
    const unique = Array.from(new Set(fingerprints.filter(Boolean)));
    const existing = await Promise.all(
      unique.map(async (fingerprint) => {
        const article = await ctx.db
          .query("articles")
          .withIndex("by_source_content_fingerprint", (q) =>
            q.eq("sourceId", sourceId).eq("contentFingerprint", fingerprint),
          )
          .first();
        return article ? fingerprint : null;
      }),
    );
    return existing.filter((fingerprint) => fingerprint !== null);
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

/** Atomically find or create a source for a feed domain. */
export const getOrCreateSource = internalMutation({
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
    const existing = await ctx.db
      .query("sources")
      .withIndex("by_domain", (q) => q.eq("domain", domain))
      .first();
    if (existing) return existing._id;

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
    skipDuplicateChecks: v.optional(v.boolean()),
    articles: v.array(
      v.object({
        sourceId: v.id("sources"),
        title: v.string(),
        url: v.string(),
        canonicalUrl: v.string(),
        contentFingerprint: v.optional(v.string()),
        rssSnippet: v.optional(v.string()),
        imageUrl: v.optional(v.string()),
        imageWidth: v.optional(v.number()),
        imageHeight: v.optional(v.number()),
        imageAlt: v.optional(v.string()),
        imageSource: v.optional(v.literal("rss")),
        status: v.union(
          v.literal("unprocessed"),
          v.literal("enriched"),
          v.literal("clustered"),
          v.literal("discarded"),
          v.literal("archived"),
        ),
        publishedAt: v.number(), // Epoch ms
      }),
    ),
  },
  handler: async (ctx, { articles, skipDuplicateChecks }) => {
    const ids: Id<"articles">[] = [];
    for (const article of articles) {
      if (!skipDuplicateChecks) {
        const existingCanonical = await ctx.db
          .query("articles")
          .withIndex("by_canonical_url", (q) =>
            q.eq("canonicalUrl", article.canonicalUrl),
          )
          .first();
        if (existingCanonical) continue;

        if (article.contentFingerprint) {
          const existingFingerprint = await ctx.db
            .query("articles")
            .withIndex("by_source_content_fingerprint", (q) =>
              q
                .eq("sourceId", article.sourceId)
                .eq("contentFingerprint", article.contentFingerprint),
            )
            .first();
          if (existingFingerprint) continue;
        }
      }

      const id = await ctx.db.insert("articles", article);
      ids.push(id);
    }
    return ids;
  },
});

async function recomputeEventEmbeddingForEvent(
  ctx: MutationCtx,
  eventId: Id<"events">,
): Promise<void> {
  const event = await ctx.db.get(eventId);
  if (!event) return;

  const articles = await ctx.db
    .query("articles")
    .withIndex("by_event", (q) => q.eq("eventId", eventId))
    .collect();

  if (articles.length === 0) {
    const existingRows = await ctx.db
      .query("eventEmbeddings")
      .withIndex("by_event", (q) => q.eq("eventId", eventId))
      .collect();
    for (const row of existingRows) {
      await ctx.db.delete(row._id);
    }
    return;
  }

  const embeddingRows = await Promise.all(
    articles.map(async (article) => {
      const rows = await ctx.db
        .query("articleEmbeddings")
        .withIndex("by_article", (q) => q.eq("articleId", article._id))
        .collect();
      return (
        rows.sort(
          (a, b) => b.version - a.version || b._creationTime - a._creationTime,
        )[0] ?? null
      );
    }),
  );

  const embeddings = embeddingRows
    .filter((row): row is NonNullable<typeof row> => row !== null)
    .map((row) => row.embedding);

  if (embeddings.length === 0) {
    const existingRows = await ctx.db
      .query("eventEmbeddings")
      .withIndex("by_event", (q) => q.eq("eventId", eventId))
      .collect();
    for (const row of existingRows) {
      await ctx.db.delete(row._id);
    }
    return;
  }

  const normalizedEmbeddings = embeddings.map(toEventEmbedding);
  const sums = new Array(EVENT_EMBEDDING_DIMENSIONS).fill(0);
  for (const embedding of normalizedEmbeddings) {
    for (let i = 0; i < EVENT_EMBEDDING_DIMENSIONS; i++) {
      sums[i] += embedding[i] ?? 0;
    }
  }

  const averagedEmbedding = sums.map((sum) => sum / normalizedEmbeddings.length);
  const latestVersion = embeddingRows.reduce(
    (max, row) => (row && row.version > max ? row.version : max),
    0,
  );

  const existingRow = await ctx.db
    .query("eventEmbeddings")
    .withIndex("by_event", (q) => q.eq("eventId", eventId))
    .first();

  if (existingRow) {
    await ctx.db.patch(existingRow._id, {
      embedding: averagedEmbedding,
      version: latestVersion,
      status: event.status,
      ...buildEventEmbeddingFilterFields({
        status: event.status,
        lastArticleAt: event.lastArticleAt ?? event.firstPublishedAt,
        articleCount: event.articleCount ?? articles.length,
      }),
    });
  } else {
    await ctx.db.insert("eventEmbeddings", {
      eventId,
      embedding: averagedEmbedding,
      version: latestVersion,
      status: event.status,
      ...buildEventEmbeddingFilterFields({
        status: event.status,
        lastArticleAt: event.lastArticleAt ?? event.firstPublishedAt,
        articleCount: event.articleCount ?? articles.length,
      }),
    });
  }
}

export const recomputeEventEmbeddingForEventInternal = internalMutation({
  args: {
    eventId: v.id("events"),
  },
  handler: async (ctx, { eventId }) => {
    await recomputeEventEmbeddingForEvent(ctx, eventId);
    return { recomputed: true as const };
  },
});

export const getEventsForEmbeddingBackfill = internalQuery({
  args: {
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, { paginationOpts }) => {
    return (await ctx.db
      .query("events")
      .order("desc")
      .paginate(paginationOpts)) as PaginationResult<{ _id: Id<"events"> }>;
  },
});

export const backfillEventEmbeddingDimensions = internalAction({
  args: {
    cursor: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { cursor, limit }) => {
    const cfg = await ctx.runQuery(internal.config.getBatch, {
      keys: ["backfill_enabled"],
    });
    if (cfg.backfill_enabled !== true) {
      console.log(
        "[ingestion] backfillEventEmbeddingDimensions skipped: backfill_enabled is false",
      );
      return {
        processed: 0,
        continueCursor: cursor ?? null,
        isDone: true,
        reason: "backfill_disabled",
      };
    }
    const pageSize = Math.min(Math.max(Math.floor(limit ?? 100), 1), 200);
    const page: PaginationResult<{ _id: Id<"events"> }> = await ctx.runQuery(
      internal.ingestion.getEventsForEmbeddingBackfill,
      {
        paginationOpts: {
          cursor: cursor ?? null,
          numItems: pageSize,
        },
      },
    );

    for (const event of page.page) {
      await ctx.runMutation(
        internal.ingestion.recomputeEventEmbeddingForEventInternal,
        {
          eventId: event._id,
        },
      );
    }

    return {
      processed: page.page.length,
      continueCursor: page.continueCursor ?? null,
      isDone: page.isDone,
    };
  },
});

export const cleanupDuplicateArticlesInEvents = internalMutation({
  args: {
    limit: v.optional(v.number()),
    dryRun: v.optional(v.boolean()),
    maxPublishedDeltaMs: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const safeLimit = Math.max(1, Math.min(500, Math.floor(args.limit ?? 100)));
    const dryRun = args.dryRun ?? true;
    const maxPublishedDeltaMs = Math.max(
      60_000,
      Math.min(
        7 * 24 * 60 * 60 * 1000,
        Math.floor(args.maxPublishedDeltaMs ?? 24 * 60 * 60 * 1000),
      ),
    );
    const [publishedEvents, processingEvents] = await Promise.all([
      ctx.db
        .query("events")
        .withIndex("by_status_recency", (q) => q.eq("status", "published"))
        .order("desc")
        .take(safeLimit),
      ctx.db
        .query("events")
        .withIndex("by_status_recency", (q) => q.eq("status", "processing"))
        .order("desc")
        .take(safeLimit),
    ]);
    const events = [...publishedEvents, ...processingEvents]
      .sort(
        (a, b) =>
          b.firstPublishedAt - a.firstPublishedAt ||
          b._creationTime - a._creationTime,
      )
      .slice(0, safeLimit);

    let inspectedEvents = 0;
    let duplicateArticles = 0;
    let deletedArticles = 0;
    const touchedEventIds = new Set<Id<"events">>();

    for (const event of events) {
      inspectedEvents++;
      const articles = await ctx.db
        .query("articles")
        .withIndex("by_event", (q) => q.eq("eventId", event._id))
        .collect();
      const groups = new Map<string, typeof articles>();
      for (const article of articles) {
        const normalizedTitle = normalizeFingerprintText(article.title);
        if (normalizedTitle.length === 0) continue;
        const key = `${article.sourceId}:${normalizedTitle}`;
        const group = groups.get(key) ?? [];
        group.push(article);
        groups.set(key, group);
      }

      for (const group of groups.values()) {
        if (group.length < 2) continue;
        const sorted = [...group].sort(
          (a, b) =>
            a.publishedAt - b.publishedAt || a._creationTime - b._creationTime,
        );
        const keeper = sorted[0]!;
        for (const duplicate of sorted.slice(1)) {
          if (
            Math.abs(duplicate.publishedAt - keeper.publishedAt) >
            maxPublishedDeltaMs
          ) {
            continue;
          }
          duplicateArticles++;
          touchedEventIds.add(event._id);
          if (dryRun) continue;

          const embeddingRows = await ctx.db
            .query("articleEmbeddings")
            .withIndex("by_article", (q) => q.eq("articleId", duplicate._id))
            .collect();
          for (const row of embeddingRows) {
            await ctx.db.delete(row._id);
          }
          await ctx.db.delete(duplicate._id);
          deletedArticles++;
        }
      }
    }

    if (!dryRun) {
      for (const eventId of touchedEventIds) {
        await recomputeEventEmbeddingForEvent(ctx, eventId);
        await refreshEventClaimCoverage(ctx, eventId);
        await ctx.runMutation(internal.clustering.refreshEventPresentationById, {
          eventId,
        });
      }
    }

    return {
      inspectedEvents,
      duplicateArticles,
      deletedArticles,
      touchedEvents: touchedEventIds.size,
      dryRun,
    };
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
    feedFingerprint: v.optional(v.string()),
  },
  handler: async (
    ctx,
    { feedUrl, success, articleCount, error, sourceId, feedFingerprint },
  ) => {
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
        ...(feedFingerprint !== undefined && {
          lastFeedFingerprint: feedFingerprint,
        }),
      });
    } else {
      await ctx.db.insert("ingestionMeta", {
        feedUrl,
        sourceId,
        lastFeedFingerprint: feedFingerprint,
        lastIngestedAt: now,
        lastSuccessAt: success ? now : undefined,
        consecutiveFailures: success ? 0 : 1,
        lastError: success ? undefined : error?.slice(0, 500),
        articleCount,
      });
    }
  },
});

/** Acquire a short-lived run lock if no live owner currently holds it. */
export const acquirePipelineLock = internalMutation({
  args: {
    key: v.string(),
    owner: v.string(),
    expiresAt: v.number(),
  },
  handler: async (ctx, { key, owner, expiresAt }) => {
    const now = Date.now();
    const existing = await ctx.db
      .query("pipelineLocks")
      .withIndex("by_key", (q) => q.eq("key", key))
      .unique();

    if (existing && existing.expiresAt > now) {
      return {
        acquired: false,
        owner: existing.owner,
        expiresAt: existing.expiresAt,
      };
    }

    if (existing) {
      await ctx.db.patch(existing._id, {
        owner,
        acquiredAt: now,
        updatedAt: now,
        expiresAt,
      });
    } else {
      await ctx.db.insert("pipelineLocks", {
        key,
        owner,
        acquiredAt: now,
        updatedAt: now,
        expiresAt,
      });
    }

    return { acquired: true, owner, expiresAt };
  },
});

/** Release a run lock only if this run still owns it. */
export const releasePipelineLock = internalMutation({
  args: {
    key: v.string(),
    owner: v.string(),
  },
  handler: async (ctx, { key, owner }) => {
    const existing = await ctx.db
      .query("pipelineLocks")
      .withIndex("by_key", (q) => q.eq("key", key))
      .unique();

    if (!existing || existing.owner !== owner) {
      return { released: false };
    }

    await ctx.db.delete(existing._id);
    return { released: true };
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
    let sourceId: Id<"sources"> | null = null;

    try {
      // Ensure source exists first — needed for ingestionMeta updates.
      const resolvedSourceId: Id<"sources"> = await ctx.runMutation(
        internal.ingestion.getOrCreateSource,
        {
          domain: feedDomain,
          name: feedName,
          baseBias,
          reliabilityScore,
          mbfcCategory,
          mbfcFactual,
          mbfcCredibility,
        },
      );
      sourceId = resolvedSourceId;

      // 1. Fetch RSS XML
      const response = await fetch(feedUrl, {
        headers: {
          "User-Agent": USER_AGENT,
          Accept:
            "application/rss+xml,application/xml,text/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9",
          Referer: "https://www.google.com/",
          "Cache-Control": "no-cache",
          Pragma: "no-cache",
        },
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
          sourceId: resolvedSourceId,
        });
        return { inserted: 0, skipped: 0 };
      }

      // 2. Canonicalize URLs
      const articlesWithCanonical = parsed
        .slice(0, MAX_ARTICLES_PER_FEED)
        .map((a) => ({
          ...a,
          canonicalUrl: canonicalizeUrl(a.url),
          contentFingerprint: articleContentFingerprint(a),
          parsedPublishedAt: parsePublishedAt(a.publishedAt),
        }));

      // 2.5 Filter out articles older than 72 hours
      const cutoffMs = Date.now() - 72 * 60 * 60 * 1000;
      const recentArticles = articlesWithCanonical.filter((a) => {
        if (!a.publishedAt) return true; // Keep dateless feed entries, but do not rescue malformed dates.
        return a.parsedPublishedAt !== undefined && a.parsedPublishedAt > cutoffMs;
      });

      // 3. Batch dedup check
      const dedupedRecentArticles = Array.from(
        new Map(
          Array.from(
            new Map(recentArticles.map((a) => [a.canonicalUrl, a])).values(),
          ).map((a) => [a.contentFingerprint, a]),
        ).values(),
      );
      const currentFeedFingerprint = feedFingerprint(dedupedRecentArticles);
      const previousMeta = await ctx.runQuery(internal.ingestion.getIngestionMeta, {
        feedUrl,
      });
      if (
        previousMeta?.lastFeedFingerprint === currentFeedFingerprint &&
        previousMeta.consecutiveFailures === 0
      ) {
        await ctx.runMutation(internal.ingestion.upsertIngestionMeta, {
          feedUrl,
          success: true,
          articleCount: 0,
          sourceId: resolvedSourceId,
          feedFingerprint: currentFeedFingerprint,
        });
        return { inserted: 0, skipped: recentArticles.length };
      }
      const canonicalUrls = dedupedRecentArticles.map((a) => a.canonicalUrl);
      const existingUrls = await ctx.runQuery(
        internal.ingestion.findExistingCanonicalUrls,
        { urls: canonicalUrls },
      );
      const existingSet = new Set(existingUrls);
      const existingFingerprints = await ctx.runQuery(
        internal.ingestion.findExistingContentFingerprints,
        {
          sourceId: resolvedSourceId,
          fingerprints: dedupedRecentArticles.map(
            (a) => a.contentFingerprint,
          ),
        },
      );
      const existingFingerprintSet = new Set(existingFingerprints);

      const newArticles = dedupedRecentArticles.filter(
        (a) =>
          !existingSet.has(a.canonicalUrl) &&
          !existingFingerprintSet.has(a.contentFingerprint),
      );
      const skippedArticles = recentArticles.length - newArticles.length;

      if (newArticles.length === 0) {
        await ctx.runMutation(internal.ingestion.upsertIngestionMeta, {
          feedUrl,
          success: true,
          articleCount: 0,
          sourceId: resolvedSourceId,
          feedFingerprint: currentFeedFingerprint,
        });
        return { inserted: 0, skipped: skippedArticles };
      }

      // 4. Build article records (no placeholder summary/aiBiasScore — enrichment pipeline fills those)
      const articleRecords = newArticles.map((a) => ({
        sourceId: resolvedSourceId,
        title: a.title,
        url: a.url,
        canonicalUrl: a.canonicalUrl,
        contentFingerprint: a.contentFingerprint,
        rssSnippet: a.snippet || undefined,
        imageUrl: a.imageUrl,
        imageWidth: a.imageWidth,
        imageHeight: a.imageHeight,
        imageAlt: a.imageAlt,
        imageSource: a.imageSource,
        status: "unprocessed" as const,
        publishedAt: a.parsedPublishedAt ?? Date.now(),
      }));

      // 6. Insert articles in batches of 50 (Convex mutation limits)
      const BATCH_SIZE = 50;
      for (let i = 0; i < articleRecords.length; i += BATCH_SIZE) {
        const batch = articleRecords.slice(i, i + BATCH_SIZE);
        const insertedIds = await ctx.runMutation(
          internal.ingestion.insertArticles,
          {
            articles: batch,
            skipDuplicateChecks: true,
          },
        );
        articlesInserted += insertedIds.length;
      }

      // 7. Update feed health (with sourceId link)
        await ctx.runMutation(internal.ingestion.upsertIngestionMeta, {
          feedUrl,
          success: true,
          articleCount: articlesInserted,
          sourceId: resolvedSourceId,
          feedFingerprint: currentFeedFingerprint,
        });

      console.log(
        `[ingestion] ${feedName}: ${articlesInserted} new, ${skippedArticles} skipped`,
      );

      return {
        inserted: articlesInserted,
        skipped: skippedArticles,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      console.error(`[ingestion] Failed to ingest ${feedUrl}: ${message}`);

      if (sourceId) {
        await ctx.runMutation(internal.ingestion.upsertIngestionMeta, {
          feedUrl,
          success: false,
          articleCount: 0,
          error: message,
          sourceId,
        });
      }

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
    const startedAt = Date.now();
    const runId = `ingestAllFeeds-${startedAt}`;
    const lockOwner = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const lock = await ctx.runMutation(internal.ingestion.acquirePipelineLock, {
      key: INGEST_ALL_FEEDS_LOCK_KEY,
      owner: lockOwner,
      expiresAt: startedAt + INGEST_ALL_FEEDS_LOCK_TTL_MS,
    });

    if (!lock.acquired) {
      console.log(
        `[ingestion] ingestAllFeeds already running (owner=${lock.owner}, expiresAt=${new Date(lock.expiresAt).toISOString()})`,
      );
      await ctx.runMutation(internal.pipeline.insertRunLog, {
        jobName: "ingestAllFeeds",
        runId,
        startedAt,
        finishedAt: Date.now(),
        durationMs: Date.now() - startedAt,
        status: "skipped",
        counters: {},
        gauges: { reason: "lock_held" },
        metadata: {},
      });
      return { totalInserted: 0, feedsProcessed: 0, failedFeeds: 0 };
    }

    try {
      // Kill-switch: skip entire run when pipeline is paused
      const paused = await ctx.runQuery(internal.config.isPipelinePaused, {});
      if (paused) {
        console.log("[ingestion] Pipeline paused — skipping ingestAllFeeds");
        await ctx.runMutation(internal.pipeline.insertRunLog, {
          jobName: "ingestAllFeeds",
          runId,
          startedAt,
          finishedAt: Date.now(),
          durationMs: Date.now() - startedAt,
          status: "skipped",
          counters: {},
          gauges: { reason: "pipeline_paused" },
          metadata: {},
        });
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
        console.log(
          `[ingestion] Retrying ${failedFeeds.length} failed feeds...`,
        );
        await new Promise((resolve) => setTimeout(resolve, 3000));

        const failedFeedNames = new Set(failedFeeds.map((f) => f.feed));
        const feedsToRetry = ALL_FEEDS.filter((f) =>
          failedFeedNames.has(f.name),
        );
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

      const insertedTotal = totalInserted + retryInserted;
      if (insertedTotal > 0) {
        await ctx.scheduler.runAfter(
          60_000,
          internal.enrichmentNode.enrichUnprocessedArticles,
          {},
        );
      }

      const finishedAt = Date.now();
      await ctx.runMutation(internal.pipeline.insertRunLog, {
        jobName: "ingestAllFeeds",
        runId,
        startedAt,
        finishedAt,
        durationMs: finishedAt - startedAt,
        status: failedFeeds.length > 0 ? "degraded" : "ok",
        counters: {
          feedsProcessed: results.length,
          failedFeeds: failedFeeds.length,
          insertedArticles: insertedTotal,
          retryInsertedArticles: retryInserted,
        },
        gauges: {
          scheduledEnrichment: insertedTotal > 0,
        },
        metadata: {},
      });

      return {
        totalInserted: insertedTotal,
        feedsProcessed: results.length,
        failedFeeds: failedFeeds.length,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      await ctx.runMutation(internal.pipeline.insertRunLog, {
        jobName: "ingestAllFeeds",
        runId,
        startedAt,
        finishedAt: Date.now(),
        durationMs: Date.now() - startedAt,
        status: "error",
        errorMessage,
        counters: {},
        gauges: {},
        metadata: {},
      });
      throw error;
    } finally {
      try {
        await ctx.runMutation(internal.ingestion.releasePipelineLock, {
          key: INGEST_ALL_FEEDS_LOCK_KEY,
          owner: lockOwner,
        });
      } catch (error) {
        console.error(
          `[ingestion] Failed to release ingestAllFeeds lock: ${error instanceof Error ? error.message : "Unknown error"}`,
        );
      }
    }
  },
});
