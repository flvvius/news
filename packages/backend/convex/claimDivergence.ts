import { ConvexError, v } from "convex/values";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { requireAdminUser, requireBetaAccess } from "./lib/betaAccess";
import { refreshEventClaimCoverage } from "./lib/eventClaimCoverage";

const CLAIM_STATUS_VALIDATOR = v.union(
  v.literal("agreement"),
  v.literal("divergence"),
  v.literal("framing"),
  v.literal("exclusive_left"),
  v.literal("exclusive_right"),
  v.literal("exclusive_center"),
);

const CLAIM_TYPE_VALIDATOR = v.union(
  v.literal("quantitative"),
  v.literal("event"),
  v.literal("attribution"),
  v.literal("policy"),
  v.literal("characterization"),
);

const CLAIM_VARIANT_VALIDATOR = v.object({
  articleId: v.id("articles"),
  sourceId: v.id("sources"),
  sourceLean: v.string(),
  sourceFactIndex: v.optional(v.number()),
  statement: v.string(),
  value: v.optional(v.string()),
});

const CLAIM_INPUT_VALIDATOR = v.object({
  canonicalStatement: v.string(),
  claimType: CLAIM_TYPE_VALIDATOR,
  status: CLAIM_STATUS_VALIDATOR,
  variants: v.array(CLAIM_VARIANT_VALIDATOR),
  importance: v.number(),
  confidence: v.number(),
});

function sourceLean(source: Doc<"sources"> | null): string {
  if (!source) return "center";
  if (source.mbfcCategory) return source.mbfcCategory;
  if (source.baseBias <= -3) return "left";
  if (source.baseBias < 0) return "left-center";
  if (source.baseBias >= 3) return "right";
  if (source.baseBias > 0) return "right-center";
  return "center";
}

function leanGroup(lean: string): "left" | "center" | "right" | "other" {
  if (lean === "left" || lean === "left-center") return "left";
  if (lean === "right" || lean === "right-center") return "right";
  if (lean === "center") return "center";
  return "other";
}

function hasAtomicFacts(article: Doc<"articles">): boolean {
  return (article.atomicFacts ?? []).some((fact) => fact.trim().length > 0);
}

function eventNeedsAnalysis(
  event: Doc<"events">,
  now: number,
  staleAfterMs: number,
): boolean {
  const lastAnalysisAt = event.lastClaimAnalysisAt ?? 0;
  const changedAt =
    event.lastFactualUpdateAt ?? event.lastUpdatedAt ?? event.firstPublishedAt;
  return lastAnalysisAt < changedAt || now - lastAnalysisAt >= staleAfterMs;
}

async function backfillClaimCoverage(
  ctx: MutationCtx,
  args: { limit?: number; includeExisting?: boolean },
) {
  const limit = Math.max(1, Math.min(500, Math.floor(args.limit ?? 100)));
  const scanLimit = Math.min(1000, limit * 3);
  const events = await ctx.db
    .query("events")
    .withIndex("by_status_recency", (q) => q.eq("status", "published"))
    .order("desc")
    .take(scanLimit);

  let inspected = 0;
  let refreshed = 0;
  let skipped = 0;

  for (const event of events) {
    if (refreshed >= limit) break;
    inspected++;

    if (
      !args.includeExisting &&
      event.factualArticleCount !== undefined &&
      event.factualSourceCount !== undefined &&
      event.lastFactualUpdateAt !== undefined
    ) {
      skipped++;
      continue;
    }

    await refreshEventClaimCoverage(ctx, event._id);
    refreshed++;
  }

  return { inspected, refreshed, skipped };
}

export const getStaleEventsForClaimAnalysis = internalQuery({
  args: {
    limit: v.number(),
    scanLimit: v.number(),
    minArticles: v.number(),
    minSources: v.number(),
    staleAfterMs: v.number(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const minArticles = Math.max(1, Math.floor(args.minArticles));
    const minSources = Math.max(1, Math.floor(args.minSources));
    const events = await ctx.db
      .query("events")
      .withIndex("by_status_factual_coverage", (q) =>
        q.eq("status", "published").gte("factualSourceCount", minSources),
      )
      .take(Math.max(1, Math.min(250, Math.floor(args.scanLimit))));

    const candidates = [];
    for (const event of events) {
      if (
        !eventNeedsAnalysis(event, now, Math.max(5 * 60 * 1000, args.staleAfterMs))
      ) {
        continue;
      }

      if (
        (event.factualArticleCount ?? 0) >= minArticles &&
        (event.factualSourceCount ?? 0) >= minSources
      ) {
        candidates.push({
          _id: event._id,
          title: event.title,
          articleCount: event.factualArticleCount ?? 0,
          sourceCount: event.factualSourceCount ?? 0,
          lastUpdatedAt: event.lastUpdatedAt ?? event.firstPublishedAt,
          lastClaimAnalysisAt: event.lastClaimAnalysisAt,
        });
      }

      if (candidates.length >= Math.max(1, Math.floor(args.limit))) break;
    }

    return candidates;
  },
});

export const backfillEventClaimCoverage = internalMutation({
  args: {
    limit: v.optional(v.number()),
    includeExisting: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    return await backfillClaimCoverage(ctx, args);
  },
});

export const backfillEventClaimCoverageForAdmin = mutation({
  args: {
    limit: v.optional(v.number()),
    includeExisting: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    await requireAdminUser(ctx);
    return await backfillClaimCoverage(ctx, args);
  },
});

export const getClaimAnalysisInput = internalQuery({
  args: {
    eventId: v.id("events"),
    minArticles: v.number(),
    minSources: v.number(),
    maxArticles: v.number(),
    maxFactsPerArticle: v.number(),
  },
  handler: async (ctx, args) => {
    const event = await ctx.db.get(args.eventId);
    if (!event || event.status !== "published") {
      return {
        eligible: false as const,
        reason: !event ? "event_missing" : "event_not_published",
      };
    }

    const articles = await ctx.db
      .query("articles")
      .withIndex("by_event", (q) => q.eq("eventId", args.eventId))
      .collect();
    const factualArticles = articles
      .filter(hasAtomicFacts)
      .sort((a, b) => b.publishedAt - a.publishedAt)
      .slice(0, Math.max(3, Math.min(30, Math.floor(args.maxArticles))));

    const sourceIds = Array.from(
      new Set(factualArticles.map((article) => article.sourceId)),
    );

    if (
      factualArticles.length < Math.max(1, Math.floor(args.minArticles)) ||
      sourceIds.length < Math.max(1, Math.floor(args.minSources))
    ) {
      return {
        eligible: false as const,
        reason: "not_enough_fact_coverage",
        articleCount: factualArticles.length,
        sourceCount: sourceIds.length,
      };
    }

    const sourceRows = await Promise.all(
      sourceIds.map(async (sourceId) => [sourceId, await ctx.db.get(sourceId)] as const),
    );
    const sourcesById = new Map(sourceRows);
    const maxFacts = Math.max(1, Math.min(15, Math.floor(args.maxFactsPerArticle)));

    return {
      eligible: true as const,
      event: {
        _id: event._id,
        title: event.title,
        slug: event.slug,
        firstPublishedAt: event.firstPublishedAt,
        lastUpdatedAt: event.lastUpdatedAt,
        lastClaimAnalysisAt: event.lastClaimAnalysisAt,
        lastClaimAnalysisSignature: event.lastClaimAnalysisSignature,
      },
      articleCount: factualArticles.length,
      sourceCount: sourceIds.length,
      articles: factualArticles.map((article) => {
        const source = sourcesById.get(article.sourceId) ?? null;
        return {
          _id: article._id,
          sourceId: article.sourceId,
          sourceName: source?.name ?? "Unknown source",
          sourceLean: sourceLean(source),
          sourceLeanGroup: leanGroup(sourceLean(source)),
          sourceReliability: source?.reliabilityScore ?? 5,
          title: article.title,
          publishedAt: article.publishedAt,
          atomicFacts: (article.atomicFacts ?? [])
            .filter((fact) => fact.trim().length > 0)
            .slice(0, maxFacts),
        };
      }),
    };
  },
});

export const replaceEventClaims = internalMutation({
  args: {
    eventId: v.id("events"),
    claims: v.array(CLAIM_INPUT_VALIDATOR),
    analysisSignature: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const existing = await ctx.db
      .query("eventClaims")
      .withIndex("by_event", (q) => q.eq("eventId", args.eventId))
      .collect();

    for (const claim of existing) {
      await ctx.db.delete(claim._id);
    }

    for (const claim of args.claims) {
      await ctx.db.insert("eventClaims", {
        eventId: args.eventId,
        canonicalStatement: claim.canonicalStatement.trim(),
        claimType: claim.claimType,
        status: claim.status,
        variants: claim.variants.map((variant) => ({
          articleId: variant.articleId,
          sourceId: variant.sourceId,
          sourceLean: variant.sourceLean,
          sourceFactIndex: variant.sourceFactIndex,
          statement: variant.statement.trim(),
          value: variant.value?.trim() || undefined,
        })),
        importance: Math.max(1, Math.min(5, Math.round(claim.importance))),
        confidence: Math.max(0, Math.min(1, claim.confidence)),
        generatedAt: now,
      });
    }

    const event = await ctx.db.get(args.eventId);
    await ctx.db.patch(args.eventId, {
      lastClaimAnalysisAt: now,
      lastClaimAnalysisSignature:
        args.analysisSignature ?? event?.lastClaimAnalysisSignature,
    });

    return { replaced: existing.length, inserted: args.claims.length };
  },
});

export const markEventClaimAnalysisSkipped = internalMutation({
  args: {
    eventId: v.id("events"),
    analysisSignature: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const event = await ctx.db.get(args.eventId);
    if (!event) return;
    await ctx.db.patch(args.eventId, {
      lastClaimAnalysisAt: Date.now(),
      lastClaimAnalysisSignature:
        args.analysisSignature ?? event.lastClaimAnalysisSignature,
    });
  },
});

export const getEventClaims = query({
  args: {
    eventId: v.id("events"),
    status: v.optional(CLAIM_STATUS_VALIDATOR),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireBetaAccess(ctx);

    const event = await ctx.db.get(args.eventId);
    if (!event || event.status !== "published") {
      throw new ConvexError("Event is not readable");
    }

    const limit = Math.max(1, Math.min(50, Math.floor(args.limit ?? 20)));
    const rows = args.status
      ? await ctx.db
          .query("eventClaims")
          .withIndex("by_event_status", (q) =>
            q.eq("eventId", args.eventId).eq("status", args.status!),
          )
          .collect()
      : await ctx.db
          .query("eventClaims")
          .withIndex("by_event", (q) => q.eq("eventId", args.eventId))
          .collect();

    return rows
      .sort((a, b) => b.importance - a.importance || b.confidence - a.confidence)
      .slice(0, limit);
  },
});
