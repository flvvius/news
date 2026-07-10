/**
 * L5 — domain permission store (queries/mutations). The network resolver
 * lives in domainPermissionsNode.ts; this module owns the cached state,
 * the restrictiveness ordering, and the purge that fires when a domain
 * becomes more restrictive.
 */

import { v } from "convex/values";
import { internalMutation, internalQuery, mutation } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { requireAdminUser } from "./lib/betaAccess";
import type { DomainPermissionState } from "./lib/tdmPolicy";

export const PERMISSION_TTL_MS = 24 * 60 * 60 * 1000;
const PURGE_PAGE_SIZE = 100;

const STATE_VALIDATOR = v.union(
  v.literal("full"),
  v.literal("rss_only"),
  v.literal("blocked"),
);

const RESTRICTIVENESS: Record<DomainPermissionState, number> = {
  full: 0,
  rss_only: 1,
  blocked: 2,
};

export function isMoreRestrictive(
  next: DomainPermissionState,
  previous: DomainPermissionState,
): boolean {
  return RESTRICTIVENESS[next] > RESTRICTIVENESS[previous];
}

export const getDomainPermissionsBatch = internalQuery({
  args: { domains: v.array(v.string()) },
  handler: async (ctx, { domains }) => {
    const unique = Array.from(new Set(domains));
    const rows = await Promise.all(
      unique.map(async (domain) => {
        const row = await ctx.db
          .query("domainPermissions")
          .withIndex("by_domain", (q) => q.eq("domain", domain))
          .unique();
        return [domain, row] as const;
      }),
    );
    return rows.map(([domain, row]) => ({
      domain,
      state: row?.state,
      expiresAt: row?.expiresAt,
      manualOverride: row?.manualOverride,
      crawlDelaySeconds: row?.crawlDelaySeconds,
    }));
  },
});

async function applyPermissionUpsert(
  ctx: MutationCtx,
  args: {
    domain: string;
    state: DomainPermissionState;
    signals: string[];
    crawlDelaySeconds?: number;
    lastError?: string;
    manualOverride?: boolean;
  },
) {
  const now = Date.now();
  const existing = await ctx.db
    .query("domainPermissions")
    .withIndex("by_domain", (q) => q.eq("domain", args.domain))
    .unique();

  // A manual block (publisher opt-out, L6) is never loosened automatically.
  const nextState =
    existing?.manualOverride && !args.manualOverride
      ? existing.state
      : args.state;

  const row = {
    domain: args.domain,
    state: nextState,
    signals: args.signals,
    manualOverride: args.manualOverride ?? existing?.manualOverride,
    crawlDelaySeconds: args.crawlDelaySeconds ?? existing?.crawlDelaySeconds,
    resolvedAt: now,
    expiresAt: now + PERMISSION_TTL_MS,
    lastError: args.lastError,
    updatedAt: now,
  };
  if (existing) {
    await ctx.db.replace(existing._id, row);
  } else {
    await ctx.db.insert("domainPermissions", row);
  }

  // State became more restrictive → stop extraction (fetchers gate on the
  // stored state) and purge extraction-derived content for the domain.
  const previousState = existing?.state ?? "full";
  if (isMoreRestrictive(nextState, previousState)) {
    console.warn(
      `[domain-permissions] ${args.domain}: ${previousState} → ${nextState} (${args.signals.join(", ") || "manual"}) — purging extracted content`,
    );
    await ctx.scheduler.runAfter(
      0,
      internal.domainPermissions.purgeDomainExtractedContent,
      { domain: args.domain },
    );
  }

  return { state: nextState, changed: previousState !== nextState };
}

export const upsertDomainPermission = internalMutation({
  args: {
    domain: v.string(),
    state: STATE_VALIDATOR,
    signals: v.array(v.string()),
    crawlDelaySeconds: v.optional(v.number()),
    lastError: v.optional(v.string()),
    manualOverride: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    return await applyPermissionUpsert(ctx, args);
  },
});

/**
 * Purge extraction-derived third-party content for a domain that opted out:
 * extracted summaries, atomic facts and entities. Full article body text is
 * never persisted anywhere (no-article-body-storage rule), so this covers
 * everything extraction ever stored. RSS headline+link+≤120-char snippet
 * stay — rss_only permits them; a `blocked` domain's articles are discarded
 * entirely.
 */
export const purgeDomainExtractedContent = internalMutation({
  args: {
    domain: v.string(),
    cursor: v.optional(v.string()),
  },
  handler: async (ctx, { domain, cursor }) => {
    const permission = await ctx.db
      .query("domainPermissions")
      .withIndex("by_domain", (q) => q.eq("domain", domain))
      .unique();
    const state: DomainPermissionState = permission?.state ?? "rss_only";
    if (state === "full") {
      return { purged: 0, done: true };
    }

    const source = await ctx.db
      .query("sources")
      .withIndex("by_domain", (q) => q.eq("domain", domain))
      .first();
    if (!source) {
      return { purged: 0, done: true };
    }

    const page = await ctx.db
      .query("articles")
      .withIndex("by_source", (q) => q.eq("sourceId", source._id))
      .paginate({ cursor: cursor ?? null, numItems: PURGE_PAGE_SIZE });

    let purged = 0;
    for (const article of page.page) {
      if (state === "blocked") {
        await ctx.db.patch(article._id, {
          summary: undefined,
          atomicFacts: undefined,
          entities: undefined,
          rssSnippet: undefined,
          imageUrl: undefined,
          extractionQuality: undefined,
          status: "discarded",
        });
        purged++;
        continue;
      }
      if (
        article.summary !== undefined ||
        (article.atomicFacts?.length ?? 0) > 0 ||
        article.extractionQuality === "strong"
      ) {
        await ctx.db.patch(article._id, {
          summary: undefined,
          atomicFacts: undefined,
          extractionQuality: article.extractionQuality ? "weak" : undefined,
        });
        purged++;
      }
    }

    if (!page.isDone) {
      await ctx.scheduler.runAfter(
        0,
        internal.domainPermissions.purgeDomainExtractedContent,
        { domain, cursor: page.continueCursor },
      );
    }
    return { purged, done: page.isDone };
  },
});

/**
 * L6 hook — one admin action flips a domain to blocked (publisher opt-out)
 * and purges its stored content.
 */
export const blockDomainForAdmin = mutation({
  args: {
    domain: v.string(),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, { domain, reason }) => {
    await requireAdminUser(ctx);
    return await applyPermissionUpsert(ctx, {
      domain,
      state: "blocked",
      signals: [reason ? `manual:${reason}` : "manual_block"],
      manualOverride: true,
    });
  },
});
