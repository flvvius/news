import { v, ConvexError } from "convex/values";
import {
  query,
  mutation,
  internalMutation,
  internalQuery,
} from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import { authComponent } from "./auth";

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
  ctx: QueryCtx,
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
      await requireAdmin(ctx);
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

/** List all config entries (for an admin panel). */
export const list = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);

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
    await requireAdmin(ctx);

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

export const setInternal = internalMutation({
  args: {
    key: v.string(),
    value: v.string(),
    description: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    try {
      JSON.parse(args.value);
    } catch {
      throw new ConvexError(
        `Invalid config value for key "${args.key}": value must be valid JSON`,
      );
    }

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

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Auth helper — reuse the same ADMIN_EMAILS pattern from waitlist.ts
// ---------------------------------------------------------------------------

async function requireAdmin(ctx: QueryCtx) {
  const authUser = await authComponent.safeGetAuthUser(ctx);
  if (!authUser) {
    throw new ConvexError("Not authenticated");
  }
  const adminEmails = (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  if (!adminEmails.includes(authUser.email.toLowerCase())) {
    throw new ConvexError("Unauthorized: admin access required");
  }
  return authUser;
}

/** Upsert a config key. Creates the row if it doesn't exist; patches if it does. */
export const set = mutation({
  args: {
    key: v.string(),
    value: v.string(), // caller JSON.stringify's the value
    description: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);

    // Validate that the value is parseable JSON before storing
    try {
      JSON.parse(args.value);
    } catch {
      throw new ConvexError(
        `Invalid config value for key "${args.key}": value must be valid JSON`,
      );
    }

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
  },
});

/** Remove a config key (falls back to hardcoded default). */
export const remove = mutation({
  args: { key: v.string() },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);

    const existing = await ctx.db
      .query("config")
      .withIndex("by_key", (q) => q.eq("key", args.key))
      .unique();
    if (existing) {
      await ctx.db.delete(existing._id);
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
        value: "Biviant <hello@biviant.com>",
        description:
          'Sender address for transactional emails (RFC 5322 "From" header).',
      },
      {
        key: "email_reply_to",
        value: "hello@biviant.com",
        description: "Reply-To address for transactional emails.",
      },
      {
        key: "email_physical_address",
        value: "Biviant, Bucharest, Romania",
        description:
          "CAN-SPAM required physical address shown in email footers.",
      },
      {
        key: "unsubscribe_base_url",
        value: "https://biviant.com/unsubscribe",
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
        value: 0.88,
        description:
          "Stricter embedding cosine similarity required before attaching another article from the same source to an event.",
      },
      {
        key: "clustering_weak_extraction_min_similarity",
        value: 0.9,
        description:
          "Minimum similarity required before a weak-extraction article can attach to an existing event.",
      },
      {
        key: "clustering_weak_extraction_strong_similarity",
        value: 0.93,
        description:
          "High-confidence similarity override for weak-extraction articles.",
      },
      {
        key: "cluster_publish_min_articles",
        value: 2,
        description:
          "Minimum number of clustered articles required before a new event is published to the feed.",
      },
      {
        key: "cluster_publish_min_sources",
        value: 2,
        description:
          "Minimum number of distinct sources required before a new event is published to the feed.",
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
        value: 24,
        description:
          "Maximum age difference in hours between two published events that are eligible for duplicate merging.",
      },
      {
        key: "singleton_recluster_min_similarity",
        value: 0.8,
        description:
          "Minimum similarity required before merging two small recent singleton-ish events in the recluster pass.",
      },
      {
        key: "singleton_recluster_window_hours",
        value: 48,
        description:
          "How many hours back the singleton recluster pass should inspect recent small events.",
      },
    ];

    let created = 0;
    for (const { key, value, description } of defaults) {
      const existing = await ctx.db
        .query("config")
        .withIndex("by_key", (q) => q.eq("key", key))
        .unique();
      if (!existing) {
        await ctx.db.insert("config", {
          key,
          value: JSON.stringify(value),
          description,
          updatedAt: Date.now(),
        });
        created++;
      }
    }

    console.log(
      `✅ Config seeded: ${created} created, ${defaults.length - created} already existed`,
    );
  },
});
