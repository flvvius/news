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
  args: {},
  handler: async (ctx) => {
    const allSources = await ctx.db.query("sources").collect();
    const now = Date.now();

    return allSources.filter((source) => {
      // Never checked
      if (!source.mbfcLastChecked) return true;
      // Stale (older than refresh interval)
      if (now - source.mbfcLastChecked > MBFC_REFRESH_INTERVAL_MS) return true;
      return false;
    });
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
 * Returns the MBFC data or null if not found.
 */
export const lookupDomain = internalAction({
  args: { domain: v.string() },
  handler: async (_ctx, { domain }): Promise<MBFCSearchResult | null> => {
    const apiKey = process.env.RAPIDAPI_KEY;
    if (!apiKey) {
      console.warn("[mbfc] RAPIDAPI_KEY not set, skipping MBFC lookup");
      return null;
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
        return null; // Domain not in MBFC database
      }

      if (!response.ok) {
        console.error(
          `[mbfc] API error for ${domain}: HTTP ${response.status}`,
        );
        return null;
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
        return exactMatch ?? data[0] ?? null;
      }

      return data as MBFCSearchResult;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      console.error(`[mbfc] Failed to lookup ${domain}: ${message}`);
      return null;
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
    const result = await ctx.runAction(internal.mbfc.lookupDomain, { domain });

    if (!result) {
      // Domain not found — mark as unrated
      await ctx.runMutation(internal.mbfc.markSourceUnrated, { sourceId });
      console.log(`[mbfc] ${domain}: not found in MBFC, marked unrated`);
      return { status: "unrated" as const, domain };
    }

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

    const sources = await ctx.runQuery(internal.mbfc.getSourcesNeedingMbfc, {});

    if (sources.length === 0) {
      console.log("[mbfc] All sources up to date, nothing to enrich");
      return { enriched: 0, total: 0 };
    }

    // Cap the number of sources per run to avoid Convex action timeout (~10 min)
    const maxBatch = 40;
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
    const incomplete = processed < sources.length;

    console.log(
      `[mbfc] Enrichment ${incomplete ? "partial" : "complete"}: ${enriched} enriched, ${failed} failed out of ${sources.length}`,
    );

    return { enriched, failed, total: sources.length, incomplete };
  },
});
