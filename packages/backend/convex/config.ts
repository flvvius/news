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

/** Get a single config value (for client-side reactive reads). */
export const get = query({
  args: { key: v.string() },
  handler: async (ctx, args) => {
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
