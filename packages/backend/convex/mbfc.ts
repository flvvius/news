/**
 * MBFC (Media Bias/Fact Check) Data API integration — Phase 3.2
 *
 * Uses the MBFC Data API via RapidAPI to enrich sources with:
 *  - Political lean (left, left-center, center, right-center, right)
 *  - Factual reporting grade
 *  - Credibility rating
 *
 * Bias ratings are cached in the `sources` table and refreshed weekly
 * (they change infrequently). This replaces hand-coded political mappings
 * with a defensible third-party taxonomy.
 *
 * Environment variables:
 *  - RAPIDAPI_KEY: Your RapidAPI key for the MBFC Data API
 */

import { v } from "convex/values";
import {
  internalAction,
  internalMutation,
  internalQuery,
} from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MBFC_API_HOST = "media-bias-fact-check-api.p.rapidapi.com";
const MBFC_API_BASE = `https://${MBFC_API_HOST}`;

/** How often to refresh MBFC data (7 days in milliseconds) */
const MBFC_REFRESH_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;

/** Number of source records to inspect per MBFC enrichment run. */
const MBFC_SOURCE_BATCH_SIZE = 40;

// ---------------------------------------------------------------------------
// MBFC API Types
// ---------------------------------------------------------------------------

interface MBFCSearchResult {
  name: string;
  domain?: string;
  bias_rating?: string;
  factual_reporting?: string;
  credibility_rating?: string;
  country?: string;
  media_type?: string;
  traffic_popularity?: string;
  mbfc_credibility_rating?: string;
}

type MBFCLookupResult =
  | { found: true; data: MBFCSearchResult }
  | { found: false };

// ---------------------------------------------------------------------------
// MBFC Bias → Numeric Mapping
// ---------------------------------------------------------------------------

/**
 * Map MBFC bias categories to numeric baseBias (-5 to +5).
 * This is the core mapping that replaces hand-coded political labeling.
 */
const MBFC_BIAS_TO_NUMERIC: Record<string, number | null> = {
  left: -4,
  "left-center": -2,
  center: 0,
  "least-biased": 0,
  "pro-science": 0,
  "right-center": 2,
  right: 4,
  "extreme-left": -5,
  "extreme-right": 5,
  // These categories are unreliable — null signals "do not map to a bias score"
  questionable: null,
  satire: null,
  "conspiracy-pseudoscience": null,
};

/**
 * Map MBFC factual reporting to reliabilityScore (1-10).
 */
const MBFC_FACTUAL_TO_RELIABILITY: Record<string, number> = {
  "very-high": 9,
  high: 8,
  "mostly-factual": 7,
  mixed: 5,
  low: 3,
  "very-low": 1,
};

function normalizeBiasCategory(raw: string | undefined): string {
  if (!raw) return "unrated";
  return raw.toLowerCase().trim().replace(/\s+/g, "-");
}

function normalizeFactualRating(raw: string | undefined): string {
  if (!raw) return "unknown";
  return raw.toLowerCase().trim().replace(/\s+/g, "-");
}

// ---------------------------------------------------------------------------
// Internal Queries
// ---------------------------------------------------------------------------

/** Find sources that need MBFC enrichment (unrated or stale). */
export const getSourcesNeedingMbfc = internalQuery({
  args: {
    limit: v.optional(v.number()),
    uncheckedCursor: v.optional(v.union(v.string(), v.null())),
    staleCursor: v.optional(v.union(v.string(), v.null())),
  },
  handler: async (ctx, { limit, uncheckedCursor, staleCursor }) => {
    const batchSize = Math.max(
      1,
      Math.floor(limit ?? MBFC_SOURCE_BATCH_SIZE),
    );
    const cutoff = Date.now() - MBFC_REFRESH_INTERVAL_MS;

    const unchecked = await ctx.db
      .query("sources")
      .withIndex("by_mbfc_last_checked", (q) =>
        q.eq("mbfcLastChecked", undefined),
      )
      .paginate({
        numItems: batchSize,
        cursor: uncheckedCursor ?? null,
      });

    let sources = unchecked.page;
    let staleDone = false;
    let nextStaleCursor = staleCursor ?? null;

    const remaining = batchSize - sources.length;
    if (remaining > 0) {
      const stale = await ctx.db
        .query("sources")
        .withIndex("by_mbfc_last_checked", (q) =>
          q.gt("mbfcLastChecked", 0).lte("mbfcLastChecked", cutoff),
        )
        .paginate({
          numItems: remaining,
          cursor: staleCursor ?? null,
        });

      sources = [...sources, ...stale.page];
      staleDone = stale.isDone;
      nextStaleCursor = stale.continueCursor;
    }

    return {
      sources,
      uncheckedCursor: unchecked.continueCursor,
      staleCursor: nextStaleCursor,
      uncheckedDone: unchecked.isDone,
      staleDone,
    };
  },
});

// ---------------------------------------------------------------------------
// Internal Mutations
// ---------------------------------------------------------------------------

/** Update a source with MBFC data. */
export const updateSourceMbfc = internalMutation({
  args: {
    sourceId: v.id("sources"),
    baseBias: v.number(),
    reliabilityScore: v.number(),
    mbfcCategory: v.string(),
    mbfcFactual: v.string(),
    mbfcCredibility: v.optional(v.string()),
  },
  handler: async (
    ctx,
    {
      sourceId,
      baseBias,
      reliabilityScore,
      mbfcCategory,
      mbfcFactual,
      mbfcCredibility,
    },
  ) => {
    await ctx.db.patch(sourceId, {
      baseBias,
      reliabilityScore,
      mbfcCategory,
      mbfcFactual,
      mbfcCredibility,
      mbfcLastChecked: Date.now(),
    });
  },
});

/** Mark a source as checked but unrated (domain not found in MBFC). */
export const markSourceUnrated = internalMutation({
  args: { sourceId: v.id("sources") },
  handler: async (ctx, { sourceId }) => {
    await ctx.db.patch(sourceId, {
      mbfcCategory: "unrated",
      mbfcLastChecked: Date.now(),
    });
  },
});

// ---------------------------------------------------------------------------
// MBFC API Lookup Action
// ---------------------------------------------------------------------------

/**
 * Look up a single domain against the MBFC Data API.
 * Returns found=false only when the domain is legitimately absent from MBFC.
 * API/config/transient failures throw so callers do not mark sources unrated.
 */
export const lookupDomain = internalAction({
  args: { domain: v.string() },
  handler: async (_ctx, { domain }): Promise<MBFCLookupResult> => {
    const apiKey = process.env.RAPIDAPI_KEY;
    if (!apiKey) {
      throw new Error("RAPIDAPI_KEY not set; skipping MBFC lookup");
    }

    try {
      const response = await fetch(
        `${MBFC_API_BASE}/search/${encodeURIComponent(domain)}`,
        {
          method: "GET",
          headers: {
            "x-rapidapi-key": apiKey,
            "x-rapidapi-host": MBFC_API_HOST,
          },
          signal: AbortSignal.timeout(10_000),
        },
      );

      if (response.status === 404) {
        return { found: false }; // Domain not in MBFC database
      }

      if (!response.ok) {
        throw new Error(`MBFC API error for ${domain}: HTTP ${response.status}`);
      }

      const data = await response.json();

      // The API may return an array of results — find the best match
      if (Array.isArray(data)) {
        // Find exact domain match first
        const exactMatch = data.find(
          (r: MBFCSearchResult) =>
            r.domain?.toLowerCase().replace(/^www\./, "") ===
            domain.toLowerCase(),
        );
        const match = exactMatch ?? data[0];
        return match ? { found: true, data: match } : { found: false };
      }

      if (!data) {
        return { found: false };
      }

      return { found: true, data: data as MBFCSearchResult };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      console.error(`[mbfc] Failed to lookup ${domain}: ${message}`);
      throw error;
    }
  },
});

// ---------------------------------------------------------------------------
// Enrichment Action — Enrich a single source
// ---------------------------------------------------------------------------

/**
 * Look up a source domain in MBFC and update the source record.
 */
export const enrichSource = internalAction({
  args: {
    sourceId: v.id("sources"),
    domain: v.string(),
  },
  handler: async (ctx, { sourceId, domain }) => {
    const lookup = await ctx.runAction(internal.mbfc.lookupDomain, { domain });

    if (!lookup.found) {
      // Domain not found — mark as unrated
      await ctx.runMutation(internal.mbfc.markSourceUnrated, { sourceId });
      console.log(`[mbfc] ${domain}: not found in MBFC, marked unrated`);
      return { status: "unrated" as const, domain };
    }

    const result = lookup.data;
    const biasCategory = normalizeBiasCategory(result.bias_rating);
    const factualRating = normalizeFactualRating(result.factual_reporting);

    const biasLookup = MBFC_BIAS_TO_NUMERIC[biasCategory];
    // null = unreliable category (questionable/satire/conspiracy) — default to 0 but log warning
    if (biasLookup === null) {
      console.warn(
        `[mbfc] ${domain}: category "${biasCategory}" is flagged as unreliable — defaulting baseBias to 0`,
      );
    }
    const numericBias = biasLookup ?? 0;
    const reliabilityScore = MBFC_FACTUAL_TO_RELIABILITY[factualRating] ?? 5;

    await ctx.runMutation(internal.mbfc.updateSourceMbfc, {
      sourceId,
      baseBias: numericBias,
      reliabilityScore,
      mbfcCategory: biasCategory,
      mbfcFactual: factualRating,
      mbfcCredibility:
        result.credibility_rating ?? result.mbfc_credibility_rating,
    });

    console.log(
      `[mbfc] ${domain}: bias=${biasCategory} (${numericBias}), factual=${factualRating} (${reliabilityScore})`,
    );

    return { status: "enriched" as const, domain, biasCategory, factualRating };
  },
});

// ---------------------------------------------------------------------------
// Batch enrichment — enrich all stale/unrated sources
// ---------------------------------------------------------------------------

/**
 * Find all sources that need MBFC enrichment and enrich them.
 * Called by cron on a weekly schedule or after ingestion discovers new sources.
 */
export const enrichAllSources = internalAction({
  args: {},
  handler: async (
    ctx,
  ): Promise<{
    enriched: number;
    failed?: number;
    total: number;
    incomplete?: boolean;
  }> => {
    // Kill-switch: skip entire run when pipeline is paused
    const paused = await ctx.runQuery(internal.config.isPipelinePaused, {});
    if (paused) {
      console.log("[mbfc] Pipeline paused — skipping enrichAllSources");
      return { enriched: 0, total: 0 };
    }

    const sourceBatch = await ctx.runQuery(
      internal.mbfc.getSourcesNeedingMbfc,
      { limit: MBFC_SOURCE_BATCH_SIZE },
    );
    const sources = sourceBatch.sources;

    if (sources.length === 0) {
      console.log("[mbfc] All sources up to date, nothing to enrich");
      return { enriched: 0, total: 0 };
    }

    // Cap the number of sources per run to avoid Convex action timeout (~10 min)
    const maxBatch = MBFC_SOURCE_BATCH_SIZE;
    const safetyMarginMs = 45_000; // stop 45s before estimated timeout
    const startTime = Date.now();
    const maxRuntime = 9 * 60 * 1000 - safetyMarginMs; // ~9 min budget

    console.log(
      `[mbfc] Enriching up to ${Math.min(sources.length, maxBatch)} of ${sources.length} sources`,
    );

    let enriched = 0;
    let failed = 0;

    for (const source of sources) {
      if (enriched + failed >= maxBatch) {
        console.log(`[mbfc] Reached batch cap (${maxBatch}), stopping early`);
        break;
      }
      if (Date.now() - startTime > maxRuntime) {
        console.log("[mbfc] Approaching time limit, stopping early");
        break;
      }

      try {
        await ctx.runAction(internal.mbfc.enrichSource, {
          sourceId: source._id,
          domain: source.domain,
        });
        enriched++;
      } catch (error) {
        failed++;
        console.error(
          `[mbfc] Failed to enrich ${source.domain}: ${error instanceof Error ? error.message : "Unknown"}`,
        );
      }

      // Rate limiting: 200ms between requests to be polite to the API
      await new Promise((resolve) => setTimeout(resolve, 200));
    }

    const processed = enriched + failed;
    const incomplete =
      processed < sources.length ||
      !sourceBatch.uncheckedDone ||
      !sourceBatch.staleDone;

    console.log(
      `[mbfc] Enrichment ${incomplete ? "partial" : "complete"}: ${enriched} enriched, ${failed} failed out of ${sources.length}`,
    );

    return { enriched, failed, total: sources.length, incomplete };
  },
});
