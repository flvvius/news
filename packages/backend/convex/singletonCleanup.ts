import { v } from "convex/values";
import {
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
} from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { ActionCtx, MutationCtx } from "./_generated/server";
import { getConfig } from "./config";
import { requireAdminUser } from "./lib/betaAccess";

const ARCHIVE_LOCK_KEY = "archiveStaleSingletonEvents";
const ARCHIVE_LOCK_TTL_MS = 20 * 60 * 1000;
const ARCHIVE_CONTINUATION_DELAY_MS = 500;
const BLOCKING_LOCK_KEYS = new Set([
  "clusterEnrichedArticles",
  "mergeNearDuplicateEvents",
  "reclusterRecentSingletonEvents",
]);

type SingletonCleanupSettings = {
  enabled: boolean;
  staleHours: number;
  batchSize: number;
  maxArticles: number;
  maxSources: number;
  articleAction: "archive" | "requeue";
};

type BlockingLock = { key: string; owner: string; expiresAt: number };
type PipelineGaugeValue =
  | string
  | number
  | boolean
  | null
  | BlockingLock[];
type PipelineMetadataValue =
  | string
  | number
  | boolean
  | null
  | Record<string, number>;

type ArchiveStaleSingletonResult =
  | { status: "skipped"; reason: string; locks?: BlockingLock[] }
  | ({
      status: "ok";
      hasMore: boolean;
      durationMs: number;
    } & {
      scanned: number;
      eligible: number;
      archivedArticles: number;
      requeuedArticles: number;
      deletedEvents: number;
      deletedEmbeddings: number;
      deletedCandidacies: number;
      deletedPreviews: number;
      deletedChildren: number;
    });

async function logArchiveRun(
  ctx: ActionCtx,
  args: {
    runId: string;
    startedAt: number;
    status: "ok" | "skipped" | "degraded" | "error";
    reason?: string;
    counters?: Record<string, number>;
    gauges?: Record<string, PipelineGaugeValue>;
    metadata: Record<string, PipelineMetadataValue>;
    errorMessage?: string;
  },
) {
  const finishedAt = Date.now();
  await ctx.runMutation(internal.pipeline.insertRunLog, {
    jobName: "archiveStaleSingletonEvents",
    runId: args.runId,
    startedAt: args.startedAt,
    finishedAt,
    durationMs: finishedAt - args.startedAt,
    status: args.status,
    errorMessage: args.errorMessage,
    counters: args.counters ?? {},
    gauges: {
      ...(args.gauges ?? {}),
      ...(args.reason ? { reason: args.reason } : {}),
    },
    metadata: args.metadata,
  });
  console.log(
    JSON.stringify({
      scope: "archiveStaleSingletonEvents",
      event: args.status === "ok" ? "complete" : args.status,
      runId: args.runId,
      reason: args.reason,
      ...(args.counters ?? {}),
      ...(args.gauges ?? {}),
      durationMs: finishedAt - args.startedAt,
    }),
  );
}

export function selectStaleSingleton(args: {
  event: Pick<
    Doc<"events">,
    "status" | "articleCount" | "sourceCount" | "lastArticleAt"
  >;
  now: number;
  staleHours: number;
  maxArticles: number;
  maxSources: number;
  hasBlockingLock: boolean;
}) {
  if (args.hasBlockingLock) return false;
  if (args.event.status !== "processing") return false;
  if ((args.event.articleCount ?? 1) > args.maxArticles) return false;
  if ((args.event.sourceCount ?? 1) > args.maxSources) return false;
  const lastArticleAt = args.event.lastArticleAt ?? 0;
  if (lastArticleAt <= 0) return false;
  return args.now - lastArticleAt >= args.staleHours * 60 * 60 * 1000;
}

function clampInteger(value: unknown, fallback: number, min: number, max: number) {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(Math.floor(parsed), min), max);
}

function archiveSettingsMetadata(
  settings: SingletonCleanupSettings,
): Record<string, PipelineMetadataValue> {
  return {
    enabled: settings.enabled,
    staleHours: settings.staleHours,
    batchSize: settings.batchSize,
    maxArticles: settings.maxArticles,
    maxSources: settings.maxSources,
    articleAction: settings.articleAction,
  };
}

export const getArchiveSettings = internalQuery({
  args: {},
  handler: async (ctx): Promise<SingletonCleanupSettings> => {
    const articleAction = await getConfig(
      ctx,
      "singleton_cleanup_article_action",
      "archive",
    );
    return {
      enabled: await getConfig(ctx, "singleton_cleanup_enabled", true),
      staleHours: clampInteger(
        await getConfig(ctx, "singleton_cleanup_stale_hours", 48),
        48,
        12,
        168,
      ),
      batchSize: clampInteger(
        await getConfig(ctx, "singleton_cleanup_batch_size", 100),
        100,
        10,
        500,
      ),
      maxArticles: clampInteger(
        await getConfig(ctx, "singleton_cleanup_max_articles", 2),
        2,
        1,
        10,
      ),
      maxSources: clampInteger(
        await getConfig(ctx, "singleton_cleanup_max_sources", 1),
        1,
        1,
        5,
      ),
      articleAction: articleAction === "requeue" ? "requeue" : "archive",
    };
  },
});

export const hasBlockingCleanupLocks = internalQuery({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const locks = await ctx.db.query("pipelineLocks").collect();
    const blocking = locks.filter(
      (lock) => BLOCKING_LOCK_KEYS.has(lock.key) && lock.expiresAt > now,
    );
    return {
      blocked: blocking.length > 0,
      locks: blocking.map((lock) => ({
        key: lock.key,
        owner: lock.owner,
        expiresAt: lock.expiresAt,
      })),
    };
  },
});

export const getStaleSingletonCandidates = internalQuery({
  args: {
    staleBefore: v.number(),
    scanLimit: v.number(),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("events")
      .withIndex("by_status_last_article_at", (q) =>
        q.eq("status", "processing").lt("lastArticleAt", args.staleBefore),
      )
      .order("asc")
      .take(args.scanLimit);
  },
});

async function deleteByEventIndex(
  ctx: MutationCtx,
  tableName:
    | "eventTopics"
    | "eventEmbeddings"
    | "eventCandidacy"
    | "publicEventPreviews"
    | "eventShareAssets"
    | "eventSummaryJobs"
    | "eventClaims"
    | "userInsights"
    | "interactions",
  eventId: Id<"events">,
) {
  const rows = await ctx.db
    .query(tableName)
    .withIndex("by_event", (q) => q.eq("eventId", eventId))
    .collect();
  for (const row of rows) {
    await ctx.db.delete(row._id);
  }
  return rows.length;
}

export const archiveSingletonEvent = internalMutation({
  args: {
    eventId: v.id("events"),
    settings: v.object({
      staleHours: v.number(),
      maxArticles: v.number(),
      maxSources: v.number(),
      articleAction: v.union(v.literal("archive"), v.literal("requeue")),
    }),
    now: v.number(),
  },
  handler: async (ctx, args) => {
    const event = await ctx.db.get(args.eventId);
    if (
      !event ||
      !selectStaleSingleton({
        event,
        now: args.now,
        staleHours: args.settings.staleHours,
        maxArticles: args.settings.maxArticles,
        maxSources: args.settings.maxSources,
        hasBlockingLock: false,
      })
    ) {
      return {
        archived: false as const,
        archivedArticles: 0,
        requeuedArticles: 0,
        deletedEvents: 0,
        deletedEmbeddings: 0,
        deletedCandidacies: 0,
        deletedPreviews: 0,
        deletedChildren: 0,
      };
    }

    const articles = await ctx.db
      .query("articles")
      .withIndex("by_event", (q) => q.eq("eventId", args.eventId))
      .collect();

    let archivedArticles = 0;
    let requeuedArticles = 0;
    for (const article of articles) {
      if (args.settings.articleAction === "requeue") {
        await ctx.db.patch(article._id, {
          status: "enriched",
          eventId: undefined,
          archivedAt: undefined,
          archivedReason: undefined,
        });
        requeuedArticles++;
      } else {
        await ctx.db.patch(article._id, {
          status: "archived",
          archivedAt: args.now,
          archivedReason: "stale_singleton",
        });
        archivedArticles++;
      }
    }

    const deletedEmbeddings = await deleteByEventIndex(
      ctx,
      "eventEmbeddings",
      args.eventId,
    );
    const deletedCandidacies = await deleteByEventIndex(
      ctx,
      "eventCandidacy",
      args.eventId,
    );
    const deletedPreviews = await deleteByEventIndex(
      ctx,
      "publicEventPreviews",
      args.eventId,
    );
    const deletedChildren =
      (await deleteByEventIndex(ctx, "eventTopics", args.eventId)) +
      (await deleteByEventIndex(ctx, "eventShareAssets", args.eventId)) +
      (await deleteByEventIndex(ctx, "eventSummaryJobs", args.eventId)) +
      (await deleteByEventIndex(ctx, "eventClaims", args.eventId)) +
      (await deleteByEventIndex(ctx, "userInsights", args.eventId)) +
      (await deleteByEventIndex(ctx, "interactions", args.eventId));

    await ctx.db.delete(args.eventId);

    return {
      archived: true as const,
      archivedArticles,
      requeuedArticles,
      deletedEvents: 1,
      deletedEmbeddings,
      deletedCandidacies,
      deletedPreviews,
      deletedChildren,
    };
  },
});

export const archiveStaleSingletonEvents = internalAction({
  args: {
    autoContinue: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<ArchiveStaleSingletonResult> => {
    const startedAt = Date.now();
    const runId = `archiveStaleSingletonEvents-${startedAt}`;
    const settings: SingletonCleanupSettings = await ctx.runQuery(
      internal.singletonCleanup.getArchiveSettings,
      {},
    );
    if (!settings.enabled) {
      await logArchiveRun(ctx, {
        runId,
        startedAt,
        status: "skipped",
        reason: "disabled",
        metadata: archiveSettingsMetadata(settings),
      });
      return { status: "skipped" as const, reason: "disabled" };
    }
    const paused = await ctx.runQuery(internal.config.isPipelinePaused, {});
    if (paused) {
      await logArchiveRun(ctx, {
        runId,
        startedAt,
        status: "skipped",
        reason: "pipeline_paused",
        metadata: archiveSettingsMetadata(settings),
      });
      return { status: "skipped" as const, reason: "pipeline_paused" };
    }

    const owner = runId;
    const lock = await ctx.runMutation(internal.ingestion.acquirePipelineLock, {
      key: ARCHIVE_LOCK_KEY,
      owner,
      expiresAt: startedAt + ARCHIVE_LOCK_TTL_MS,
    });
    if (!lock.acquired) {
      await logArchiveRun(ctx, {
        runId,
        startedAt,
        status: "skipped",
        reason: "lock_held",
        metadata: archiveSettingsMetadata(settings),
      });
      return { status: "skipped" as const, reason: "lock_held" };
    }

    const counters = {
      scanned: 0,
      eligible: 0,
      archivedArticles: 0,
      requeuedArticles: 0,
      deletedEvents: 0,
      deletedEmbeddings: 0,
      deletedCandidacies: 0,
      deletedPreviews: 0,
      deletedChildren: 0,
    };

    try {
      const blocking: {
        blocked: boolean;
        locks: Array<{ key: string; owner: string; expiresAt: number }>;
      } = await ctx.runQuery(
        internal.singletonCleanup.hasBlockingCleanupLocks,
        {},
      );
      if (blocking.blocked) {
        await logArchiveRun(ctx, {
          runId,
          startedAt,
          status: "skipped",
          reason: "blocking_pipeline_lock",
          gauges: { locks: blocking.locks },
          metadata: archiveSettingsMetadata(settings),
        });
        return {
          status: "skipped" as const,
          reason: "blocking_pipeline_lock",
          locks: blocking.locks,
        };
      }

      const now = Date.now();
      const staleBefore = now - settings.staleHours * 60 * 60 * 1000;
      const candidates = await ctx.runQuery(
        internal.singletonCleanup.getStaleSingletonCandidates,
        {
          staleBefore,
          scanLimit: settings.batchSize * 2,
        },
      );
      counters.scanned = candidates.length;

      for (const event of candidates) {
        if (counters.eligible >= settings.batchSize) break;
        if (
          !selectStaleSingleton({
            event,
            now,
            staleHours: settings.staleHours,
            maxArticles: settings.maxArticles,
            maxSources: settings.maxSources,
            hasBlockingLock: false,
          })
        ) {
          continue;
        }
        counters.eligible++;
        const result = await ctx.runMutation(
          internal.singletonCleanup.archiveSingletonEvent,
          {
            eventId: event._id,
            settings: {
              staleHours: settings.staleHours,
              maxArticles: settings.maxArticles,
              maxSources: settings.maxSources,
              articleAction: settings.articleAction,
            },
            now,
          },
        );
        counters.archivedArticles += result.archivedArticles;
        counters.requeuedArticles += result.requeuedArticles;
        counters.deletedEvents += result.deletedEvents;
        counters.deletedEmbeddings += result.deletedEmbeddings;
        counters.deletedCandidacies += result.deletedCandidacies;
        counters.deletedPreviews += result.deletedPreviews;
        counters.deletedChildren += result.deletedChildren;
      }

      const hasMore: boolean = counters.eligible === settings.batchSize;
      if (hasMore && (args.autoContinue ?? true)) {
        await ctx.scheduler.runAfter(
          ARCHIVE_CONTINUATION_DELAY_MS,
          internal.singletonCleanup.archiveStaleSingletonEvents,
          { autoContinue: true },
        );
      }

      const durationMs = Date.now() - startedAt;
      await logArchiveRun(ctx, {
        runId,
        startedAt,
        status: "ok",
        counters,
        gauges: {
          hasMore,
          articleAction: settings.articleAction,
        },
        metadata: archiveSettingsMetadata(settings),
      });
      return {
        status: "ok" as const,
        ...counters,
        hasMore,
        durationMs,
      };
    } finally {
      await ctx.runMutation(internal.ingestion.releasePipelineLock, {
        key: ARCHIVE_LOCK_KEY,
        owner,
      });
    }
  },
});

export const triggerArchiveStaleSingletonEvents = mutation({
  args: {},
  handler: async (ctx) => {
    await requireAdminUser(ctx);
    await ctx.scheduler.runAfter(
      0,
      internal.singletonCleanup.archiveStaleSingletonEvents,
      { autoContinue: true },
    );
    return { scheduled: true };
  },
});
