import { v, ConvexError } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { authComponent } from "./auth";
import { getConfig } from "./config";
import { normalizeEmail } from "./lib/betaAccess";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const INTERACTION_TYPE_VALIDATOR = v.union(
  v.literal("view"),
  v.literal("click_source"),
  v.literal("dismiss"),
  v.literal("share"),
  v.literal("feedback_bias"),
);

const INTERACTION_CONTEXT_VALIDATOR = v.object({
  biasRating: v.number(),
  sourceReliability: v.number(),
});

const INTERACTION_METADATA_VALIDATOR = v.object({
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
});

const DAY_MS = 24 * 60 * 60 * 1000;

async function getUserProfileByAuthUserId(
  ctx: QueryCtx | MutationCtx,
  authUserId: string,
) {
  return await ctx.db
    .query("users")
    .withIndex("by_auth_user_id", (q) => q.eq("authUserId", authUserId))
    .unique();
}

/** Recreate missing app-level user rows for legacy auth accounts on writes. */
async function ensureUserProfileForAuthUser(
  ctx: MutationCtx,
  authUser: {
    _id: string;
    email: string;
    name?: string | null;
    image?: string | null;
  },
) {
  const existingUser = await getUserProfileByAuthUserId(ctx, authUser._id);
  if (existingUser) {
    return existingUser;
  }

  const userId = await ctx.db.insert("users", {
    authUserId: authUser._id,
    email: normalizeEmail(authUser.email),
    profile: {
      name: authUser.name ?? undefined,
      avatar: authUser.image ?? undefined,
    },
  });

  await ctx.db.insert("userStats", {
    userId,
    currentStreak: 0,
    longestStreak: 0,
    articlesRead: 0,
    biasBalance: 0,
  });

  return await ctx.db.get(userId);
}

async function requireUserId(ctx: MutationCtx) {
  const authUser = await authComponent.safeGetAuthUser(ctx);
  if (!authUser) throw new ConvexError("Not authenticated");

  const user = await ensureUserProfileForAuthUser(ctx, authUser);
  if (!user) throw new ConvexError("User profile not found");

  return user._id;
}

/** Best-effort variant for analytics paths that should not hard-fail UX. */
async function getOptionalUserId(ctx: MutationCtx) {
  const authUser = await authComponent.safeGetAuthUser(ctx);
  if (!authUser) return null;

  const user = await ensureUserProfileForAuthUser(ctx, authUser);
  return user?._id ?? null;
}

function clampNumber(
  value: number | undefined,
  minimum: number,
  maximum: number,
): number | undefined {
  if (value === undefined || !Number.isFinite(value)) return undefined;
  return Math.min(maximum, Math.max(minimum, value));
}

function normalizeInteractionMetadata(
  metadata?: {
    timeSpentSeconds?: number;
    scrollDepthPercentage?: number;
    deviceType?: string;
    extras?: {
      feedbackText?: string;
      errorMessage?: string;
      experimentVariant?: string;
    };
  },
) {
  const normalized = {
    timeSpentSeconds: clampNumber(metadata?.timeSpentSeconds, 0, 86_400),
    scrollDepthPercentage: clampNumber(
      metadata?.scrollDepthPercentage,
      0,
      1,
    ),
    deviceType:
      typeof metadata?.deviceType === "string" &&
      metadata.deviceType.trim().length > 0
        ? metadata.deviceType.trim().slice(0, 32)
        : undefined,
    extras: metadata?.extras,
  };

  if (
    normalized.timeSpentSeconds === undefined &&
    normalized.scrollDepthPercentage === undefined &&
    normalized.deviceType === undefined &&
    normalized.extras === undefined
  ) {
    return {};
  }

  return normalized;
}

type InteractionContext = NonNullable<Doc<"interactions">["context"]>;
type InteractionMetadata = Doc<"interactions">["metadata"];

function startOfUtcDay(timestamp: number): number {
  return Math.floor(timestamp / DAY_MS) * DAY_MS;
}

async function updateUserStatsForView(
  ctx: MutationCtx,
  userId: Id<"users">,
  timestamp: number,
  context: InteractionContext,
) {
  const stats = await ctx.db
    .query("userStats")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .unique();
  if (!stats) {
    return;
  }

  const previousActiveAt = stats.lastActiveAt;
  const previousDay =
    previousActiveAt !== undefined ? startOfUtcDay(previousActiveAt) : undefined;
  const currentDay = startOfUtcDay(timestamp);

  let currentStreak = stats.currentStreak;
  if (previousDay === undefined) {
    currentStreak = 1;
  } else if (currentDay === previousDay) {
    currentStreak = stats.currentStreak;
  } else if (currentDay === previousDay + DAY_MS) {
    currentStreak = stats.currentStreak + 1;
  } else if (currentDay > previousDay) {
    currentStreak = 1;
  }

  const clampedBias = Math.max(-5, Math.min(5, context.biasRating));
  const previousReads = stats.articlesRead;
  const previousAverageBias = previousReads > 0 ? stats.biasBalance / 20 : 0;
  const nextReads = previousReads + 1;
  const nextAverageBias =
    (previousAverageBias * previousReads + clampedBias) / nextReads;
  const nextBiasBalance = Math.max(
    -100,
    Math.min(100, Math.round(nextAverageBias * 20)),
  );

  await ctx.db.patch(stats._id, {
    currentStreak,
    longestStreak: Math.max(stats.longestStreak, currentStreak),
    articlesRead: nextReads,
    biasBalance: nextBiasBalance,
    lastActiveAt:
      previousActiveAt === undefined
        ? timestamp
        : Math.max(previousActiveAt, timestamp),
  });
}

async function resolveInteractionContext(
  ctx: MutationCtx,
  args: {
    eventId: Id<"events">;
    articleId?: Id<"articles">;
    context?: InteractionContext;
  },
): Promise<InteractionContext> {
  if (args.context) {
    return args.context;
  }

  if (args.articleId) {
    const article = await ctx.db.get(args.articleId);
    if (article) {
      if (article.eventId && article.eventId !== args.eventId) {
        throw new ConvexError("Article does not belong to this event");
      }

      const source = await ctx.db.get(article.sourceId);
      if (source) {
        return {
          biasRating: source.baseBias,
          sourceReliability: source.reliabilityScore,
        };
      }
    }
  }

  // Event-level interactions should pass a cheap context snapshot from the
  // caller. Falling back to zeros keeps writes fast for any legacy callers.
  return { biasRating: 0, sourceReliability: 0 };
}

async function recordInteraction(
  ctx: MutationCtx,
  args: {
    userId: Id<"users">;
    eventId: Id<"events">;
    articleId?: Id<"articles">;
    type: Doc<"interactions">["type"];
    context?: InteractionContext;
    metadata?: InteractionMetadata;
    timestamp?: number;
  },
) {
  const context = await resolveInteractionContext(ctx, {
    eventId: args.eventId,
    articleId: args.articleId,
    context: args.context,
  });
  const interactionTimestamp = args.timestamp ?? Date.now();

  await ctx.db.insert("interactions", {
    userId: args.userId,
    eventId: args.eventId,
    articleId: args.articleId,
    type: args.type,
    context,
    metadata: normalizeInteractionMetadata(args.metadata),
    timestamp: interactionTimestamp,
  });

  if (args.type === "view") {
    await updateUserStatsForView(
      ctx,
      args.userId,
      interactionTimestamp,
      context,
    );
  }
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
  args: {
    eventId: v.id("events"),
    context: v.optional(INTERACTION_CONTEXT_VALIDATOR),
    metadata: v.optional(INTERACTION_METADATA_VALIDATOR),
  },
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
        context: args.context ?? latest.context,
        metadata: normalizeInteractionMetadata(args.metadata),
        timestamp: now,
      });
    } else {
      // Outside cooldown — meaningful state change, insert a new row.
      await recordInteraction(ctx, {
        userId,
        eventId: args.eventId,
        type: nextType,
        context: args.context,
        metadata: args.metadata,
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

    const user = await getUserProfileByAuthUserId(ctx, authUser._id);
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

    const user = await getUserProfileByAuthUserId(ctx, authUser._id);
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
    type: INTERACTION_TYPE_VALIDATOR,
    context: v.optional(INTERACTION_CONTEXT_VALIDATOR),
    metadata: v.optional(INTERACTION_METADATA_VALIDATOR),
  },
  handler: async (ctx, args) => {
    const userId = await getOptionalUserId(ctx);
    if (!userId) {
      return { logged: false as const, reason: "not_authenticated" };
    }
    const interactionType = args.type as Doc<"interactions">["type"];

    if (
      interactionType === "bookmark" ||
      interactionType === "unbookmark"
    ) {
      throw new ConvexError(
        "Bookmark interactions must go through toggleBookmark",
      );
    }

    await recordInteraction(ctx, {
      userId,
      eventId: args.eventId,
      articleId: args.articleId,
      type: interactionType,
      context: args.context,
      metadata: args.metadata,
    });

    return { logged: true as const };
  },
});
