import { v, ConvexError } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { authComponent } from "./auth";
import { getConfig } from "./config";
import { normalizeEmail } from "./lib/betaAccess";
import {
  getPublicPreviewByEventId,
  MAX_PREVIEW_SOURCES,
} from "./lib/publicEventPreviews";

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
    v.union(
      v.literal("mobile"),
      v.literal("tablet"),
      v.literal("desktop"),
    ),
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
    deviceType?: "mobile" | "tablet" | "desktop";
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
          .withIndex("by_user_date", (q) => q.eq("userId", user._id))
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
      const dayEvents = uniqueEventIdsByDay.get(dayTimestamp) ?? new Set<string>();
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
        .map((interaction) => buildDashboardEventPreview(ctx, interaction.eventId)),
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

    const today = startOfUtcDay(Date.now());
    const streakDays = Array.from({ length: 84 }, (_, index) => {
      const timestamp = today - (83 - index) * DAY_MS;
      const activeSet = uniqueEventIdsByDay.get(timestamp);
      const quizCount = quizAttemptsByDay.get(timestamp) ?? 0;

      return {
        timestamp,
        readCount: (activeSet?.size ?? 0) + quizCount,
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
        activeDays: streakDays.filter((day) => day.readCount > 0).length,
        days: streakDays,
      },
      weeklyBiasSummary: {
        reads: recentBiasReads,
        balance:
          recentBiasReads > 0
            ? Math.max(
                -100,
                Math.min(100, Math.round((recentBiasTotal / recentBiasReads) * 20)),
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
