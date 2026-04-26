import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { internalMutation, internalQuery } from "./_generated/server";

export const SHARE_IMAGE_WIDTH = 1080;
export const SHARE_IMAGE_HEIGHT = 566;
const SHARE_RENDER_VERSION = "v7-resvg-js-inter-ttf-1080";

export type EventShareRenderData = {
  title: string;
  summary?: string;
  imageUrl?: string;
  imageAlt?: string;
  lastUpdatedAt: number;
  articleCount: number;
  sourceCount: number;
  sources: Array<{
    name: string;
    logoUrl?: string;
  }>;
};

export function buildEventShareRenderSignature(
  data: EventShareRenderData,
): string {
  return [
    SHARE_RENDER_VERSION,
    data.title,
    data.summary ?? "",
    data.imageUrl ?? "",
    String(data.lastUpdatedAt),
    String(data.articleCount),
    ...data.sources
      .slice(0, 3)
      .flatMap((source) => [source.name, source.logoUrl ?? ""]),
  ].join("|");
}

async function getLatestEventShareAsset(
  ctx: QueryCtx | MutationCtx,
  eventId: Id<"events">,
) {
  return await ctx.db
    .query("eventShareAssets")
    .withIndex("by_event", (q) => q.eq("eventId", eventId))
    .order("desc")
    .first();
}

async function dedupeEventShareAssets(ctx: MutationCtx, eventId: Id<"events">) {
  const assets = await ctx.db
    .query("eventShareAssets")
    .withIndex("by_event", (q) => q.eq("eventId", eventId))
    .order("desc")
    .collect();

  if (assets.length <= 1) {
    return assets[0] ?? null;
  }

  const [latest, ...duplicates] = assets;
  for (const duplicate of duplicates) {
    await ctx.db.delete(duplicate._id);
  }
  return latest;
}

export const getEventShareRenderData = internalQuery({
  args: { eventId: v.id("events") },
  handler: async (ctx, { eventId }) => {
    const event = await ctx.db.get(eventId);
    if (!event) return null;

    const articles = await ctx.db
      .query("articles")
      .withIndex("by_event", (q) => q.eq("eventId", eventId))
      .collect();
    const uniqueSourceIds = Array.from(
      new Set(articles.map((article) => article.sourceId)),
    );
    const sources = (
      await Promise.all(uniqueSourceIds.map((sourceId) => ctx.db.get(sourceId)))
    ).filter((source) => source !== null);

    return {
      title: event.title,
      summary: event.perspectiveSummaries?.center ?? event.globalImpact,
      imageUrl: event.imageUrl,
      imageAlt: event.imageAlt,
      lastUpdatedAt: event.lastUpdatedAt ?? event.firstPublishedAt,
      articleCount: articles.length,
      sourceCount: sources.length,
      sources: sources.map((source) => ({
        name: source.name,
        logoUrl: source.logoUrl,
      })),
    } satisfies EventShareRenderData;
  },
});

export const getEventShareAsset = internalQuery({
  args: { eventId: v.id("events") },
  handler: async (ctx, { eventId }) => {
    return await getLatestEventShareAsset(ctx, eventId);
  },
});

export const ensureEventShareAssetQueued = internalMutation({
  args: {
    eventId: v.id("events"),
    renderSignature: v.string(),
  },
  handler: async (ctx, { eventId, renderSignature }) => {
    const existing = await dedupeEventShareAssets(ctx, eventId);

    if (
      existing &&
      existing.renderSignature === renderSignature &&
      (existing.status === "pending" || existing.status === "ready")
    ) {
      return { queued: false as const };
    }

    if (existing) {
      await ctx.db.patch(existing._id, {
        renderSignature,
        status: "pending",
        error: undefined,
        updatedAt: Date.now(),
      });
    } else {
      await ctx.db.insert("eventShareAssets", {
        eventId,
        width: SHARE_IMAGE_WIDTH,
        height: SHARE_IMAGE_HEIGHT,
        renderSignature,
        status: "pending",
        updatedAt: Date.now(),
      });

      await dedupeEventShareAssets(ctx, eventId);
    }

    await ctx.scheduler.runAfter(
      0,
      internal.shareAssetsNode.generateEventShareAsset,
      {
        eventId,
        renderSignature,
      },
    );

    return { queued: true as const };
  },
});

export const markEventShareAssetReady = internalMutation({
  args: {
    eventId: v.id("events"),
    renderSignature: v.string(),
    storageId: v.id("_storage"),
    contentType: v.string(),
  },
  handler: async (
    ctx,
    { eventId, renderSignature, storageId, contentType },
  ) => {
    const existing = await dedupeEventShareAssets(ctx, eventId);

    if (!existing) {
      await ctx.db.insert("eventShareAssets", {
        eventId,
        storageId,
        contentType,
        width: SHARE_IMAGE_WIDTH,
        height: SHARE_IMAGE_HEIGHT,
        renderSignature,
        status: "ready",
        updatedAt: Date.now(),
      });
      return { previousStorageId: null };
    }

    const previousStorageId = existing.storageId ?? null;
    await ctx.db.patch(existing._id, {
      storageId,
      contentType,
      width: SHARE_IMAGE_WIDTH,
      height: SHARE_IMAGE_HEIGHT,
      renderSignature,
      status: "ready",
      error: undefined,
      updatedAt: Date.now(),
    });

    return { previousStorageId };
  },
});

export const markEventShareAssetFailed = internalMutation({
  args: {
    eventId: v.id("events"),
    renderSignature: v.string(),
    error: v.string(),
  },
  handler: async (ctx, { eventId, renderSignature, error }) => {
    const existing = await dedupeEventShareAssets(ctx, eventId);
    if (!existing) return;

    await ctx.db.patch(existing._id, {
      renderSignature,
      status: "failed",
      error: error.slice(0, 500),
      updatedAt: Date.now(),
    });
  },
});
