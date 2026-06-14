import { v, ConvexError } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { authComponent } from "./auth";
import { getConfig } from "./config";
import { enforceRateLimit } from "./lib/rateLimit";
import { computeStreakUpdate } from "./lib/streaks";
import {
  getPublicPreviewByEventId,
  MAX_PREVIEW_SOURCES,
} from "./lib/publicEventPreviews";
import {
  ensureUserProfileForAuthUser,
  getUserProfileByAuthUserId,
} from "./lib/userProfile";

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
  deviceType: v.optional(
    v.union(v.literal("mobile"), v.literal("tablet"), v.literal("desktop")),
  ),
  extras: v.optional(
    v.object({
      feedbackText: v.optional(v.string()),
      errorMessage: v.optional(v.string()),
      experimentVariant: v.optional(v.string()),
    }),
  ),
});

const DAY_MS = 24 * 60 * 60 * 1000;

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

function normalizeInteractionMetadata(metadata?: {
  timeSpentSeconds?: number;
  scrollDepthPercentage?: number;
  deviceType?: "mobile" | "tablet" | "desktop";
  extras?: {
    feedbackText?: string;
    errorMessage?: string;
    experimentVariant?: string;
  };
}) {
  const normalized = {
    timeSpentSeconds: clampNumber(metadata?.timeSpentSeconds, 0, 86_400),
    scrollDepthPercentage: clampNumber(metadata?.scrollDepthPercentage, 0, 1),
    deviceType: metadata?.deviceType,
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

/** The streak/read/bias fields a "view" advances. */
type ViewStatsAccumulator = {
  currentStreak: number;
  longestStreak: number;
  articlesRead: number;
  biasBalance: number;
  lastActiveAt?: number;
};

/**
 * Pure fold of a single "view" into a running stats accumulator.
 *
 * Both the live per-view write (`updateUserStatsForView`) and the guest-merge
 * replay (`replayGuestMerge`) go through this one function, so folding N reads
 * in a single mutation is identical *by construction* to applying them one at a
 * time — that equivalence is exactly Ticket 1's contract. Bias is rounded and
 * clamped at every step (not just at the end) because the next step reads back
 * the *stored* (rounded) balance, so the rounding compounds and must be
 * reproduced step-by-step to match a day-by-day replay.
 */
function foldViewStats(
  stats: ViewStatsAccumulator,
  timestamp: number,
  biasRating: number,
): ViewStatsAccumulator {
  const streakUpdate = computeStreakUpdate(stats, timestamp);

  const clampedBias = Math.max(-5, Math.min(5, biasRating));
  const previousReads = stats.articlesRead;
  const previousAverageBias = previousReads > 0 ? stats.biasBalance / 20 : 0;
  const nextReads = previousReads + 1;
  const nextAverageBias =
    (previousAverageBias * previousReads + clampedBias) / nextReads;
  const nextBiasBalance = Math.max(
    -100,
    Math.min(100, Math.round(nextAverageBias * 20)),
  );

  return {
    currentStreak: streakUpdate.currentStreak,
    longestStreak: streakUpdate.longestStreak,
    articlesRead: nextReads,
    biasBalance: nextBiasBalance,
    lastActiveAt: streakUpdate.lastActiveAt,
  };
}

async function updateUserStatsForView(
  ctx: MutationCtx,
  userId: Id<"users">,
  timestamp: number,
  context: InteractionContext,
) {
  let stats = await ctx.db
    .query("userStats")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .unique();
  if (!stats) {
    const statsId = await ctx.db.insert("userStats", {
      userId,
      currentStreak: 0,
      longestStreak: 0,
      articlesRead: 0,
      biasBalance: 0,
    });
    stats = await ctx.db.get(statsId);
    if (!stats) {
      return;
    }
  }

  const next = foldViewStats(stats, timestamp, context.biasRating);

  await ctx.db.patch(stats._id, {
    currentStreak: next.currentStreak,
    longestStreak: next.longestStreak,
    articlesRead: next.articlesRead,
    biasBalance: next.biasBalance,
    lastActiveAt: next.lastActiveAt,
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

export async function recordInteraction(
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

type BookmarkInteraction = Doc<"interactions">;
type ViewInteraction = Doc<"interactions">;

type DashboardEventPreview = {
  _id: Id<"events">;
  slug: string;
  title: string;
  imageUrl?: string;
  summary: string;
  firstPublishedAt: number;
  lastUpdatedAt: number;
  articleCount: number;
  sourceCount: number;
  sources: Array<{
    _id: Id<"sources">;
    name: string;
    logoUrl?: string;
    baseBias: number;
    reliabilityScore: number;
    mbfcCategory?: string;
  }>;
};

function getLatestBookmarkInteractionsByEvent(
  interactions: Doc<"interactions">[],
): Map<string, BookmarkInteraction> {
  const latestByEvent = new Map<string, BookmarkInteraction>();

  for (const interaction of interactions) {
    if (interaction.type !== "bookmark" && interaction.type !== "unbookmark") {
      continue;
    }

    if (!latestByEvent.has(interaction.eventId)) {
      latestByEvent.set(interaction.eventId, interaction);
    }
  }

  return latestByEvent;
}

async function buildDashboardEventPreview(
  ctx: QueryCtx,
  eventId: Id<"events">,
): Promise<DashboardEventPreview | null> {
  const preview = await getPublicPreviewByEventId(ctx, eventId);
  if (preview) {
    return {
      _id: preview.eventId,
      slug: preview.slug,
      title: preview.title,
      imageUrl: preview.imageUrl,
      summary:
        preview.perspectiveSummaries?.center ??
        preview.globalImpact ??
        "Open the event to compare coverage from multiple sources.",
      firstPublishedAt: preview.firstPublishedAt,
      lastUpdatedAt: preview.lastUpdatedAt,
      articleCount: preview.articleCount,
      sourceCount: preview.sourceCount,
      sources: preview.sources,
    };
  }

  const event = await ctx.db.get(eventId);
  if (!event || event.status !== "published") {
    return null;
  }

  let articleCount = event.articleCount;
  let sourceIds = event.sourceIds;
  if (articleCount === undefined || !sourceIds) {
    console.log(
      `[interactions] Falling back to article scan for dashboard preview on event ${String(eventId)}`,
    );
    const articles = await ctx.db
      .query("articles")
      .withIndex("by_event", (q) => q.eq("eventId", event._id))
      .collect();
    articleCount = articleCount ?? articles.length;
    sourceIds =
      sourceIds ??
      Array.from(new Set(articles.map((article) => article.sourceId)));
  }
  const sourceRows = await Promise.all(
    (sourceIds ?? [])
      .slice(0, MAX_PREVIEW_SOURCES)
      .map((sourceId) => ctx.db.get(sourceId)),
  );

  return {
    _id: event._id,
    slug: event.slug,
    title: event.title,
    imageUrl: event.imageUrl,
    summary:
      event.perspectiveSummaries?.center ??
      event.globalImpact ??
      "Open the event to compare coverage from multiple sources.",
    firstPublishedAt: event.firstPublishedAt,
    lastUpdatedAt: event.lastUpdatedAt ?? event.firstPublishedAt,
    articleCount: articleCount ?? 0,
    sourceCount: event.sourceCount ?? sourceIds?.length ?? 0,
    sources: sourceRows
      .filter((source) => source !== null)
      .map((source) => ({
        _id: source._id,
        name: source.name,
        logoUrl: source.logoUrl,
        baseBias: source.baseBias,
        reliabilityScore: source.reliabilityScore,
        mbfcCategory: source.mbfcCategory,
      })),
  };
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
        const preview = await getPublicPreviewByEventId(ctx, bookmark.eventId);
        if (preview) {
          return {
            _id: preview.eventId,
            slug: preview.slug,
            title: preview.title,
            imageUrl: preview.imageUrl,
            imageAlt: preview.imageAlt,
            perspectiveSummaries: preview.perspectiveSummaries,
            globalImpact: preview.globalImpact,
            firstPublishedAt: preview.firstPublishedAt,
            lastUpdatedAt: preview.lastUpdatedAt,
            articleCount: preview.articleCount,
            sourceCount: preview.sourceCount,
            sourceBiasCounts: preview.sourceBiasCounts,
            topicIds: preview.topicIds,
            sources: preview.sources,
            bookmarkedAt: bookmark.timestamp,
          };
        }

        const event = await ctx.db.get(bookmark.eventId);
        if (!event || event.status !== "published") return null;

        let articleCount = event.articleCount;
        let sourceIds = event.sourceIds;
        if (articleCount === undefined || !sourceIds) {
          console.log(
            `[interactions] Falling back to article scan for bookmarked event ${String(bookmark.eventId)}`,
          );
          const articles = await ctx.db
            .query("articles")
            .withIndex("by_event", (q) => q.eq("eventId", event._id))
            .collect();
          articleCount = articleCount ?? articles.length;
          sourceIds =
            sourceIds ??
            Array.from(new Set(articles.map((article) => article.sourceId)));
        }

        const sources = await Promise.all(
          (sourceIds ?? [])
            .slice(0, MAX_PREVIEW_SOURCES)
            .map((id) => ctx.db.get(id)),
        );

        return {
          ...event,
          articleCount: articleCount ?? 0,
          sourceCount: event.sourceCount ?? sourceIds?.length ?? 0,
          sources: sources.filter((s) => s !== null),
          bookmarkedAt: bookmark.timestamp,
        };
      }),
    );

    return events.filter((e) => e !== null);
  },
});

export const getBookmarkedCount = query({
  args: {},
  handler: async (ctx) => {
    const authUser = await authComponent.safeGetAuthUser(ctx);
    if (!authUser) return 0;

    const user = await getUserProfileByAuthUserId(ctx, authUser._id);
    if (!user) return 0;

    const allBookmarkInteractions = await ctx.db
      .query("interactions")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .order("desc")
      .collect();

    const latestByEvent = getLatestBookmarkInteractionsByEvent(
      allBookmarkInteractions,
    );

    let count = 0;
    for (const interaction of latestByEvent.values()) {
      if (interaction.type === "bookmark") {
        count += 1;
      }
    }

    return count;
  },
});

export const getDashboardOverview = query({
  args: {},
  handler: async (ctx) => {
    const authUser = await authComponent.safeGetAuthUser(ctx);
    if (!authUser) {
      return null;
    }

    const user = await getUserProfileByAuthUserId(ctx, authUser._id);
    if (!user) {
      return null;
    }

    const stats = await ctx.db
      .query("userStats")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .unique();

    const today = startOfUtcDay(Date.now());
    const streakWindowDays = 84;
    const streakStart = today - (streakWindowDays - 1) * DAY_MS;
    const streakStartKey = new Date(streakStart).toISOString().slice(0, 10);

    const [viewInteractions, allBookmarkInteractions, quizAttempts] =
      await Promise.all([
        ctx.db
          .query("interactions")
          .withIndex("by_user_type", (q) =>
            q.eq("userId", user._id).eq("type", "view"),
          )
          .order("desc")
          .collect() as Promise<ViewInteraction[]>,
        ctx.db
          .query("interactions")
          .withIndex("by_user", (q) => q.eq("userId", user._id))
          .order("desc")
          .collect(),
        ctx.db
          .query("quizAttempts")
          .withIndex("by_user_date", (q) =>
            q.eq("userId", user._id).gte("dateKey", streakStartKey),
          )
          .order("desc")
          .collect(),
      ]);

    const latestViewByEvent = new Map<string, ViewInteraction>();
    const visitCountByEvent = new Map<string, number>();
    const uniqueEventIdsByDay = new Map<number, Set<string>>();
    const recentBiasCutoff = Date.now() - 7 * DAY_MS;
    let recentBiasTotal = 0;
    let recentBiasReads = 0;

    for (const interaction of viewInteractions) {
      visitCountByEvent.set(
        interaction.eventId,
        (visitCountByEvent.get(interaction.eventId) ?? 0) + 1,
      );

      if (!latestViewByEvent.has(interaction.eventId)) {
        latestViewByEvent.set(interaction.eventId, interaction);
      }

      const dayTimestamp = startOfUtcDay(interaction.timestamp);
      const dayEvents =
        uniqueEventIdsByDay.get(dayTimestamp) ?? new Set<string>();
      dayEvents.add(interaction.eventId);
      uniqueEventIdsByDay.set(dayTimestamp, dayEvents);

      if (interaction.timestamp >= recentBiasCutoff) {
        recentBiasTotal += interaction.context?.biasRating ?? 0;
        recentBiasReads += 1;
      }
    }

    const quizAttemptsByDay = new Map<number, number>();
    for (const attempt of quizAttempts) {
      const dayTimestamp = startOfUtcDay(attempt.completedAt);
      quizAttemptsByDay.set(
        dayTimestamp,
        (quizAttemptsByDay.get(dayTimestamp) ?? 0) + 1,
      );
    }

    const recentHistoryEntries = Array.from(latestViewByEvent.values()).slice(
      0,
      6,
    );
    const historyPreviews = await Promise.all(
      recentHistoryEntries.map((interaction) =>
        buildDashboardEventPreview(ctx, interaction.eventId),
      ),
    );

    const recentHistory = recentHistoryEntries
      .map((interaction, index) => {
        const event = historyPreviews[index];
        if (!event) return null;

        return {
          event,
          lastViewedAt: interaction.timestamp,
          visitCount: visitCountByEvent.get(interaction.eventId) ?? 1,
          biasRating: interaction.context?.biasRating ?? 0,
          sourceReliability: interaction.context?.sourceReliability ?? 0,
          metadata: {
            timeSpentSeconds: interaction.metadata?.timeSpentSeconds,
            scrollDepthPercentage: interaction.metadata?.scrollDepthPercentage,
            deviceType: interaction.metadata?.deviceType,
          },
        };
      })
      .filter((entry) => entry !== null);

    const latestBookmarksByEvent = getLatestBookmarkInteractionsByEvent(
      allBookmarkInteractions,
    );
    const activeBookmarks = Array.from(latestBookmarksByEvent.values()).filter(
      (interaction) => interaction.type === "bookmark",
    );
    const bookmarkPreviews = await Promise.all(
      activeBookmarks
        .slice(0, 4)
        .map((interaction) =>
          buildDashboardEventPreview(ctx, interaction.eventId),
        ),
    );

    const recentBookmarks = activeBookmarks
      .slice(0, 4)
      .map((interaction, index) => {
        const event = bookmarkPreviews[index];
        if (!event) return null;

        return {
          event,
          bookmarkedAt: interaction.timestamp,
        };
      })
      .filter((entry) => entry !== null);

    const streakDays = Array.from({ length: streakWindowDays }, (_, index) => {
      const timestamp = today - (streakWindowDays - 1 - index) * DAY_MS;
      const activeSet = uniqueEventIdsByDay.get(timestamp);
      const quizCount = quizAttemptsByDay.get(timestamp) ?? 0;

      return {
        timestamp,
        activityCount: (activeSet?.size ?? 0) + quizCount,
        isToday: timestamp === today,
      };
    });

    return {
      stats: {
        currentStreak: stats?.currentStreak ?? 0,
        longestStreak: stats?.longestStreak ?? 0,
        articlesRead: stats?.articlesRead ?? 0,
        biasBalance: stats?.biasBalance ?? 0,
        bookmarkCount: activeBookmarks.length,
        eventsExplored: latestViewByEvent.size,
        lastActiveAt: stats?.lastActiveAt,
      },
      streakCalendar: {
        activeDays: streakDays.filter((day) => day.activityCount > 0).length,
        days: streakDays,
      },
      weeklyBiasSummary: {
        reads: recentBiasReads,
        balance:
          recentBiasReads > 0
            ? Math.max(
                -100,
                Math.min(
                  100,
                  Math.round((recentBiasTotal / recentBiasReads) * 20),
                ),
              )
            : 0,
      },
      recentHistory,
      recentBookmarks,
    };
  },
});

// ---------------------------------------------------------------------------
// Interaction Logging (generic — for views, clicks, shares, etc.)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Guest → account merge
// ---------------------------------------------------------------------------

const GUEST_READ_VALIDATOR = v.object({
  eventId: v.id("events"),
  timestamp: v.number(),
  timeSpentSeconds: v.optional(v.number()),
  scrollDepthPercentage: v.optional(v.number()),
  biasRating: v.optional(v.number()),
  sourceReliability: v.optional(v.number()),
});

/**
 * Defensive upper bound on reads replayed in a single merge. The client queue
 * is already capped at the same number (`MAX_QUEUED_READS` in the native
 * `guest-activity-queue`), so a well-behaved client never trips this; it only
 * guards the Convex transaction against a tampered/oversized payload. Reads
 * beyond the cap are dropped oldest-first (the most recent activity, which
 * drives the live streak, is what we keep).
 */
const MAX_MERGE_READS = 1000;

type GuestReadInput = {
  eventId: Id<"events">;
  timestamp: number;
  timeSpentSeconds?: number;
  scrollDepthPercentage?: number;
  biasRating?: number;
  sourceReliability?: number;
};

export type MergeGuestActivityResult =
  | {
      merged: false;
      reason: "already_merged";
      readsReplayed: number;
      topicsReplayed: number;
      streakDays: number;
    }
  | {
      merged: true;
      readsReplayed: number;
      topicsReplayed: number;
      streakDays: number;
    };

/**
 * Core guest→account merge, given an already-resolved `userId`. Split out from
 * the auth gate so it is unit-testable without the Better Auth component.
 *
 * Ticket 1: the previous implementation replayed up to 1000 reads as 1000 live
 * `recordInteraction` calls, each re-reading and re-patching the single
 * `userStats` row — ~4000 sequential DB ops that blow the Convex
 * read/write/time limits and roll the whole merge back, losing the guest's
 * entire history at signup. We instead **fold the stats in memory** and write
 * `userStats` exactly once. Interaction rows still persist (the guest's history
 * is the point), but event-existence lookups are cached so duplicate-event
 * reads cost one DB read, not N. Idempotency is preserved via the `guestMerges`
 * ledger; folding goes through the same `foldViewStats` as the live path, so
 * the result equals a day-by-day replay.
 */
export async function replayGuestMerge(
  ctx: MutationCtx,
  userId: Id<"users">,
  args: {
    deviceId: string;
    reads: GuestReadInput[];
    followedTopicIds: Id<"topics">[];
    /**
     * The streak the guest teaser last showed (qualified-read days). The merged
     * streak must never come out below it (Ticket 7) — a guest who saw "3-day
     * streak" before signing up must not land on a smaller number. The folded
     * streak counts every replayed view-day, but a late unqualified read can
     * leave the *current run* shorter than the qualified teaser run, so we clamp
     * up to the teaser value.
     */
    guestStreak?: number;
  },
): Promise<MergeGuestActivityResult> {
  // Idempotency: this device already merged into an account.
  const existingMerge = await ctx.db
    .query("guestMerges")
    .withIndex("by_device", (q) => q.eq("deviceId", args.deviceId))
    .first();
  if (existingMerge) {
    return {
      merged: false,
      reason: "already_merged",
      readsReplayed: 0,
      topicsReplayed: 0,
      streakDays: 0,
    };
  }

  // Replay reads oldest-first so the streak rebuilds day by day; bound the
  // count defensively (keep the most recent reads if over the cap).
  const orderedReads = [...args.reads]
    .sort((a, b) => a.timestamp - b.timestamp)
    .slice(-MAX_MERGE_READS);

  // Load (or lazily create) the single stats row. We fold every replayed read
  // into this accumulator in memory and patch the row once at the end.
  let stats = await ctx.db
    .query("userStats")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .unique();
  if (!stats) {
    const statsId = await ctx.db.insert("userStats", {
      userId,
      currentStreak: 0,
      longestStreak: 0,
      articlesRead: 0,
      biasBalance: 0,
    });
    stats = await ctx.db.get(statsId);
  }

  let folded: ViewStatsAccumulator = {
    currentStreak: stats?.currentStreak ?? 0,
    longestStreak: stats?.longestStreak ?? 0,
    articlesRead: stats?.articlesRead ?? 0,
    biasBalance: stats?.biasBalance ?? 0,
    lastActiveAt: stats?.lastActiveAt,
  };

  // Cache event-existence so a guest who re-read the same event many times
  // costs one read per *unique* event, not one per queue entry.
  const eventExists = new Map<string, boolean>();
  let readsReplayed = 0;
  for (const read of orderedReads) {
    let exists = eventExists.get(read.eventId);
    if (exists === undefined) {
      exists = (await ctx.db.get(read.eventId)) !== null;
      eventExists.set(read.eventId, exists);
    }
    // Skip reads whose event no longer exists — never dangle an interaction.
    if (!exists) continue;

    // Mirror the live path's context resolution: a read with no captured bias
    // stores a zeroed context (no article lookup happens here).
    const context: InteractionContext =
      read.biasRating !== undefined
        ? {
            biasRating: read.biasRating,
            sourceReliability: read.sourceReliability ?? 0,
          }
        : { biasRating: 0, sourceReliability: 0 };

    await ctx.db.insert("interactions", {
      userId,
      eventId: read.eventId,
      type: "view",
      context,
      metadata: normalizeInteractionMetadata({
        deviceType: "mobile",
        timeSpentSeconds: read.timeSpentSeconds,
        scrollDepthPercentage: read.scrollDepthPercentage,
      }),
      timestamp: read.timestamp,
    });

    folded = foldViewStats(folded, read.timestamp, context.biasRating);
    readsReplayed += 1;
  }

  // Ticket 7: the merged streak must never drop below the teaser the guest
  // saw. Clamp the current (and therefore longest) streak up to it.
  const teaserStreak = Math.max(0, Math.floor(args.guestStreak ?? 0));
  const mergedCurrentStreak = Math.max(folded.currentStreak, teaserStreak);
  const mergedLongestStreak = Math.max(folded.longestStreak, mergedCurrentStreak);

  // One stats write for the whole merge (vs one per read before).
  if (stats && readsReplayed > 0) {
    await ctx.db.patch(stats._id, {
      currentStreak: mergedCurrentStreak,
      longestStreak: mergedLongestStreak,
      articlesRead: folded.articlesRead,
      biasBalance: folded.biasBalance,
      lastActiveAt: folded.lastActiveAt,
    });
  }

  // Union followed topics with any the account already has (richer wins).
  const user = await ctx.db.get(userId);
  const existingTopics = user?.followedTopicIds ?? [];
  const mergedTopics = [...existingTopics];
  const seen = new Set<string>(existingTopics.map(String));
  for (const topicId of args.followedTopicIds) {
    if (seen.has(topicId)) continue;
    const topic = await ctx.db.get(topicId);
    if (topic) {
      seen.add(topicId);
      mergedTopics.push(topicId);
    }
  }
  if (mergedTopics.length !== existingTopics.length) {
    await ctx.db.patch(userId, { followedTopicIds: mergedTopics });
  }

  await ctx.db.insert("guestMerges", {
    userId,
    deviceId: args.deviceId,
    mergedAt: Date.now(),
    readsMerged: readsReplayed,
  });

  return {
    merged: true,
    readsReplayed,
    topicsReplayed: mergedTopics.length - existingTopics.length,
    streakDays: readsReplayed > 0 ? mergedCurrentStreak : folded.currentStreak,
  };
}

/**
 * Fold a guest's locally-queued activity into the now-authenticated account.
 * Called once per device after signup/login (decision 4 — a plain mutation,
 * no Better Auth hook). Thin wrapper that resolves auth; the merge logic lives
 * in {@link replayGuestMerge}.
 */
export const mergeGuestActivity = mutation({
  args: {
    deviceId: v.string(),
    reads: v.array(GUEST_READ_VALIDATOR),
    followedTopicIds: v.array(v.id("topics")),
    guestStreak: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<MergeGuestActivityResult> => {
    // Ticket 18: bound merge attempts per device (idempotent, but the replay is
    // expensive — don't let a device hammer it).
    await enforceRateLimit(ctx, {
      key: `merge:${args.deviceId}`,
      limit: 5,
      windowMs: 60_000,
    });
    const userId = await requireUserId(ctx);
    return replayGuestMerge(ctx, userId, args);
  },
});

/**
 * Whether a device's guest queue has been merged into an account, by the
 * `guestMerges` ledger. Ticket 3: logout consults this before clearing local
 * guest stores — an unmerged queue must be retained for retry, never deleted.
 * Keyed by the opaque device UUID and intentionally auth-free, since logout
 * runs as the session is being torn down.
 */
export const hasDeviceMerged = query({
  args: { deviceId: v.string() },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("guestMerges")
      .withIndex("by_device", (q) => q.eq("deviceId", args.deviceId))
      .first();
    return row !== null;
  },
});

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

    if (interactionType === "bookmark" || interactionType === "unbookmark") {
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
