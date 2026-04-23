import { v, ConvexError } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { authComponent } from "./auth";
import { getConfig } from "./config";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Resolve the internal users._id for the currently-authenticated user. */
async function requireUserId(ctx: QueryCtx) {
  const authUser = await authComponent.safeGetAuthUser(ctx);
  if (!authUser) throw new ConvexError("Not authenticated");

  const user = await ctx.db
    .query("users")
    .withIndex("by_auth_user_id", (q) => q.eq("authUserId", authUser._id))
    .unique();
  if (!user) throw new ConvexError("User profile not found");

  return user._id;
}

// ---------------------------------------------------------------------------
// Bookmarks
// ---------------------------------------------------------------------------

/**
 * Toggle a bookmark on an event.
 *
 * Deduplication strategy (cooldown dedup):
 * - If the last bookmark/unbookmark for this user+event is within the
 *   `bookmark_cooldown_ms` config window, **patch** that row (type + timestamp).
 * - Otherwise, **insert** a new row.
 *
 * This bounds storage to at most 1 row per cooldown window per user+event
 * while preserving every *meaningful* state change for analytics.
 *
 * Returns `{ bookmarked: boolean }`.
 */
export const toggleBookmark = mutation({
  args: { eventId: v.id("events") },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const now = Date.now();

    const rawCooldown = await getConfig(ctx, "bookmark_cooldown_ms", 5_000);
    const cooldownMs =
      typeof rawCooldown === "number" &&
      Number.isFinite(rawCooldown) &&
      rawCooldown >= 0 &&
      rawCooldown <= 60_000
        ? Math.floor(rawCooldown)
        : 5_000;
    if (cooldownMs !== rawCooldown) {
      console.warn(
        `[toggleBookmark] Invalid bookmark_cooldown_ms config (${String(rawCooldown)}), using default 5000`,
      );
    }

    // Find the most recent bookmark/unbookmark for this user+event.
    const recentRows = await ctx.db
      .query("interactions")
      .withIndex("by_user_event_type", (q) =>
        q.eq("userId", userId).eq("eventId", args.eventId),
      )
      .order("desc")
      .collect();

    const latest = recentRows.find(
      (r) => r.type === "bookmark" || r.type === "unbookmark",
    );

    const isCurrentlyBookmarked = latest?.type === "bookmark";
    const nextType = isCurrentlyBookmarked ? "unbookmark" : "bookmark";

    if (latest && now - latest.timestamp < cooldownMs) {
      // Within cooldown — patch the existing row instead of inserting.
      await ctx.db.patch(latest._id, {
        type: nextType,
        timestamp: now,
      });
    } else {
      // Outside cooldown — meaningful state change, insert a new row.
      await ctx.db.insert("interactions", {
        userId,
        eventId: args.eventId,
        type: nextType,
        context: { biasRating: 0, sourceReliability: 0 },
        metadata: {},
        timestamp: now,
      });
    }

    return { bookmarked: !isCurrentlyBookmarked };
  },
});

/**
 * Resolve whether a user+event pair is currently bookmarked.
 * Looks at all bookmark/unbookmark entries and picks the most recent one.
 */
async function resolveBookmarkStatus(
  ctx: QueryCtx,
  userId: Id<"users">,
  eventId: Id<"events">,
): Promise<boolean> {
  // Fetch the most recent bookmark or unbookmark for this user+event.
  // The index prefix is (userId, eventId) — we collect both types and pick
  // the latest. .order("desc") sorts by _creationTime (newest first).
  const recent = await ctx.db
    .query("interactions")
    .withIndex("by_user_event_type", (q) =>
      q.eq("userId", userId).eq("eventId", eventId),
    )
    .order("desc")
    .collect();

  const latest = recent.find(
    (r) => r.type === "bookmark" || r.type === "unbookmark",
  );

  return latest?.type === "bookmark";
}

/**
 * Check whether the current user has bookmarked a given event.
 * Returns `false` for unauthenticated users (no error).
 */
export const isEventBookmarked = query({
  args: { eventId: v.id("events") },
  handler: async (ctx, args) => {
    const authUser = await authComponent.safeGetAuthUser(ctx);
    if (!authUser) return false;

    const user = await ctx.db
      .query("users")
      .withIndex("by_auth_user_id", (q) => q.eq("authUserId", authUser._id))
      .unique();
    if (!user) return false;

    return resolveBookmarkStatus(ctx, user._id, args.eventId);
  },
});

/**
 * Get all bookmarked events for the current user (newest first).
 * Returns the full event + article-count + sources (same shape as feed cards).
 */
export const getBookmarkedEvents = query({
  args: {},
  handler: async (ctx) => {
    const authUser = await authComponent.safeGetAuthUser(ctx);
    if (!authUser) return [];

    const user = await ctx.db
      .query("users")
      .withIndex("by_auth_user_id", (q) => q.eq("authUserId", authUser._id))
      .unique();
    if (!user) return [];

    // Collect all bookmark + unbookmark interactions, then resolve per-event.
    // .order("desc") sorts by _creationTime (newest first) so the first
    // occurrence per event in the loop below is the latest interaction.
    const allBookmarkInteractions = await ctx.db
      .query("interactions")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .order("desc")
      .collect();

    // Keep only the latest bookmark/unbookmark per event.
    const latestByEvent = new Map<
      string,
      (typeof allBookmarkInteractions)[0]
    >();
    for (const interaction of allBookmarkInteractions) {
      if (interaction.type !== "bookmark" && interaction.type !== "unbookmark")
        continue;
      const key = interaction.eventId;
      if (!latestByEvent.has(key)) {
        latestByEvent.set(key, interaction);
      }
    }

    // Only keep events whose latest action is "bookmark" (not "unbookmark").
    const bookmarks = Array.from(latestByEvent.values()).filter(
      (i) => i.type === "bookmark",
    );

    const events = await Promise.all(
      bookmarks.map(async (bookmark) => {
        const event = await ctx.db.get(bookmark.eventId);
        if (!event || event.status !== "published") return null;

        const articles = await ctx.db
          .query("articles")
          .withIndex("by_event", (q) => q.eq("eventId", event._id))
          .collect();

        const sourceIds = Array.from(new Set(articles.map((a) => a.sourceId)));
        const sources = await Promise.all(
          sourceIds.map((id) => ctx.db.get(id)),
        );

        return {
          ...event,
          articleCount: articles.length,
          sources: sources.filter((s) => s !== null),
          bookmarkedAt: bookmark.timestamp,
        };
      }),
    );

    return events.filter((e) => e !== null);
  },
});

// ---------------------------------------------------------------------------
// Interaction Logging (generic — for views, clicks, shares, etc.)
// ---------------------------------------------------------------------------

export const logInteraction = mutation({
  args: {
    eventId: v.id("events"),
    articleId: v.optional(v.id("articles")),
    type: v.union(
      v.literal("view"),
      v.literal("click_source"),
      v.literal("dismiss"),
      v.literal("share"),
      v.literal("feedback_bias"),
    ),
    context: v.optional(
      v.object({
        biasRating: v.number(),
        sourceReliability: v.number(),
      }),
    ),
    metadata: v.optional(
      v.object({
        timeSpentSeconds: v.optional(v.number()),
        scrollDepthPercentage: v.optional(v.number()),
        deviceType: v.optional(v.string()),
        extras: v.optional(
          v.object({
            feedbackText: v.optional(v.string()),
            errorMessage: v.optional(v.string()),
            experimentVariant: v.optional(v.string()),
          }),
        ),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);

    await ctx.db.insert("interactions", {
      userId,
      eventId: args.eventId,
      articleId: args.articleId,
      type: args.type,
      context: args.context ?? { biasRating: 0, sourceReliability: 0 },
      metadata: args.metadata ?? {},
      timestamp: Date.now(),
    });
  },
});
