import { v } from "convex/values";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { requireAdminUser } from "./lib/betaAccess";
import {
  buildEventShareRenderSignature,
  type EventShareRenderData,
} from "./shareAssets";

const TERMINAL_SUCCESS_WINDOW_MS = 60 * 60 * 1000;
const DEFAULT_MIN_ARTICLES = 3;
const DEFAULT_MIN_SOURCES = 2;

type SummaryEligibility = {
  eligible: boolean;
  articleCount: number;
  sourceCount: number;
  reason?: string;
};

type SummaryQueueHealth = {
  scannedQueuedJobs: number;
  queuedJobs: number;
  queuedUniqueEvents: number;
  duplicateQueuedEvents: number;
  duplicateQueuedJobs: number;
  duplicateRatio: number;
  processingJobs: number;
  failedJobs: number;
  truncated: {
    queued: boolean;
    processing: boolean;
    failed: boolean;
  };
};

function sourceBiasLabel(source: Doc<"sources"> | null): string {
  if (!source) return "unknown";
  if (source.mbfcCategory) return source.mbfcCategory;
  if (source.baseBias === 0) return "center";
  if (source.baseBias <= -3) return "left";
  if (source.baseBias < 0) return "left-center";
  if (source.baseBias >= 3) return "right";
  if (source.baseBias > 0) return "right-center";
  return "center";
}

function safeInteger(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(parsed)));
}

function shouldResummarize(event: Doc<"events">): boolean {
  if (event.status !== "published") return false;

  const hasFullAiSummary = Boolean(
    event.perspectiveSummaries?.center?.trim() &&
      event.perspectiveSummaries?.left?.trim() &&
      event.perspectiveSummaries?.right?.trim() &&
      event.globalImpact?.trim() &&
      event.lastSummarizedAt,
  );
  if (!hasFullAiSummary) return true;

  const changedAt = event.lastUpdatedAt ?? event.firstPublishedAt;
  return (event.lastSummarizedAt ?? 0) < changedAt;
}

async function getLatestSummaryJob(
  ctx: QueryCtx | MutationCtx,
  eventId: Id<"events">,
) {
  return await ctx.db
    .query("eventSummaryJobs")
    .withIndex("by_event_updatedAt", (q) => q.eq("eventId", eventId))
    .order("desc")
    .first();
}

function summaryJobBlocksEnqueue(
  job: Doc<"eventSummaryJobs">,
  now: number,
): boolean {
  if (job.status === "queued") return true;
  if (job.status === "processing") return (job.leaseExpiresAt ?? 0) > now;
  if (job.status === "failed") {
    return job.nextAttemptAt < Number.MAX_SAFE_INTEGER;
  }
  return false;
}

async function hasBlockingSummaryJob(
  ctx: QueryCtx | MutationCtx,
  eventId: Id<"events">,
  now: number,
): Promise<boolean> {
  const [queued, processing, failed] = await Promise.all([
    ctx.db
      .query("eventSummaryJobs")
      .withIndex("by_event_status", (q) =>
        q.eq("eventId", eventId).eq("status", "queued"),
      )
      .first(),
    ctx.db
      .query("eventSummaryJobs")
      .withIndex("by_event_status", (q) =>
        q.eq("eventId", eventId).eq("status", "processing"),
      )
      .collect(),
    ctx.db
      .query("eventSummaryJobs")
      .withIndex("by_event_status", (q) =>
        q.eq("eventId", eventId).eq("status", "failed"),
      )
      .collect(),
  ]);

  return Boolean(
    queued ||
      processing.some((job) => summaryJobBlocksEnqueue(job, now)) ||
      failed.some((job) => summaryJobBlocksEnqueue(job, now)),
  );
}

async function getEventEligibility(
  ctx: QueryCtx | MutationCtx,
  event: Doc<"events">,
  minArticles: number,
  minSources: number,
): Promise<SummaryEligibility> {
  if (!shouldResummarize(event)) {
    return {
      eligible: false,
      articleCount: 0,
      sourceCount: 0,
      reason: "event_summary_current",
    };
  }

  const articles = await ctx.db
    .query("articles")
    .withIndex("by_event", (q) => q.eq("eventId", event._id))
    .collect();
  const sourceCount = new Set(articles.map((article) => article.sourceId)).size;

  if (articles.length < minArticles) {
    return {
      eligible: false,
      articleCount: articles.length,
      sourceCount,
      reason: "not_enough_articles",
    };
  }

  if (sourceCount < minSources) {
    return {
      eligible: false,
      articleCount: articles.length,
      sourceCount,
      reason: "not_enough_sources",
    };
  }

  return {
    eligible: true,
    articleCount: articles.length,
    sourceCount,
  };
}

async function buildShareRenderData(
  ctx: MutationCtx,
  event: Doc<"events">,
): Promise<EventShareRenderData> {
  const articles = await ctx.db
    .query("articles")
    .withIndex("by_event", (q) => q.eq("eventId", event._id))
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
  };
}

async function enqueueEligibleEvents(
  ctx: MutationCtx,
  events: Doc<"events">[],
  safeLimit: number,
  minArticles: number,
  minSources: number,
) {
  const now = Date.now();
  let queued = 0;
  let inspected = 0;
  let skipped = 0;

  for (const event of events) {
    if (queued >= safeLimit) break;
    inspected++;

    const eligibility = await getEventEligibility(
      ctx,
      event,
      minArticles,
      minSources,
    );
    if (!eligibility.eligible) {
      skipped++;
      continue;
    }

    const latestJob = await getLatestSummaryJob(ctx, event._id);
    if (await hasBlockingSummaryJob(ctx, event._id, now)) {
      skipped++;
      continue;
    }
    if (
      latestJob?.status === "succeeded" &&
      event.lastSummarizedAt &&
      now - latestJob.updatedAt < TERMINAL_SUCCESS_WINDOW_MS &&
      (event.lastSummarizedAt ?? 0) >=
        (event.lastUpdatedAt ?? event.firstPublishedAt)
    ) {
      skipped++;
      continue;
    }

    await ctx.db.insert("eventSummaryJobs", {
      eventId: event._id,
      status: "queued",
      reason: "eligible_event",
      attempts: 0,
      requestedAt: now,
      nextAttemptAt: now,
      updatedAt: now,
      articleCount: eligibility.articleCount,
      sourceCount: eligibility.sourceCount,
    });
    queued++;
  }

  return { queued, inspected, skipped };
}

export const enqueueEligibleEventSummaries = internalMutation({
  args: {
    limit: v.number(),
    minArticles: v.number(),
    minSources: v.number(),
  },
  handler: async (ctx, { limit, minArticles, minSources }) => {
    const safeLimit = Math.min(Math.max(Math.floor(limit), 1), 100);
    const events = await ctx.db
      .query("events")
      .withIndex("by_status_recency", (q) => q.eq("status", "published"))
      .order("desc")
      .take(safeLimit * 3);

    return enqueueEligibleEvents(ctx, events, safeLimit, minArticles, minSources);
  },
});

export const enqueueEligibleEventSummariesBackfill = internalMutation({
  args: {
    limit: v.optional(v.number()),
    scanLimit: v.optional(v.number()),
    minArticles: v.number(),
    minSources: v.number(),
    cursor: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const safeLimit = Math.min(Math.max(Math.floor(args.limit ?? 50), 1), 200);
    const safeScanLimit = Math.min(
      Math.max(Math.floor(args.scanLimit ?? safeLimit * 5), safeLimit),
      1000,
    );
    const page = await ctx.db
      .query("events")
      .withIndex("by_status_recency", (q) => q.eq("status", "published"))
      .order("desc")
      .paginate({
        cursor: args.cursor ?? null,
        numItems: safeScanLimit,
      });
    const events = page.page;

    const result = await enqueueEligibleEvents(
      ctx,
      events,
      safeLimit,
      args.minArticles,
      args.minSources,
    );
    return {
      ...result,
      scanned: events.length,
      nextCursor: page.continueCursor ?? undefined,
      done: page.isDone,
    };
  },
});

async function cleanupDuplicateQueuedSummaryJobs(
  ctx: MutationCtx,
  limit: number,
  dryRun: boolean,
) {
  const safeLimit = Math.min(Math.max(Math.floor(limit), 1), 1000);
  const queuedJobs = await ctx.db
    .query("eventSummaryJobs")
    .withIndex("by_status_next_attempt", (q) => q.eq("status", "queued"))
    .take(safeLimit);

  const seenEventIds = new Set<Id<"events">>();
  const duplicateIds: Id<"eventSummaryJobs">[] = [];

  for (const job of queuedJobs) {
    if (seenEventIds.has(job.eventId)) {
      duplicateIds.push(job._id);
      continue;
    }
    seenEventIds.add(job.eventId);
  }

  if (!dryRun) {
    for (const jobId of duplicateIds) {
      await ctx.db.delete(jobId);
    }
  }

  return {
    scanned: queuedJobs.length,
    uniqueEvents: seenEventIds.size,
    duplicateQueuedJobs: duplicateIds.length,
    deleted: dryRun ? 0 : duplicateIds.length,
    remainingMayExist: queuedJobs.length === safeLimit,
  };
}

export const cleanupDuplicateQueuedSummaryJobsInternal = internalMutation({
  args: {
    limit: v.optional(v.number()),
    dryRun: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    return cleanupDuplicateQueuedSummaryJobs(
      ctx,
      args.limit ?? 500,
      args.dryRun ?? false,
    );
  },
});

export const cleanupDuplicateQueuedSummaryJobsForAdmin = mutation({
  args: {
    limit: v.optional(v.number()),
    dryRun: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    await requireAdminUser(ctx);
    return cleanupDuplicateQueuedSummaryJobs(
      ctx,
      args.limit ?? 500,
      args.dryRun ?? true,
    );
  },
});

async function getSummaryQueueHealth(
  ctx: QueryCtx,
  limit: number,
): Promise<SummaryQueueHealth> {
  const safeLimit = Math.min(Math.max(Math.floor(limit), 1), 1000);
  const queuedJobs = await ctx.db
    .query("eventSummaryJobs")
    .withIndex("by_status_next_attempt", (q) => q.eq("status", "queued"))
    .take(safeLimit);
  const processingJobs = await ctx.db
    .query("eventSummaryJobs")
    .withIndex("by_status_updatedAt", (q) => q.eq("status", "processing"))
    .take(safeLimit);
  const failedJobs = await ctx.db
    .query("eventSummaryJobs")
    .withIndex("by_status_next_attempt", (q) => q.eq("status", "failed"))
    .take(safeLimit);

  const queuedEventCounts = new Map<Id<"events">, number>();
  for (const job of queuedJobs) {
    queuedEventCounts.set(
      job.eventId,
      (queuedEventCounts.get(job.eventId) ?? 0) + 1,
    );
  }

  const duplicateQueuedEvents = Array.from(queuedEventCounts.values()).filter(
    (count) => count > 1,
  ).length;
  const duplicateQueuedJobs = Array.from(queuedEventCounts.values()).reduce(
    (sum, count) => sum + Math.max(0, count - 1),
    0,
  );

  return {
    scannedQueuedJobs: queuedJobs.length,
    queuedJobs: queuedJobs.length,
    queuedUniqueEvents: queuedEventCounts.size,
    duplicateQueuedEvents,
    duplicateQueuedJobs,
    duplicateRatio:
      queuedEventCounts.size === 0
        ? 0
        : queuedJobs.length / queuedEventCounts.size,
    processingJobs: processingJobs.length,
    failedJobs: failedJobs.length,
    truncated: {
      queued: queuedJobs.length === safeLimit,
      processing: processingJobs.length === safeLimit,
      failed: failedJobs.length === safeLimit,
    },
  };
}

export const getSummaryQueueHealthInternal = internalQuery({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    return getSummaryQueueHealth(ctx, args.limit ?? 1000);
  },
});

export const getSummaryQueueHealthForAdmin = query({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireAdminUser(ctx);
    return getSummaryQueueHealth(ctx, args.limit ?? 1000);
  },
});

export const listDueSummaryJobs = internalQuery({
  args: {
    limit: v.number(),
  },
  handler: async (ctx, { limit }) => {
    const now = Date.now();
    const safeLimit = Math.min(Math.max(Math.floor(limit), 1), 100);
    const jobs: Doc<"eventSummaryJobs">[] = [];

    const queued = await ctx.db
      .query("eventSummaryJobs")
      .withIndex("by_status_next_attempt", (q) =>
        q.eq("status", "queued").lte("nextAttemptAt", now),
      )
      .take(safeLimit);
    jobs.push(...queued);

    if (jobs.length < safeLimit) {
      const failed = await ctx.db
        .query("eventSummaryJobs")
        .withIndex("by_status_next_attempt", (q) =>
          q.eq("status", "failed").lte("nextAttemptAt", now),
        )
        .take(safeLimit - jobs.length);
      jobs.push(...failed);
    }

    return jobs.map((job) => ({
      _id: job._id,
      eventId: job.eventId,
      attempts: job.attempts,
      status: job.status,
      leaseExpiresAt: job.leaseExpiresAt,
    }));
  },
});

export const startSummaryJob = internalMutation({
  args: {
    jobId: v.id("eventSummaryJobs"),
    runId: v.string(),
    leaseExpiresAt: v.number(),
    maxAttempts: v.number(),
  },
  handler: async (ctx, { jobId, runId, leaseExpiresAt, maxAttempts }) => {
    const now = Date.now();
    const job = await ctx.db.get(jobId);
    if (!job) {
      return { started: false as const, reason: "missing" };
    }

    if (job.status === "succeeded" || job.status === "skipped") {
      return { started: false as const, reason: "completed" };
    }

    if (
      job.status === "processing" &&
      (job.leaseExpiresAt ?? 0) > now
    ) {
      return { started: false as const, reason: "lease_active" };
    }

    if (job.attempts >= maxAttempts) {
      return { started: false as const, reason: "max_attempts" };
    }

    await ctx.db.patch(jobId, {
      status: "processing",
      attempts: job.attempts + 1,
      processingRunId: runId,
      leaseExpiresAt,
      updatedAt: now,
      lastError: undefined,
    });

    return {
      started: true as const,
      job: {
        _id: job._id,
        eventId: job.eventId,
        attempts: job.attempts + 1,
      },
    };
  },
});

export const getEventSummaryInput = internalQuery({
  args: {
    eventId: v.id("events"),
    minArticles: v.number(),
    minSources: v.number(),
    maxArticles: v.number(),
  },
  handler: async (ctx, { eventId, minArticles, minSources, maxArticles }) => {
    const event = await ctx.db.get(eventId);
    if (!event) {
      return { eligible: false as const, reason: "event_missing" };
    }

    const eligibility = await getEventEligibility(
      ctx,
      event,
      minArticles,
      minSources,
    );
    if (!eligibility.eligible) {
      return { eligible: false as const, reason: eligibility.reason };
    }

    const articles = await ctx.db
      .query("articles")
      .withIndex("by_event", (q) => q.eq("eventId", eventId))
      .collect();
    const sourceRows = await Promise.all(
      Array.from(new Set(articles.map((article) => article.sourceId))).map(
        async (sourceId) => [sourceId, await ctx.db.get(sourceId)] as const,
      ),
    );
    const sourcesById = new Map(sourceRows);
    const sortedArticles = [...articles].sort(
      (a, b) => b.publishedAt - a.publishedAt,
    );
    const selectedArticles = sortedArticles.slice(
      0,
      Math.min(Math.max(Math.floor(maxArticles), 3), 20),
    );

    return {
      eligible: true as const,
      event: {
        _id: event._id,
        title: event.title,
        slug: event.slug,
        firstPublishedAt: event.firstPublishedAt,
        lastUpdatedAt: event.lastUpdatedAt,
        lastSummarySignature: event.lastSummarySignature,
      },
      articleCount: articles.length,
      sourceCount: eligibility.sourceCount,
      articles: selectedArticles.map((article) => {
        const source = sourcesById.get(article.sourceId) ?? null;
        return {
          _id: article._id,
          title: article.title,
          summary: article.summary,
          rssSnippet: article.rssSnippet,
          atomicFacts: article.atomicFacts ?? [],
          canonicalUrl: article.canonicalUrl,
          publishedAt: article.publishedAt,
          source: source
            ? {
                _id: source._id,
                name: source.name,
                baseBias: source.baseBias,
                reliabilityScore: source.reliabilityScore,
                mbfcCategory: source.mbfcCategory,
                biasLabel: sourceBiasLabel(source),
              }
            : null,
        };
      }),
    };
  },
});

export const applyEventSummaryResult = internalMutation({
  args: {
    jobId: v.id("eventSummaryJobs"),
    eventId: v.id("events"),
    runId: v.string(),
    center: v.string(),
    left: v.string(),
    right: v.string(),
    globalImpact: v.string(),
    summarySignature: v.optional(v.string()),
  },
  handler: async (
    ctx,
    { jobId, eventId, runId, center, left, right, globalImpact, summarySignature },
  ) => {
    const job = await ctx.db.get(jobId);
    if (
      !job ||
      job.eventId !== eventId ||
      job.status !== "processing" ||
      job.processingRunId !== runId
    ) {
      return { applied: false as const };
    }

    const event = await ctx.db.get(eventId);
    if (!event) {
      await ctx.db.patch(jobId, {
        status: "skipped",
        lastError: "event_missing",
        processingRunId: undefined,
        leaseExpiresAt: undefined,
        updatedAt: Date.now(),
      });
      return { applied: false as const };
    }

    await ctx.db.patch(eventId, {
      perspectiveSummaries: {
        center: center.trim(),
        left: left.trim(),
        right: right.trim(),
      },
      globalImpact: globalImpact.trim(),
      lastSummarizedAt: Date.now(),
      lastSummarySignature: summarySignature ?? event.lastSummarySignature,
    });

    await ctx.db.patch(jobId, {
      status: "succeeded",
      processingRunId: undefined,
      leaseExpiresAt: undefined,
      lastError: undefined,
      summarySignature,
      updatedAt: Date.now(),
    });

    const updatedEvent = await ctx.db.get(eventId);
    if (updatedEvent) {
      const shareData = await buildShareRenderData(ctx, updatedEvent);
      await ctx.runMutation(internal.shareAssets.ensureEventShareAssetQueued, {
        eventId,
        renderSignature: buildEventShareRenderSignature(shareData),
      });
    }

    return { applied: true as const };
  },
});

export const markSummaryJobFailed = internalMutation({
  args: {
    jobId: v.id("eventSummaryJobs"),
    runId: v.string(),
    error: v.string(),
    retryAfterMs: v.number(),
    maxAttempts: v.number(),
  },
  handler: async (
    ctx,
    { jobId, runId, error, retryAfterMs, maxAttempts },
  ) => {
    const job = await ctx.db.get(jobId);
    if (
      !job ||
      job.status !== "processing" ||
      job.processingRunId !== runId
    ) {
      return { updated: false as const };
    }

    const attemptsExhausted = job.attempts >= maxAttempts;
    await ctx.db.patch(jobId, {
      status: "failed",
      processingRunId: undefined,
      leaseExpiresAt: undefined,
      nextAttemptAt: attemptsExhausted
        ? Number.MAX_SAFE_INTEGER
        : Date.now() + Math.max(60_000, retryAfterMs),
      lastError: error.slice(0, 1000),
      updatedAt: Date.now(),
    });

    return { updated: true as const, attemptsExhausted };
  },
});

export const deferSummaryJob = internalMutation({
  args: {
    jobId: v.id("eventSummaryJobs"),
    reason: v.string(),
    retryAfterMs: v.number(),
  },
  handler: async (ctx, { jobId, reason, retryAfterMs }) => {
    const job = await ctx.db.get(jobId);
    if (!job || job.status === "succeeded" || job.status === "skipped") {
      return { updated: false as const };
    }

    await ctx.db.patch(jobId, {
      status: job.status === "failed" ? "failed" : "queued",
      processingRunId: undefined,
      leaseExpiresAt: undefined,
      nextAttemptAt: Date.now() + Math.max(60_000, retryAfterMs),
      lastError: reason.slice(0, 1000),
      updatedAt: Date.now(),
    });

    return { updated: true as const };
  },
});

export const markSummaryJobSkipped = internalMutation({
  args: {
    jobId: v.id("eventSummaryJobs"),
    runId: v.string(),
    reason: v.string(),
    eventId: v.optional(v.id("events")),
    summarySignature: v.optional(v.string()),
  },
  handler: async (ctx, { jobId, runId, reason, eventId, summarySignature }) => {
    const job = await ctx.db.get(jobId);
    if (!job) {
      return { updated: false as const };
    }
    const matchesProcessingLease =
      job.status === "processing" && job.processingRunId === runId;
    const isUnclaimed = job.status === "queued" || job.status === "failed";
    if (!matchesProcessingLease && !isUnclaimed) {
      return { updated: false as const };
    }

    if (
      eventId &&
      job.eventId === eventId &&
      reason === "no_change_since_last_run"
    ) {
      const event = await ctx.db.get(eventId);
      if (event) {
        await ctx.db.patch(eventId, {
          lastSummarizedAt: Date.now(),
          lastSummarySignature: summarySignature ?? event.lastSummarySignature,
        });
      }
    }

    await ctx.db.patch(jobId, {
      status: "skipped",
      processingRunId: undefined,
      leaseExpiresAt: undefined,
      lastError: reason,
      summarySignature,
      updatedAt: Date.now(),
    });

    return { updated: true as const };
  },
});

export const enqueueEventSummaryForAdmin = mutation({
  args: {
    eventId: v.id("events"),
  },
  handler: async (ctx, { eventId }) => {
    await requireAdminUser(ctx);

    const now = Date.now();
    const event = await ctx.db.get(eventId);
    if (!event) {
      return { queued: false as const, warning: "event_missing" };
    }

    const cfg = await ctx.runQuery(internal.config.getBatch, {
      keys: ["event_summary_min_articles", "event_summary_min_sources"],
    });
    const minArticles = safeInteger(
      cfg.event_summary_min_articles,
      DEFAULT_MIN_ARTICLES,
      1,
      20,
    );
    const minSources = safeInteger(
      cfg.event_summary_min_sources,
      DEFAULT_MIN_SOURCES,
      1,
      20,
    );
    const eligibility = await getEventEligibility(
      ctx,
      event,
      minArticles,
      minSources,
    );

    await ctx.db.insert("eventSummaryJobs", {
      eventId,
      status: "queued",
      reason: "admin_requested",
      attempts: 0,
      requestedAt: now,
      nextAttemptAt: now,
      updatedAt: now,
      articleCount: eligibility.articleCount,
      sourceCount: eligibility.sourceCount,
    });

    return {
      queued: true as const,
      warning: eligibility.eligible ? undefined : eligibility.reason,
    };
  },
});

export const getRecentSummaryJobsForAdmin = query({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { limit }) => {
    await requireAdminUser(ctx);

    const safeLimit = Math.min(Math.max(Math.floor(limit ?? 25), 1), 100);
    const jobs = await ctx.db
      .query("eventSummaryJobs")
      .withIndex("by_status_updatedAt", (q) => q.eq("status", "queued"))
      .order("desc")
      .take(safeLimit);

    return jobs;
  },
});
