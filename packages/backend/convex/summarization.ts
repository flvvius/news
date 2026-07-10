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
import { sourceBiasLabel } from "./lib/sourceBias";
import { normalizedPerspectives } from "./lib/biasAxis";
import { selectSummaryArticles } from "./lib/summaryArticleSelection";
import { SUMMARY_PROMPT_VERSION } from "./prompts";
import {
  buildEventShareRenderSignature,
  type EventShareRenderData,
} from "./shareAssets";
import { syncPublicEventPreview } from "./lib/publicEventPreviews";

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
  // No status gate: `processing` events awaiting their first summary are
  // eligible too (a successful summary is what promotes them to `published`).
  // Count/source thresholds are enforced separately in getEventEligibility.

  // normalizedPerspectives falls back to legacy center/left/right keys so
  // pre-BIV-303 events are not needlessly resummarized before the backfill.
  const perspectives = normalizedPerspectives(event.perspectiveSummaries);
  // CASE D events (perspectiveApplicable=false) intentionally have empty
  // side fields — neutral + globalImpact alone make them complete, otherwise
  // they would re-enqueue on every cron forever.
  const sidesComplete =
    event.perspectiveApplicable === false ||
    Boolean(
      perspectives?.reformist?.trim() && perspectives?.suveranist?.trim(),
    );
  const hasFullAiSummary = Boolean(
    perspectives?.neutral?.trim() &&
    sidesComplete &&
    event.globalImpact?.trim() &&
    event.lastSummarizedAt,
  );
  if (!hasFullAiSummary) return true;

  // Prompt-semantics staleness: signature short-circuiting alone never
  // re-enqueues, so a SUMMARY_PROMPT_VERSION bump would be a no-op without
  // this check. Events summarized under an older prompt version re-run once
  // and get stamped with the current version.
  if ((event.lastSummaryPromptVersion ?? 0) !== SUMMARY_PROMPT_VERSION) {
    return true;
  }

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

  const storedArticleCount = event.articleCount;
  const storedSourceCount = event.sourceCount;
  if (
    storedArticleCount !== undefined &&
    storedSourceCount !== undefined &&
    (storedArticleCount < minArticles || storedSourceCount < minSources)
  ) {
    return {
      eligible: false,
      articleCount: storedArticleCount,
      sourceCount: storedSourceCount,
      reason:
        storedArticleCount < minArticles
          ? "not_enough_articles"
          : "not_enough_sources",
    };
  }
  if (
    storedArticleCount !== undefined &&
    storedSourceCount !== undefined &&
    storedArticleCount >= minArticles &&
    storedSourceCount >= minSources
  ) {
    return {
      eligible: true,
      articleCount: storedArticleCount,
      sourceCount: storedSourceCount,
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
  let articleCount = event.articleCount;
  let sourceCount = event.sourceCount;
  let sourceIds = event.sourceIds;

  if (!sourceIds || articleCount === undefined || sourceCount === undefined) {
    console.log(
      `[summarization] Falling back to article scan for share render data on event ${String(event._id)}`,
    );
    const articles = await ctx.db
      .query("articles")
      .withIndex("by_event", (q) => q.eq("eventId", event._id))
      .collect();
    const uniqueSourceIds = Array.from(
      new Set(articles.map((article) => article.sourceId)),
    );
    sourceIds = sourceIds ?? uniqueSourceIds;
    articleCount = articleCount ?? articles.length;
    sourceCount = sourceCount ?? uniqueSourceIds.length;
  }

  const sources = (
    await Promise.all(
      (sourceIds ?? []).slice(0, 3).map((sourceId) => ctx.db.get(sourceId)),
    )
  ).filter((source) => source !== null);

  return {
    title: event.title,
    summary:
      normalizedPerspectives(event.perspectiveSummaries)?.neutral ??
      event.globalImpact,
    imageUrl: event.imageUrl,
    imageAlt: event.imageAlt,
    lastUpdatedAt: event.lastUpdatedAt ?? event.firstPublishedAt,
    articleCount: articleCount ?? 0,
    sourceCount: sourceCount ?? (sourceIds ? sourceIds.length : 0),
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

    // L4: an event whose summary is parked in the review queue must not be
    // re-enqueued — regeneration would flag again and spam the queue.
    const pendingReview = await ctx.db
      .query("summaryReviewQueue")
      .withIndex("by_event", (q) => q.eq("eventId", event._id))
      .filter((q) => q.eq(q.field("status"), "pending"))
      .first();
    if (pendingReview) {
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
        (event.lastUpdatedAt ?? event.firstPublishedAt) &&
      // A prompt-version bump is a deliberate one-time migration — the
      // anti-thrash window must not delay it.
      (event.lastSummaryPromptVersion ?? 0) === SUMMARY_PROMPT_VERSION
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
    const scanWindow = safeLimit * 4;
    // Primary candidates are qualifying `processing` events awaiting their first
    // summary (which is what publishes them) — ordered by most recent article so
    // freshly-qualified events surface first. `published` events are still
    // scanned to re-summarize after new articles land and to backfill any
    // legacy summary-less rows. getEventEligibility filters both by min
    // article/source counts.
    const [processingEvents, publishedEvents] = await Promise.all([
      ctx.db
        .query("events")
        .withIndex("by_status_last_article_at", (q) =>
          q.eq("status", "processing"),
        )
        .order("desc")
        .take(scanWindow),
      ctx.db
        .query("events")
        .withIndex("by_status_recency", (q) => q.eq("status", "published"))
        .order("desc")
        .take(scanWindow),
    ]);

    return enqueueEligibleEvents(
      ctx,
      [...processingEvents, ...publishedEvents],
      safeLimit,
      minArticles,
      minSources,
    );
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

    if (job.status === "processing" && (job.leaseExpiresAt ?? 0) > now) {
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
    const selectedArticles = selectSummaryArticles(
      articles.map((article) => {
        const source = sourcesById.get(article.sourceId) ?? null;
        return {
          _id: article._id,
          publishedAt: article.publishedAt,
          extractionQuality: article.extractionQuality,
          source: source
            ? { _id: source._id, biasLabel: sourceBiasLabel(source) }
            : null,
          article,
        };
      }),
      maxArticles,
    ).map(({ article }) => article);

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

// L4 — per-sentence grounding results attached to a summary write.
const groundingResultValidator = v.object({
  model: v.string(),
  passed: v.boolean(),
  results: v.array(
    v.object({
      field: v.string(),
      sentence: v.string(),
      supported: v.boolean(),
      supportingArticleIds: v.array(v.id("articles")),
    }),
  ),
  strippedSentences: v.array(
    v.object({
      field: v.string(),
      sentence: v.string(),
    }),
  ),
});

async function upsertSummaryGrounding(
  ctx: MutationCtx,
  eventId: Id<"events">,
  jobId: Id<"eventSummaryJobs"> | undefined,
  grounding: {
    model: string;
    passed: boolean;
    results: Array<{
      field: string;
      sentence: string;
      supported: boolean;
      supportingArticleIds: Id<"articles">[];
    }>;
    strippedSentences: Array<{ field: string; sentence: string }>;
  },
) {
  const existing = await ctx.db
    .query("summaryGrounding")
    .withIndex("by_event", (q) => q.eq("eventId", eventId))
    .unique();
  const row = {
    eventId,
    jobId,
    model: grounding.model,
    results: grounding.results,
    strippedSentences: grounding.strippedSentences,
    passed: grounding.passed,
    generatedAt: Date.now(),
  };
  if (existing) {
    await ctx.db.replace(existing._id, row);
  } else {
    await ctx.db.insert("summaryGrounding", row);
  }
}

/** L4 — record a grounding check that did NOT lead to publication. */
export const recordSummaryGrounding = internalMutation({
  args: {
    eventId: v.id("events"),
    jobId: v.optional(v.id("eventSummaryJobs")),
    grounding: groundingResultValidator,
  },
  handler: async (ctx, { eventId, jobId, grounding }) => {
    await upsertSummaryGrounding(ctx, eventId, jobId, grounding);
    return { recorded: true as const };
  },
});

/** L4 — per-sentence attribution for the event page (public). */
export const getSummaryGrounding = query({
  args: { eventId: v.id("events") },
  handler: async (ctx, { eventId }) => {
    const row = await ctx.db
      .query("summaryGrounding")
      .withIndex("by_event", (q) => q.eq("eventId", eventId))
      .unique();
    if (!row || !row.passed) return null;

    const articleIds = Array.from(
      new Set(row.results.flatMap((entry) => entry.supportingArticleIds)),
    );
    const articleRows = await Promise.all(
      articleIds.map(async (articleId) => {
        const article = await ctx.db.get(articleId);
        if (!article) return null;
        const source = await ctx.db.get(article.sourceId);
        return [String(articleId), source?.name ?? null] as const;
      }),
    );
    const sourceNameByArticle = new Map(
      articleRows.filter(
        (entry): entry is readonly [string, string | null] => entry !== null,
      ),
    );

    return {
      generatedAt: row.generatedAt,
      results: row.results.map((entry) => ({
        field: entry.field,
        sentence: entry.sentence,
        supportingSources: Array.from(
          new Set(
            entry.supportingArticleIds
              .map((articleId) => sourceNameByArticle.get(String(articleId)))
              .filter((name): name is string => Boolean(name)),
          ),
        ),
      })),
    };
  },
});

export const applyEventSummaryResult = internalMutation({
  args: {
    jobId: v.id("eventSummaryJobs"),
    eventId: v.id("events"),
    runId: v.string(),
    neutral: v.string(),
    reformist: v.string(),
    suveranist: v.string(),
    globalImpact: v.string(),
    perspectiveApplicable: v.optional(v.boolean()),
    summarySignature: v.optional(v.string()),
    // L1 disclosure: the model that actually produced this summary (primary
    // or quota fallback). Optional for legacy callers; the stored row always
    // gets aiGenerated/humanReviewed/promptVersion regardless.
    modelUsed: v.optional(v.string()),
    // L3 — result of the verbatim-overlap gate. A summary can only be
    // applied/published with a recorded PASSING check.
    overlapCheck: v.optional(
      v.object({
        passed: v.boolean(),
        maxNgram: v.number(),
        attempts: v.number(),
        matchedSpans: v.array(
          v.object({
            field: v.string(),
            text: v.string(),
            length: v.number(),
          }),
        ),
      }),
    ),
    // L4 — grounding verification results for the applied summary text.
    grounding: v.optional(groundingResultValidator),
  },
  handler: async (
    ctx,
    {
      jobId,
      eventId,
      runId,
      neutral,
      reformist,
      suveranist,
      globalImpact,
      perspectiveApplicable,
      summarySignature,
      modelUsed,
      overlapCheck,
      grounding,
    },
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

    // L3 invariant: no summary reaches the published state without a
    // recorded PASSING overlap check. A failing check must go through
    // markSummaryJobBlockedVerbatim instead.
    if (overlapCheck && !overlapCheck.passed) {
      return { applied: false as const, reason: "overlap_check_failed" };
    }

    // L4 invariant: a failing grounding check must never publish — the node
    // action strips unsupported sentences or blocks before calling this.
    if (grounding && !grounding.passed) {
      return { applied: false as const, reason: "grounding_check_failed" };
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

    const applicable = perspectiveApplicable ?? true;
    await ctx.db.patch(eventId, {
      // CASE D stores only the neutral summary; the empty side fields stay
      // unset so the UI's note replaces the perspective split.
      perspectiveSummaries: applicable
        ? {
            neutral: neutral.trim(),
            reformist: reformist.trim(),
            suveranist: suveranist.trim(),
          }
        : { neutral: neutral.trim() },
      perspectiveApplicable: applicable,
      perspectiveSource: "ai",
      globalImpact: globalImpact.trim(),
      lastSummarizedAt: Date.now(),
      lastSummarySignature: summarySignature ?? event.lastSummarySignature,
      lastSummaryPromptVersion: SUMMARY_PROMPT_VERSION,
      // L1 (AI Act art. 50(4)): every stored summary is marked AI-generated
      // at write time — publication is impossible with these unset because
      // this mutation is the sole path that writes summaries/publishes.
      aiGenerated: true,
      humanReviewed: false,
      modelUsed: modelUsed ?? event.modelUsed ?? "unrecorded",
      promptVersion: String(SUMMARY_PROMPT_VERSION),
      // L3: record the overlap-check outcome on the event itself.
      lastOverlapCheckAt: Date.now(),
      lastOverlapCheckPassed: overlapCheck?.passed ?? undefined,
      // A successful summary is the sole gate to going public: promote a
      // qualifying `processing` event to `published` now that it has full AI
      // perspectives + globalImpact. syncPublicEventPreview below then creates
      // its public preview. Already-published events keep their status.
      ...(event.status === "processing" ? { status: "published" as const } : {}),
    });

    await ctx.db.patch(jobId, {
      status: "succeeded",
      processingRunId: undefined,
      leaseExpiresAt: undefined,
      lastError: undefined,
      summarySignature,
      overlapCheckJson: overlapCheck ? JSON.stringify(overlapCheck) : undefined,
      updatedAt: Date.now(),
    });

    // L4: persist the per-sentence support map for the published text.
    if (grounding) {
      await upsertSummaryGrounding(ctx, eventId, jobId, grounding);
    }

    const updatedEvent = await ctx.db.get(eventId);
    if (updatedEvent) {
      await syncPublicEventPreview(ctx, eventId);
      const shareData = await buildShareRenderData(ctx, updatedEvent);
      await ctx.runMutation(internal.shareAssets.ensureEventShareAssetQueued, {
        eventId,
        renderSignature: buildEventShareRenderSignature(shareData),
      });
    }

    return { applied: true as const };
  },
});

/**
 * L4 — NER risk gate hold: the generated summary pairs a named person or
 * organization with an accusation term, so it is parked in the review queue
 * and NEVER auto-published. The job ends as skipped/held_for_review; the
 * event keeps its previous state until an admin decides.
 */
export const holdSummaryForReview = internalMutation({
  args: {
    jobId: v.id("eventSummaryJobs"),
    eventId: v.id("events"),
    runId: v.string(),
    proposed: v.object({
      neutral: v.string(),
      reformist: v.string(),
      suveranist: v.string(),
      globalImpact: v.string(),
      perspectiveApplicable: v.boolean(),
      modelUsed: v.string(),
      summarySignature: v.optional(v.string()),
    }),
    flaggedSentences: v.array(
      v.object({
        field: v.string(),
        sentence: v.string(),
        entity: v.string(),
        term: v.string(),
      }),
    ),
    overlapCheckJson: v.optional(v.string()),
    groundingJson: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (
      !job ||
      job.eventId !== args.eventId ||
      job.status !== "processing" ||
      job.processingRunId !== args.runId
    ) {
      return { held: false as const };
    }

    // One pending proposal per event: a fresh generation supersedes the old.
    const existingPending = await ctx.db
      .query("summaryReviewQueue")
      .withIndex("by_event", (q) => q.eq("eventId", args.eventId))
      .filter((q) => q.eq(q.field("status"), "pending"))
      .first();
    const row = {
      eventId: args.eventId,
      jobId: args.jobId,
      runId: args.runId,
      proposed: args.proposed,
      flaggedSentences: args.flaggedSentences,
      overlapCheckJson: args.overlapCheckJson,
      groundingJson: args.groundingJson,
      status: "pending" as const,
      createdAt: Date.now(),
    };
    if (existingPending) {
      await ctx.db.replace(existingPending._id, row);
    } else {
      await ctx.db.insert("summaryReviewQueue", row);
    }

    await ctx.db.patch(args.jobId, {
      status: "skipped",
      processingRunId: undefined,
      leaseExpiresAt: undefined,
      lastError: "held_for_review",
      overlapCheckJson: args.overlapCheckJson,
      updatedAt: Date.now(),
    });

    return { held: true as const };
  },
});

export const listSummaryReviewQueueForAdmin = query({
  args: {
    status: v.optional(
      v.union(
        v.literal("pending"),
        v.literal("approved"),
        v.literal("rejected"),
      ),
    ),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireAdminUser(ctx);
    const safeLimit = Math.min(Math.max(Math.floor(args.limit ?? 50), 1), 200);
    const rows = await ctx.db
      .query("summaryReviewQueue")
      .withIndex("by_status_createdAt", (q) =>
        q.eq("status", args.status ?? "pending"),
      )
      .order("desc")
      .take(safeLimit);

    return await Promise.all(
      rows.map(async (row) => {
        const event = await ctx.db.get(row.eventId);
        return {
          ...row,
          eventTitle: event?.title ?? "(eveniment șters)",
          eventSlug: event?.slug,
          eventStatus: event?.status,
        };
      }),
    );
  },
});

/**
 * L4 — admin decision on a held summary. Approve applies the (optionally
 * edited) text to the event with humanReviewed=true and publishes it;
 * reject discards the proposal and leaves the event untouched.
 */
export const decideSummaryReviewForAdmin = mutation({
  args: {
    reviewId: v.id("summaryReviewQueue"),
    decision: v.union(v.literal("approve"), v.literal("reject")),
    editedFields: v.optional(
      v.object({
        neutral: v.optional(v.string()),
        reformist: v.optional(v.string()),
        suveranist: v.optional(v.string()),
        globalImpact: v.optional(v.string()),
      }),
    ),
    note: v.optional(v.string()),
  },
  handler: async (ctx, { reviewId, decision, editedFields, note }) => {
    const admin = await requireAdminUser(ctx);
    const review = await ctx.db.get(reviewId);
    if (!review || review.status !== "pending") {
      return { decided: false as const, reason: "not_pending" };
    }

    const decidedByEmail =
      (admin as { email?: string } | null | undefined)?.email ?? undefined;

    if (decision === "reject") {
      await ctx.db.patch(reviewId, {
        status: "rejected",
        decidedAt: Date.now(),
        decidedByEmail,
        decisionNote: note,
      });
      return { decided: true as const, applied: false as const };
    }

    const event = await ctx.db.get(review.eventId);
    if (!event) {
      await ctx.db.patch(reviewId, {
        status: "rejected",
        decidedAt: Date.now(),
        decidedByEmail,
        decisionNote: "event_missing",
      });
      return { decided: true as const, applied: false as const };
    }

    const neutral = (editedFields?.neutral ?? review.proposed.neutral).trim();
    const reformist = (
      editedFields?.reformist ?? review.proposed.reformist
    ).trim();
    const suveranist = (
      editedFields?.suveranist ?? review.proposed.suveranist
    ).trim();
    const globalImpact = (
      editedFields?.globalImpact ?? review.proposed.globalImpact
    ).trim();
    const applicable = review.proposed.perspectiveApplicable;

    await ctx.db.patch(review.eventId, {
      perspectiveSummaries: applicable
        ? { neutral, reformist, suveranist }
        : { neutral },
      perspectiveApplicable: applicable,
      perspectiveSource: "ai",
      globalImpact,
      lastSummarizedAt: Date.now(),
      lastSummarySignature:
        review.proposed.summarySignature ?? event.lastSummarySignature,
      lastSummaryPromptVersion: SUMMARY_PROMPT_VERSION,
      aiGenerated: true,
      // The whole point of the queue: this text WAS human-reviewed.
      humanReviewed: true,
      modelUsed: review.proposed.modelUsed,
      promptVersion: String(SUMMARY_PROMPT_VERSION),
      lastOverlapCheckAt: Date.now(),
      lastOverlapCheckPassed: true,
      ...(event.status === "processing"
        ? { status: "published" as const }
        : {}),
    });

    await ctx.db.patch(reviewId, {
      status: "approved",
      decidedAt: Date.now(),
      decidedByEmail,
      decisionNote: note,
    });

    await syncPublicEventPreview(ctx, review.eventId);
    const updatedEvent = await ctx.db.get(review.eventId);
    if (updatedEvent) {
      const shareData = await buildShareRenderData(ctx, updatedEvent);
      await ctx.runMutation(internal.shareAssets.ensureEventShareAssetQueued, {
        eventId: review.eventId,
        renderSignature: buildEventShareRenderSignature(shareData),
      });
    }

    return { decided: true as const, applied: true as const };
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
  handler: async (ctx, { jobId, runId, error, retryAfterMs, maxAttempts }) => {
    const job = await ctx.db.get(jobId);
    if (!job || job.status !== "processing" || job.processingRunId !== runId) {
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

/**
 * L3 — terminal state for a summary that kept reproducing source phrasing
 * after the paraphrase retries. The generated text is discarded (never
 * stored), the job is marked blocked_verbatim with the failing spans, and
 * the event is excluded from publication (a processing event stays
 * unpublished; a published event keeps its previous, passing summary).
 */
export const markSummaryJobBlockedVerbatim = internalMutation({
  args: {
    jobId: v.id("eventSummaryJobs"),
    runId: v.string(),
    overlapCheckJson: v.string(),
  },
  handler: async (ctx, { jobId, runId, overlapCheckJson }) => {
    const job = await ctx.db.get(jobId);
    if (!job || job.status !== "processing" || job.processingRunId !== runId) {
      return { updated: false as const };
    }

    await ctx.db.patch(jobId, {
      status: "failed",
      processingRunId: undefined,
      leaseExpiresAt: undefined,
      // Terminal: no automatic retry — a regenerated summary from identical
      // inputs would keep failing; new articles re-enqueue a fresh job.
      nextAttemptAt: Number.MAX_SAFE_INTEGER,
      lastError: "blocked_verbatim",
      overlapCheckJson,
      updatedAt: Date.now(),
    });

    return { updated: true as const };
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
          lastSummaryPromptVersion: SUMMARY_PROMPT_VERSION,
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
