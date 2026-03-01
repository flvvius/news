import { v } from "convex/values";
import { query, mutation, internalMutation } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";

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
    return { ...row, value: JSON.parse(row.value) };
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
