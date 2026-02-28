import { v, ConvexError } from "convex/values";
import { mutation, query } from "./_generated/server";
import { authComponent } from "./auth";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Resolve the internal users._id for the currently-authenticated user. */
async function requireUserId(ctx: { db: any; auth: any }) {
	const authUser = await authComponent.safeGetAuthUser(ctx as any);
	if (!authUser) throw new ConvexError("Not authenticated");

	const user = await ctx.db
		.query("users")
		.withIndex("by_auth_user_id", (q: any) => q.eq("authUserId", authUser._id))
		.unique();
	if (!user) throw new ConvexError("User profile not found");

	return user._id;
}

// ---------------------------------------------------------------------------
// Bookmarks
// ---------------------------------------------------------------------------

/**
 * Toggle a bookmark on an event.
 * If the user already bookmarked the event, remove it. Otherwise, create it.
 * Returns `{ bookmarked: boolean }`.
 */
export const toggleBookmark = mutation({
	args: { eventId: v.id("events") },
	handler: async (ctx, args) => {
		const userId = await requireUserId(ctx);

		const existing = await ctx.db
			.query("interactions")
			.withIndex("by_user_event_type", (q) =>
				q
					.eq("userId", userId)
					.eq("eventId", args.eventId)
					.eq("type", "bookmark"),
			)
			.unique();

		if (existing) {
			await ctx.db.delete(existing._id);
			return { bookmarked: false };
		}

		await ctx.db.insert("interactions", {
			userId,
			eventId: args.eventId,
			type: "bookmark",
			context: { biasRating: 0, sourceReliability: 0 },
			metadata: {},
			timestamp: Date.now(),
		});

		return { bookmarked: true };
	},
});

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
			.withIndex("by_auth_user_id", (q) =>
				q.eq("authUserId", authUser._id),
			)
			.unique();
		if (!user) return false;

		const existing = await ctx.db
			.query("interactions")
			.withIndex("by_user_event_type", (q) =>
				q
					.eq("userId", user._id)
					.eq("eventId", args.eventId)
					.eq("type", "bookmark"),
			)
			.unique();

		return existing !== null;
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
			.withIndex("by_auth_user_id", (q) =>
				q.eq("authUserId", authUser._id),
			)
			.unique();
		if (!user) return [];

		const bookmarks = await ctx.db
			.query("interactions")
			.withIndex("by_user_type", (q) =>
				q.eq("userId", user._id).eq("type", "bookmark"),
			)
			.order("desc")
			.collect();

		const events = await Promise.all(
			bookmarks.map(async (bookmark) => {
				const event = await ctx.db.get(bookmark.eventId);
				if (!event || event.status !== "published") return null;

				const articles = await ctx.db
					.query("articles")
					.withIndex("by_event", (q) => q.eq("eventId", event._id))
					.collect();

				const sourceIds = Array.from(
					new Set(articles.map((a) => a.sourceId)),
				);
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
				extras: v.optional(v.any()),
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
