import { v, ConvexError } from "convex/values";
import { BRAND_NAME } from "./brand";
import {
  query,
  mutation,
  internalMutation,
  internalQuery,
} from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { requireAdminUser } from "./lib/betaAccess";

export const TOPIC_INFERENCE_BOUNDS = {
  minScore: { min: 1, max: 20 },
  confidenceRatio: { min: 0.1, max: 1 },
  maxTopics: { min: 1, max: 5 },
} as const;

// ---------------------------------------------------------------------------
// Server-side helper — use from any query or mutation handler
// ---------------------------------------------------------------------------

/**
 * Read a config value by key. Returns `fallback` when the key doesn't exist,
 * so the app always works even before any config rows are seeded.
 *
 * The value is stored as JSON; `T` is the expected parsed type.
 */
export async function getConfig<T>(
  ctx: QueryCtx | MutationCtx,
  key: string,
  fallback: T,
): Promise<T> {
  const row = await ctx.db
    .query("config")
    .withIndex("by_key", (q) => q.eq("key", key))
    .unique();
  if (!row) return fallback;
  try {
    return JSON.parse(row.value) as T;
  } catch {
    return fallback;
  }
}

// ---------------------------------------------------------------------------
// Public queries
// ---------------------------------------------------------------------------

// Keys that are safe for unauthenticated client-side reads.
// All other keys require admin access via the `list` query.
const CLIENT_SAFE_KEYS = new Set([
  "bias_thresholds",
  "bookmark_debounce_ms",
  "event_card_max_sources",
  "feed_page_size",
  "landing_preview_count",
  "pipeline_paused",
  "waitlist_toast_dismiss_ms",
]);

/** Get a single config value (for client-side reactive reads). */
export const get = query({
  args: { key: v.string() },
  handler: async (ctx, args) => {
    if (!CLIENT_SAFE_KEYS.has(args.key)) {
      // Non-allowlisted keys require admin access
      await requireAdminUser(ctx);
    }

    const row = await ctx.db
      .query("config")
      .withIndex("by_key", (q) => q.eq("key", args.key))
      .unique();
    if (!row) return null;
    try {
      return { ...row, value: JSON.parse(row.value) };
    } catch (e) {
      console.error(
        `[config.get] Failed to parse value for key "${args.key}":`,
        e,
      );
      return null;
    }
  },
});

export const getPublicRuntimeConfig = query({
  args: {},
  handler: async (ctx) => {
    const [
      landingPreviewCount,
      eventCardMaxSources,
      feedPageSize,
      biasThresholds,
      waitlistToastDismissMs,
    ] = await Promise.all([
      getConfig(ctx, "landing_preview_count", 5),
      getConfig(ctx, "event_card_max_sources", 5),
      getConfig(ctx, "feed_page_size", 6),
      getConfig(ctx, "bias_thresholds", [-2, -0.5, 0.5, 2]),
      getConfig(ctx, "waitlist_toast_dismiss_ms", 6000),
    ]);

    return {
      landingPreviewCount,
      eventCardMaxSources,
      feedPageSize,
      biasThresholds,
      waitlistToastDismissMs,
    };
  },
});

export const getTopicInferenceBounds = query({
  args: {},
  handler: async () => TOPIC_INFERENCE_BOUNDS,
});

/** List all config entries (for an admin panel). */
export const list = query({
  args: {},
  handler: async (ctx) => {
    await requireAdminUser(ctx);

    const rows = await ctx.db.query("config").collect();
    return rows.map((row) => ({
      ...row,
      value: (() => {
        try {
          return JSON.parse(row.value);
        } catch {
          return row.value;
        }
      })(),
    }));
  },
});

// ---------------------------------------------------------------------------
// Pipeline Kill-Switch
// ---------------------------------------------------------------------------

/**
 * Returns `true` when the automatic processing pipeline is paused.
 * Actions should call this via `ctx.runQuery` at the very top of their handler
 * and return early when paused.
 *
 * Toggle with:  npx convex run config:togglePipeline
 * Or set directly: npx convex run config:set '{"key":"pipeline_paused","value":"true"}'
 */
export const isPipelinePaused = internalQuery({
  args: {},
  handler: async (ctx): Promise<boolean> => {
    return getConfig(ctx, "pipeline_paused", false);
  },
});

/**
 * One-command toggle: flips `pipeline_paused` between true and false.
 * Requires admin auth.
 *
 *   npx convex run config:togglePipeline          # flip
 *   npx convex run config:togglePipeline '{"pause":true}'   # force pause
 *   npx convex run config:togglePipeline '{"pause":false}'  # force resume
 */
export const togglePipeline = mutation({
  args: {
    pause: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    await requireAdminUser(ctx);

    const currentlyPaused = await getConfig(ctx, "pipeline_paused", false);
    const newValue = args.pause ?? !currentlyPaused;

    const existing = await ctx.db
      .query("config")
      .withIndex("by_key", (q) => q.eq("key", "pipeline_paused"))
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, {
        value: JSON.stringify(newValue),
        updatedAt: Date.now(),
      });
    } else {
      await ctx.db.insert("config", {
        key: "pipeline_paused",
        value: JSON.stringify(newValue),
        description:
          "When true, all automatic processing (ingestion, enrichment, MBFC) is paused.",
        updatedAt: Date.now(),
      });
    }

    console.log(
      `[config] Pipeline ${newValue ? "⏸ PAUSED" : "▶ RESUMED"} by admin`,
    );
    return { paused: newValue };
  },
});

/**
 * Internal-only pipeline toggle for scheduled/ops workflows where user auth
 * is not available in the caller context.
 */
export const setPipelinePausedInternal = internalMutation({
  args: {
    pause: v.boolean(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("config")
      .withIndex("by_key", (q) => q.eq("key", "pipeline_paused"))
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, {
        value: JSON.stringify(args.pause),
        updatedAt: Date.now(),
      });
    } else {
      await ctx.db.insert("config", {
        key: "pipeline_paused",
        value: JSON.stringify(args.pause),
        description:
          "When true, all automatic processing (ingestion, enrichment, MBFC) is paused.",
        updatedAt: Date.now(),
      });
    }

    console.log(
      `[config] Pipeline ${args.pause ? "⏸ PAUSED" : "▶ RESUMED"} via internal ops mutation`,
    );
    return { paused: args.pause };
  },
});

function parseAndValidateConfigValue(key: string, value: string): unknown {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new ConvexError(
      `Invalid config value for key "${key}": value must be valid JSON`,
    );
  }

  if (
    key === "singleton_cleanup_article_action" &&
    parsed !== "archive" &&
    parsed !== "requeue"
  ) {
    throw new ConvexError(
      'Invalid singleton_cleanup_article_action: expected "archive" or "requeue"',
    );
  }

  return parsed;
}

export const setInternal = internalMutation({
  args: {
    key: v.string(),
    value: v.string(),
    description: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    parseAndValidateConfigValue(args.key, args.value);

    const existing = await ctx.db
      .query("config")
      .withIndex("by_key", (q) => q.eq("key", args.key))
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, {
        value: args.value,
        ...(args.description !== undefined && {
          description: args.description,
        }),
        updatedAt: Date.now(),
      });
    } else {
      await ctx.db.insert("config", {
        key: args.key,
        value: args.value,
        description: args.description ?? "",
        updatedAt: Date.now(),
      });
    }

    // Keep the compact pipeline runtime-config snapshot in sync so admin edits
    // propagate to pipeline jobs immediately instead of waiting for the cron.
    await ctx.scheduler.runAfter(
      0,
      internal.config.refreshPipelineRuntimeConfig,
      {},
    );
  },
});

// ---------------------------------------------------------------------------
// Internal queries (for use by actions via ctx.runQuery)
// ---------------------------------------------------------------------------

/**
 * Fetch multiple config values in a single round-trip.
 * Returns a Record of key → parsed value (missing keys are omitted).
 */
export const getBatch = internalQuery({
  args: { keys: v.array(v.string()) },
  handler: async (ctx, args) => {
    const result: Record<string, unknown> = {};
    for (const key of args.keys) {
      const row = await ctx.db
        .query("config")
        .withIndex("by_key", (q) => q.eq("key", key))
        .unique();
      if (row) {
        try {
          result[key] = JSON.parse(row.value);
        } catch {
          result[key] = row.value;
        }
      }
    }
    return result;
  },
});

const PIPELINE_RUNTIME_CONFIG_KEY = "default";
const PIPELINE_RUNTIME_CONFIG_KEYS = [
  "clustering_min_similarity",
  "clustering_strong_similarity",
  "clustering_min_title_overlap",
  "clustering_min_title_jaccard",
  "clustering_same_source_min_similarity",
  "clustering_weak_extraction_min_similarity",
  "clustering_weak_extraction_strong_similarity",
  "cluster_publish_min_articles",
  "cluster_publish_min_sources",
  "topic_inference_min_score",
  "topic_inference_confidence_ratio",
  "topic_inference_max_topics",
  "clustering_vector_search_limit",
  "feed_page_size",
] as const;

async function readPipelineRuntimePayload(ctx: QueryCtx | MutationCtx) {
  const payload: Record<string, unknown> = {};
  for (const key of PIPELINE_RUNTIME_CONFIG_KEYS) {
    payload[key] = await getConfig(ctx, key, undefined);
  }
  return payload;
}

export const refreshPipelineRuntimeConfig = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const payload = await readPipelineRuntimePayload(ctx);
    const existing = await ctx.db
      .query("pipelineRuntimeConfig")
      .withIndex("by_key", (q) => q.eq("key", PIPELINE_RUNTIME_CONFIG_KEY))
      .unique();
    const row = {
      payloadJson: JSON.stringify(payload),
      generatedAt: now,
      updatedAt: now,
    };
    if (existing) {
      await ctx.db.patch(existing._id, row);
      return { refreshed: true as const, configId: existing._id };
    }
    const configId = await ctx.db.insert("pipelineRuntimeConfig", {
      key: PIPELINE_RUNTIME_CONFIG_KEY,
      ...row,
    });
    return { refreshed: true as const, configId };
  },
});

export const refreshPipelineRuntimeConfigForAdmin = mutation({
  args: {},
  handler: async (ctx) => {
    await requireAdminUser(ctx);
    const now = Date.now();
    const payload = await readPipelineRuntimePayload(ctx);
    const existing = await ctx.db
      .query("pipelineRuntimeConfig")
      .withIndex("by_key", (q) => q.eq("key", PIPELINE_RUNTIME_CONFIG_KEY))
      .unique();
    const row = {
      payloadJson: JSON.stringify(payload),
      generatedAt: now,
      updatedAt: now,
    };
    if (existing) {
      await ctx.db.patch(existing._id, row);
      return { refreshed: true as const, configId: existing._id };
    }
    const configId = await ctx.db.insert("pipelineRuntimeConfig", {
      key: PIPELINE_RUNTIME_CONFIG_KEY,
      ...row,
    });
    return { refreshed: true as const, configId };
  },
});

export const getPipelineRuntimeConfig = internalQuery({
  args: {},
  handler: async (ctx) => {
    const snapshot = await ctx.db
      .query("pipelineRuntimeConfig")
      .withIndex("by_key", (q) => q.eq("key", PIPELINE_RUNTIME_CONFIG_KEY))
      .unique();
    if (snapshot) {
      try {
        return JSON.parse(snapshot.payloadJson) as Record<string, unknown>;
      } catch (error) {
        console.error("[config] Failed to parse pipeline runtime config:", error);
      }
    } else {
      console.warn(
        "[config] pipelineRuntimeConfig snapshot missing; using per-key fallback reads (is the refresh-pipeline-runtime-config cron wired and running?)",
      );
    }
    return await readPipelineRuntimePayload(ctx);
  },
});

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

/** Upsert a config key. Creates the row if it doesn't exist; patches if it does. */
export const set = mutation({
  args: {
    key: v.string(),
    value: v.string(), // caller JSON.stringify's the value
    description: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireAdminUser(ctx);

    // Validate that the value is parseable JSON and satisfies key-specific contracts.
    parseAndValidateConfigValue(args.key, args.value);

    const existing = await ctx.db
      .query("config")
      .withIndex("by_key", (q) => q.eq("key", args.key))
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, {
        value: args.value,
        ...(args.description !== undefined && {
          description: args.description,
        }),
        updatedAt: Date.now(),
      });
    } else {
      await ctx.db.insert("config", {
        key: args.key,
        value: args.value,
        description: args.description ?? "",
        updatedAt: Date.now(),
      });
    }

    // Keep the compact pipeline runtime-config snapshot in sync so admin edits
    // propagate to pipeline jobs immediately instead of waiting for the cron.
    await ctx.scheduler.runAfter(
      0,
      internal.config.refreshPipelineRuntimeConfig,
      {},
    );
  },
});

export const setTopicInferenceSettings = mutation({
  args: {
    minScore: v.number(),
    confidenceRatio: v.number(),
    maxTopics: v.number(),
  },
  handler: async (ctx, args) => {
    await requireAdminUser(ctx);

    if (
      !Number.isFinite(args.minScore) ||
      args.minScore < TOPIC_INFERENCE_BOUNDS.minScore.min ||
      args.minScore > TOPIC_INFERENCE_BOUNDS.minScore.max
    ) {
      throw new ConvexError("Invalid topic inference minimum score");
    }
    if (
      !Number.isFinite(args.confidenceRatio) ||
      args.confidenceRatio < TOPIC_INFERENCE_BOUNDS.confidenceRatio.min ||
      args.confidenceRatio > TOPIC_INFERENCE_BOUNDS.confidenceRatio.max
    ) {
      throw new ConvexError("Invalid topic inference confidence ratio");
    }
    if (
      !Number.isInteger(args.maxTopics) ||
      args.maxTopics < TOPIC_INFERENCE_BOUNDS.maxTopics.min ||
      args.maxTopics > TOPIC_INFERENCE_BOUNDS.maxTopics.max
    ) {
      throw new ConvexError("Invalid topic inference max topics");
    }

    const now = Date.now();
    const entries = [
      {
        key: "topic_inference_min_score",
        value: args.minScore,
        description:
          "Minimum weighted lexical score required before a topic is attached to a clustered event.",
      },
      {
        key: "topic_inference_confidence_ratio",
        value: args.confidenceRatio,
        description:
          "Relative score threshold for keeping additional inferred topics alongside the top-scoring topic.",
      },
      {
        key: "topic_inference_max_topics",
        value: args.maxTopics,
        description:
          "Maximum number of inferred topics attached to an event during clustering.",
      },
    ];

    for (const entry of entries) {
      const existing = await ctx.db
        .query("config")
        .withIndex("by_key", (q) => q.eq("key", entry.key))
        .unique();
      const value = JSON.stringify(entry.value);

      if (existing) {
        await ctx.db.patch(existing._id, {
          value,
          description: entry.description,
          updatedAt: now,
        });
      } else {
        await ctx.db.insert("config", {
          key: entry.key,
          value,
          description: entry.description,
          updatedAt: now,
        });
      }
    }

    await ctx.scheduler.runAfter(
      0,
      internal.config.refreshPipelineRuntimeConfig,
      {},
    );

    return { updated: true as const };
  },
});

/** Remove a config key (falls back to hardcoded default). */
export const remove = mutation({
  args: { key: v.string() },
  handler: async (ctx, args) => {
    await requireAdminUser(ctx);

    const existing = await ctx.db
      .query("config")
      .withIndex("by_key", (q) => q.eq("key", args.key))
      .unique();
    if (existing) {
      await ctx.db.delete(existing._id);

      // Mirror the eager refresh on the write paths so deleting a pipeline key
      // (clustering_*, topic_inference_*, feed_page_size) drops it from the live
      // runtime-config snapshot immediately instead of waiting for the cron.
      await ctx.scheduler.runAfter(
        0,
        internal.config.refreshPipelineRuntimeConfig,
        {},
      );
    }
  },
});

// ---------------------------------------------------------------------------
// Internal mutation for seeding defaults
// ---------------------------------------------------------------------------

/** Seed config defaults — safe to re-run (skips already-existing keys). */
export const seedDefaults = internalMutation({
  args: {},
  handler: async (ctx) => {
    const defaults: Array<{
      key: string;
      value: unknown;
      description: string;
    }> = [
      {
        key: "bookmark_cooldown_ms",
        value: 5000,
        description:
          "Server-side cooldown (ms) for bookmark toggle dedup. Rapid toggles within this window patch the last row instead of inserting a new one.",
      },
      {
        key: "bookmark_debounce_ms",
        value: 800,
        description:
          "Client-side debounce (ms) for the bookmark button. Clicks within this window are dropped before reaching the server.",
      },
      {
        key: "feed_page_size",
        value: 6,
        description:
          "Number of events loaded per page in the feed (initial + load-more batch size).",
      },
      // Email settings
      {
        key: "email_from_address",
        value: `${BRAND_NAME} <hello@miez.news>`,
        description:
          'Sender address for transactional emails (RFC 5322 "From" header).',
      },
      {
        key: "email_reply_to",
        value: "hello@miez.news",
        description: "Reply-To address for transactional emails.",
      },
      {
        key: "email_physical_address",
        value: `${BRAND_NAME}, Bucharest, Romania`,
        description:
          "CAN-SPAM required physical address shown in email footers.",
      },
      {
        key: "unsubscribe_base_url",
        value: "https://www.miez.news/unsubscribe",
        description:
          "Base URL for one-click unsubscribe links in emails (email param is appended).",
      },
      // Client-side UI settings
      {
        key: "landing_preview_count",
        value: 3,
        description: "Number of event preview cards shown on the landing page.",
      },
      {
        key: "waitlist_toast_dismiss_ms",
        value: 10000,
        description:
          "Duration (ms) before the waitlist success/error message auto-dismisses.",
      },
      {
        key: "event_card_max_sources",
        value: 5,
        description: "Maximum number of source logos shown on an event card.",
      },
      {
        key: "bias_thresholds",
        value: [-2, -0.5, 0.5, 2],
        description:
          "Bias indicator boundaries: [leftMax, leanLeftMax, leanRightMin, rightMin]. Values outside the outer pair are labeled Left/Right.",
      },
      {
        key: "pipeline_paused",
        value: false,
        description:
          "When true, all automatic processing (ingestion, enrichment, MBFC) is paused. Toggle via config:togglePipeline.",
      },
      {
        key: "ai_daily_budget_usd",
        value: 1,
        description:
          "Daily AI spend cap in USD. AI workers check this before model calls and log usage to aiUsage.",
      },
      {
        key: "event_summary_model",
        value: "gemini-3.1-flash-lite",
        description:
          "Chat model used for event perspective summaries (gemini-* routes via Gemini's OpenAI-compatible API; anything else via OpenAI).",
      },
      {
        key: "event_summary_model_fallback",
        value: "gemini-3.1-flash-lite",
        description:
          "Model used when the primary event_summary_model is rate/quota limited (429) — lets a low-quota premium model cover the first events of the day and degrade gracefully. Set to \"none\" to disable.",
      },
      {
        key: "event_summary_enqueue_limit",
        value: 12,
        description:
          "Maximum number of event summary jobs queued per summarization run. Keep this at or below event_summary_batch_size: a run drains batch_size jobs, so anything higher grows the queue every run (observed: 820 of 1000 recent jobs still queued), wasting database writes and pushing freshly-qualified events behind days of backlog - and because summaries gate publishing, the feed stalls. Candidates are scanned most-recent-first, so a smaller limit costs recall of stale events, not fresh ones. This scan (summarization.enqueueEligibleEventSummaries) was also the 2nd largest database-I/O consumer at 2.15 GB; that was addressed by cadence (32 runs/day to 4), not by raising depth here.",
      },
      {
        key: "event_summary_batch_size",
        value: 12,
        description:
          "Maximum number of queued event summary jobs processed per summarization run. Summaries gate publishing, so this must keep pace with the eligible-event rate or the feed stalls: at 4 runs/day this allows ~48 summaries/day. Jobs are staggered JOB_STAGGER_MS apart (~7.5 requests/min), which stays inside Gemini's free-tier RPM; the 429 backpressure path defers rather than failing, so overshoot self-corrects instead of burning attempts.",
      },
      {
        key: "event_summary_max_attempts",
        value: 3,
        description:
          "Maximum retry attempts for a failed event summary job before it stops retrying.",
      },
      {
        key: "event_summary_min_articles",
        value: 3,
        description:
          "Minimum number of articles an event needs before AI summarization is queued.",
      },
      {
        key: "event_summary_min_sources",
        value: 2,
        description:
          "Minimum number of distinct sources an event needs before AI summarization is queued.",
      },
      {
        key: "event_summary_max_input_articles",
        value: 6,
        description:
          "Maximum number of recent articles included in one event summarization prompt. Reduced in cost mode (12 -> 8 in #60, now 6): prompt size drives both data egress (billed per GB leaving Convex) and model latency, which is itself billed as action compute. 6 articles are still enough for a multi-perspective summary.",
      },
      {
        key: "event_summary_body_fetch_enabled",
        value: false,
        description:
          "When true, the summarizer fetches each selected article's body transiently at summarization time (used in memory for the prompt, never stored) instead of relying only on the short extracted summary + RSS snippet. DEFAULT OFF (cost mode): Convex bills action compute by wall-clock time including network waits, so fetching one body per selected article (up to event_summary_max_input_articles per job) made this the single most expensive operation in the app. Turning it on again is the biggest cost regression available — measure before doing so.",
      },
      {
        key: "event_summary_body_chars",
        value: 2600,
        description:
          "Per-article character cap for transiently fetched body text in the event summary prompt. The effective cap also scales down with article count to bound total prompt size.",
      },
      {
        key: "event_summary_body_fetch_concurrency",
        value: 8,
        description:
          "Parallel workers for the transient article-body fetch fan-out in summarization. Higher concurrency lands more bodies within the timeout, so the compute-billed Node action is held open for less wall-clock.",
      },
      {
        key: "event_summary_body_fetch_timeout_ms",
        value: 12000,
        description:
          "Hard deadline (ms) for the whole transient body-fetch fan-out in summarization. The action proceeds with whatever bodies landed by this point. Kept tight because the action's full wall-clock — including time blocked on slow publishers — is billed as action compute; this was the dominant compute drain at the previous 60s.",
      },
      {
        key: "event_share_asset_generation_enabled",
        value: false,
        description:
          "When true, published events automatically generate custom social preview images in Convex file storage.",
      },
      {
        key: "og_image_display_enabled",
        value: true,
        description:
          "L9 global kill switch: when false, publisher og:image thumbnails are stripped from event pages and feed previews (per-domain opt-outs live in domainPermissions.imagesDisabled).",
      },
      // L1-L15 compliance knobs
      {
        key: "event_summary_max_verbatim_ngram",
        value: 8,
        description:
          "L3: maximum shared contiguous word run between a generated summary and any source text before the verbatim gate blocks/regenerates.",
      },
      {
        key: "event_grounding_enabled",
        value: true,
        description:
          "L4: verify every summary sentence against source texts (embedding first pass + LLM entailment) before publication.",
      },
      {
        key: "event_grounding_max_unsupported_ratio",
        value: 0.34,
        description:
          "L4: above this fraction of unsupported sentences the summary is blocked instead of stripped.",
      },
      {
        key: "article_fact_extraction_enabled",
        value: true,
        description:
          "When true, enrichment extracts structured atomic facts from article text using the configured chat model. Required: atomic facts are the durable grounding evidence for summarization. Enrichment sees the full article body, so facts are extracted once and stored, whereas event_summary_body_fetch_enabled re-fetches bodies on every (re)summarization. With both disabled the grounding corpus collapses to summary+rssSnippet (~200 chars/article) and every summary is blocked_ungrounded — publishing stopped entirely on 2026-08-02 for exactly this reason.",
      },
      {
        key: "article_fact_extraction_model",
        value: "gemini-3.1-flash-lite",
        description:
          "Chat model used to extract atomic facts from articles during enrichment.",
      },
      {
        key: "article_fact_extraction_max_articles_per_run",
        value: 16,
        description:
          "Maximum number of articles in one enrichment run that receive atomic fact extraction.",
      },
      {
        key: "article_fact_extraction_max_facts_per_article",
        value: 8,
        description: "Maximum number of atomic facts stored per article.",
      },
      {
        key: "article_fact_extraction_max_input_chars",
        value: 2600,
        description:
          "Maximum extracted article text characters sent to the atomic fact extraction prompt per article.",
      },
      {
        key: "article_bias_detection_enabled",
        value: false,
        description:
          "When true, enrichment scores article-level political lean and bias intensity using a strict JSON model call. Paused for the Romanian launch (BIV-602); operators re-enable explicitly via config:set.",
      },
      {
        key: "article_bias_detection_model",
        value: "gemini-3.1-flash-lite",
        description:
          "Chat model used for per-article bias component scoring during enrichment.",
      },
      {
        key: "article_bias_detection_max_articles_per_run",
        value: 16,
        description:
          "Maximum number of articles in one enrichment run that receive AI bias component scoring.",
      },
      {
        key: "article_bias_detection_max_input_chars",
        value: 6000,
        description:
          "Maximum extracted article text characters sent to the bias scoring prompt per article.",
      },
      {
        key: "article_bias_source_delta_threshold",
        value: 2,
        description:
          "Absolute difference between article aiBiasScore and source baseBias required to flag source-level bias divergence.",
      },
      {
        key: "article_bias_outlier_window_days",
        value: 30,
        description:
          "Rolling window, in days, used by the daily article bias outlier detection job.",
      },
      {
        key: "article_bias_outlier_min_samples",
        value: 10,
        description:
          "Minimum scored articles required for a source before z-score bias outlier detection runs.",
      },
      {
        key: "article_bias_outlier_stddev_multiplier",
        value: 2,
        description:
          "Standard-deviation multiplier used to flag articles unusually biased for their source.",
      },
      {
        key: "article_bias_outlier_stddev_floor",
        value: 0.5,
        description:
          "Minimum standard deviation used by article bias outlier detection to avoid over-flagging uniform sources.",
      },
      {
        key: "claim_analysis_enabled",
        value: false,
        description:
          "When true, the claim divergence worker analyzes event-level atomic facts and stores agreement/divergence/exclusive claims, and the claim UI renders. Paused for the Romanian launch (BIV-602).",
      },
      {
        key: "claim_analysis_model",
        value: "gemini-3.1-flash-lite",
        description:
          "Chat model used for event-level claim divergence analysis.",
      },
      {
        key: "claim_analysis_batch_size",
        value: 3,
        description:
          "Maximum number of stale events analyzed for claim divergence in one cron run.",
      },
      {
        key: "claim_analysis_scan_limit",
        value: 60,
        description:
          "Maximum number of recent published events inspected for stale claim analysis in one run.",
      },
      {
        key: "claim_analysis_min_articles",
        value: 3,
        description:
          "Minimum number of articles with atomic facts required before claim divergence analysis runs for an event.",
      },
      {
        key: "claim_analysis_min_sources",
        value: 2,
        description:
          "Minimum number of distinct sources with atomic facts required before claim divergence analysis runs for an event.",
      },
      {
        key: "claim_analysis_stale_after_ms",
        value: 3600000,
        description:
          "Minimum time between claim divergence analyses for an unchanged event.",
      },
      {
        key: "claim_analysis_max_input_articles",
        value: 12,
        description:
          "Maximum number of recent event articles included in one claim divergence prompt.",
      },
      {
        key: "claim_analysis_max_facts_per_article",
        value: 10,
        description:
          "Maximum number of atomic facts included per article in one claim divergence prompt.",
      },
      {
        key: "claim_analysis_max_claims_per_event",
        value: 12,
        description:
          "Maximum number of high-importance claims stored per event after claim divergence analysis.",
      },
      {
        key: "claim_analysis_min_confidence",
        value: 0.5,
        description:
          "Minimum model confidence required before a detected event claim is stored.",
      },
      {
        key: "claim_analysis_backfill_enabled",
        value: false,
        description:
          "One-time maintenance guard for claim coverage backfills. Keep false in production unless an operator explicitly enables a bounded backfill.",
      },
      {
        key: "clustering_min_similarity",
        value: 0.74,
        description:
          "Minimum embedding cosine similarity required for an article to join an existing event candidate.",
      },
      {
        key: "clustering_strong_similarity",
        value: 0.84,
        description:
          "High-confidence embedding cosine similarity that can override weaker title overlap.",
      },
      {
        key: "clustering_min_title_overlap",
        value: 1,
        description:
          "Minimum number of overlapping normalized title tokens for a non-strong clustering match.",
      },
      {
        key: "clustering_min_title_jaccard",
        value: 0.1,
        description:
          "Minimum Jaccard similarity between normalized title token sets for a non-strong clustering match.",
      },
      {
        key: "clustering_same_source_min_similarity",
        value: 0.84,
        description:
          "Stricter embedding cosine similarity required before attaching another article from the same source to an event.",
      },
      {
        key: "clustering_weak_extraction_min_similarity",
        value: 0.82,
        description:
          "Minimum similarity required before a weak-extraction article can attach to an existing event.",
      },
      {
        key: "clustering_weak_extraction_strong_similarity",
        value: 0.88,
        description:
          "High-confidence similarity override for weak-extraction articles.",
      },
      {
        key: "cluster_publish_min_articles",
        value: 3,
        description:
          "Legacy clustering publish threshold. Publishing is now gated on a successful AI summary (see event_summary_min_articles), so this no longer flips status directly; kept aligned at 3 to document the effective bar.",
      },
      {
        key: "cluster_publish_min_sources",
        value: 2,
        description:
          "Legacy clustering publish threshold. Publishing is now gated on a successful AI summary (see event_summary_min_sources); kept aligned at 2 to document the effective bar.",
      },
      {
        key: "topic_inference_min_score",
        value: 4.5,
        description:
          "Minimum weighted lexical score required before a topic is attached to a clustered event.",
      },
      {
        key: "topic_inference_confidence_ratio",
        value: 0.55,
        description:
          "Relative score threshold for keeping additional inferred topics alongside the top-scoring topic.",
      },
      {
        key: "topic_inference_max_topics",
        value: 3,
        description:
          "Maximum number of inferred topics attached to an event during clustering.",
      },
      {
        key: "merge_min_similarity",
        value: 0.94,
        description:
          "Minimum event embedding cosine similarity required before merging two published events as duplicates.",
      },
      {
        key: "merge_min_title_jaccard",
        value: 0.45,
        description:
          "Minimum title-token Jaccard similarity required before merging two published events as duplicates.",
      },
      {
        key: "merge_max_time_delta_hours",
        value: 48,
        description:
          "Maximum age difference in hours between two published events that are eligible for duplicate merging.",
      },
      {
        key: "singleton_recluster_min_similarity",
        value: 0.74,
        description:
          "Minimum similarity required before merging two small recent singleton-ish events in the recluster pass.",
      },
      {
        key: "singleton_recluster_window_hours",
        value: 48,
        description:
          "How many hours back the singleton recluster pass should inspect recent small events.",
      },
      {
        key: "vector_search_daily_budget_qgb",
        value: 25,
        description:
          "Daily Convex vector-search read budget in qGB. Clustering workers use this to hard-stop expensive semantic search when spend spikes.",
      },
      {
        key: "vector_search_per_search_bytes_default",
        value: 31457280,
        description:
          "Default estimated bytes scanned per vector search when no observed qGB calibration is available. Set to 30 MiB on 2026-05-14 after the stale-singleton index cleanup plan reduced expected bytes scanned.",
      },
      {
        key: "vector_search_observed_qgb_last_24h",
        value: 0,
        description:
          "Optional operator-provided observed Convex vector qGB for the last 24 hours, used to calibrate per-search cost estimates.",
      },
      {
        key: "vector_search_budget_enabled",
        value: true,
        description:
          "When true, clustering workers enforce the daily vector-search qGB budget before semantic matching work.",
      },
      {
        key: "vector_search_fallback_mode_enabled",
        value: true,
        description:
          "When true, clusterEnrichedArticles falls back to heuristic-only batch-local matching after the vector-search budget is exhausted.",
      },
      {
        key: "vector_search_run_retention_days",
        value: 30,
        description:
          "Number of days to retain detailed vector-search run rows before daily cleanup deletes them.",
      },
      {
        key: "backfill_enabled",
        value: false,
        description:
          "Global one-time maintenance guard. Backfill actions should remain disabled in production unless explicitly enabled with a short-lived operator reason.",
      },
      {
        key: "clustering_vector_search_limit",
        value: 12,
        description:
          "Top-K limit used for article-to-event vector search during clusterEnrichedArticles. Each neighbor is hydrated (candidacy + ~10KB embedding), so this drives database I/O and vector bandwidth.",
      },
      {
        key: "merge_vector_search_limit",
        value: 8,
        description:
          "Top-K limit used for event-to-event vector search during duplicate-merge passes. Each neighbor is hydrated (candidacy + ~10KB embedding), so this drives database I/O and vector bandwidth.",
      },
      {
        key: "recluster_vector_search_limit",
        value: 8,
        description:
          "Top-K limit used for event-to-event vector search during singleton recluster passes. Each neighbor is hydrated (candidacy + ~10KB embedding), so this drives database I/O and vector bandwidth.",
      },
      {
        key: "merge_changed_seed_limit",
        value: 8,
        description:
          "Maximum changed event seeds inspected by one duplicate-merge pass.",
      },
      {
        key: "recluster_changed_seed_limit",
        value: 8,
        description:
          "Maximum changed singleton event seeds inspected by one singleton recluster pass.",
      },
      {
        key: "singleton_cleanup_enabled",
        value: true,
        description:
          "When true, stale processing singleton events are archived and removed from vector clustering indexes.",
      },
      {
        key: "singleton_cleanup_stale_hours",
        value: 48,
        description:
          "Minimum age since lastArticleAt before a processing singleton can be archived.",
      },
      {
        key: "singleton_cleanup_batch_size",
        value: 75,
        description:
          "Maximum stale singleton events archived in one cleanup invocation.",
      },
      {
        key: "singleton_cleanup_max_articles",
        value: 2,
        description:
          "Maximum articleCount eligible for stale singleton cleanup.",
      },
      {
        key: "singleton_cleanup_max_sources",
        value: 1,
        description:
          "Maximum sourceCount eligible for stale singleton cleanup.",
      },
      {
        key: "singleton_cleanup_article_action",
        value: "archive",
        description:
          'How stale singleton articles are handled during cleanup. Valid values: "archive" or "requeue"; default archive keeps historical eventId references.',
      },
      {
        key: "google_news_overlay_enabled",
        value: false,
        description:
          "When true, ingestion also pulls the Google News Romania catch-all RSS feed as a discovery overlay (BIV-103). Items are unwrapped to canonical publisher URLs and only known source domains are ingested.",
      },
      {
        key: "google_news_overlay_max_items",
        value: 25,
        description:
          "Maximum Google News overlay items considered per run (each item costs up to two resolution fetches).",
      },
      {
        key: "pipeline_run_log_retention_days",
        value: 14,
        description:
          "Number of days to retain detailed pipeline run log rows.",
      },
      {
        key: "pipeline_alert_check_interval_minutes",
        value: 720,
        description:
          "Nominal interval for pipeline alert checks. Must track the check-pipeline-alerts cron in crons.ts (cost mode: 2x daily), otherwise absent-run and staleness alerts fire spuriously.",
      },
      {
        key: "archived_article_retention_days",
        value: 90,
        description:
          "Age after which an ARCHIVED, event-detached article row (and its embeddings) is deleted. Only applies to articles archived by singletonCleanup as stale singletons/processing events, which belong to no event — never to articles reachable from the feed. Hand-labeled clusterPairLabels rows are excluded by the purge job.",
      },
      {
        key: "article_embedding_retention_days",
        value: 45,
        description:
          "Age after which an article's 512-dimension embedding row is deleted. Clustering only ever compares recent articles, so older embeddings are dead weight — and unbounded articleEmbeddings growth (~1,300 articles/day) was the main driver of database storage cost. Article rows themselves are retained; only the vectors are purged.",
      },
    ];

    const forcedDefaultKeys = new Set([
      // BIV-602: claim analysis paused — force the off state onto existing
      // deployments; operators re-enable explicitly via config:set.
      "article_fact_extraction_enabled",
      "article_bias_detection_enabled",
      "claim_analysis_enabled",
      "clustering_same_source_min_similarity",
      "clustering_min_similarity",
      "clustering_weak_extraction_min_similarity",
      "clustering_weak_extraction_strong_similarity",
      "cluster_publish_min_articles",
      "cluster_publish_min_sources",
      "topic_inference_min_score",
      "topic_inference_confidence_ratio",
      "topic_inference_max_topics",
      "merge_min_similarity",
      "merge_min_title_jaccard",
      "merge_max_time_delta_hours",
      "singleton_recluster_min_similarity",
      "vector_search_daily_budget_qgb",
      "vector_search_per_search_bytes_default",
      "clustering_vector_search_limit",
      "merge_vector_search_limit",
      "recluster_vector_search_limit",
      "merge_changed_seed_limit",
      "recluster_changed_seed_limit",
      "event_summary_batch_size",
      "article_fact_extraction_max_articles_per_run",
      "article_bias_detection_max_articles_per_run",
      "claim_analysis_batch_size",
      "singleton_cleanup_batch_size",
      "pipeline_alert_check_interval_minutes",
    ]);

    // BIV-201: rows still holding a stale prior default are migrated to the
    // new default; explicit operator overrides (any other value) are kept.
    const staleValueMigrations: Record<string, string[]> = {
      event_summary_model: ['"gpt-5-nano"'],
      article_fact_extraction_model: ['"gpt-5-nano"'],
      article_bias_detection_model: ['"gpt-5-nano"'],
      claim_analysis_model: ['"gpt-5-nano"'],
      // Migrate the prior summary input caps down to the current default.
      // "12" was the original; "8" was the intermediate egress-reduced value
      // from #60, which never reached prod before the deployment was disabled —
      // both are listed so either state converges. This key is intentionally
      // not force-managed, so operator overrides (any other value) are kept.
      event_summary_max_input_articles: ["12", "8"],
    };

    let created = 0;
    let updated = 0;
    for (const { key, value, description } of defaults) {
      const existing = await ctx.db
        .query("config")
        .withIndex("by_key", (q) => q.eq("key", key))
        .unique();
      const nextValue = JSON.stringify(value);

      if (existing) {
        const staleValues = staleValueMigrations[key];
        if (staleValues?.includes(existing.value)) {
          if (existing.value !== nextValue) {
            await ctx.db.patch(existing._id, {
              value: nextValue,
              description,
              updatedAt: Date.now(),
            });
            updated++;
          }
          continue;
        }
        if (!forcedDefaultKeys.has(key)) continue;

        if (
          existing.value !== nextValue ||
          (description !== undefined && existing.description !== description)
        ) {
          await ctx.db.patch(existing._id, {
            value: nextValue,
            description,
            updatedAt: Date.now(),
          });
          updated++;
        }
        continue;
      }

      await ctx.db.insert("config", {
        key,
        value: nextValue,
        description,
        updatedAt: Date.now(),
      });
      created++;
    }

    console.log(
      `✅ Config seeded: ${created} created, ${updated} updated, ${defaults.length - created - updated} unchanged`,
    );
  },
});
