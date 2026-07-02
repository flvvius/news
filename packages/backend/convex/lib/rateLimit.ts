import { ConvexError } from "convex/values";
import type { MutationCtx } from "../_generated/server";

/**
 * Fixed-window rate limit (Ticket 18). Keeps one counter row per `key`; within
 * a `windowMs` window at most `limit` calls are allowed, after which it throws a
 * ConvexError the client surfaces as a transient failure. Cheap and good enough
 * to blunt abuse of guest-reachable + auth mutations without a dedicated
 * component.
 *
 * `key` should encode the action and the subject, e.g. `merge:<deviceId>`.
 */
export async function enforceRateLimit(
  ctx: MutationCtx,
  params: { key: string; limit: number; windowMs: number; now?: number },
): Promise<void> {
  const now = params.now ?? Date.now();
  const existing = await ctx.db
    .query("rateLimits")
    .withIndex("by_key", (q) => q.eq("key", params.key))
    .unique();

  if (!existing) {
    await ctx.db.insert("rateLimits", {
      key: params.key,
      count: 1,
      windowStartedAt: now,
    });
    return;
  }

  // Window elapsed → reset the counter for a fresh window.
  if (now - existing.windowStartedAt >= params.windowMs) {
    await ctx.db.patch(existing._id, { count: 1, windowStartedAt: now });
    return;
  }

  if (existing.count >= params.limit) {
    throw new ConvexError({
      code: "rate_limited",
      message: "Too many requests. Please try again shortly.",
      retryAfterMs: params.windowMs - (now - existing.windowStartedAt),
    });
  }

  await ctx.db.patch(existing._id, { count: existing.count + 1 });
}
