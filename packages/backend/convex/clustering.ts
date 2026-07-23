/**
 * Basic article clustering pipeline — Phase 3.5
 *
 * Goal:
 *  - Take `enriched` articles with embeddings
 *  - Match them against recent events using embedding similarity + title overlap
 *  - Create or update published events
 *  - Attach `eventId` to articles and move them to `clustered`
 *
 * This is still a heuristic Phase 3.5 implementation:
 *  - No AI summarization yet
 *  - No claim extraction yet
 *  - Topic inference is metadata-driven, not model-based
 *  - Center summary falls back to RSS snippet when present
 */

import { paginationOptsValidator, type PaginationResult } from "convex/server";
import { v } from "convex/values";
import {
  internalAction,
  internalMutation,
  internalQuery,
  action,
  mutation,
  query,
} from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { ActionCtx, MutationCtx } from "./_generated/server";
import { getConfig } from "./config";
import { normalizeArticleSnippet, normalizeArticleTitle } from "./ingestion";
import { foldDiacriticsToAscii, romanianCount } from "./lib/romanian";
import { truncateThirdPartySnippet } from "./lib/compliance";
import { normalizedPerspectives } from "./lib/biasAxis";
import { requireAdminUser } from "./lib/betaAccess";
import { refreshEventClaimCoverage } from "./lib/eventClaimCoverage";
import {
  deletePublicEventPreview,
  syncPublicEventPreview,
} from "./lib/publicEventPreviews";
import { buildEventShareRenderSignature } from "./shareAssets";
import { TOPIC_CATALOG_SLUGS } from "./topicCatalog";
import { estimateVectorSearchQgbRead } from "./vectorSearchBudget";

const CLUSTER_LOCK_KEY = "clusterEnrichedArticles";
const CLUSTER_LOCK_TTL_MS = 20 * 60 * 1000;
const MERGE_NEAR_DUPLICATES_DELAY_MS = 5 * 60_000;
const RECLUSTER_RECENT_SINGLETONS_DELAY_MS = 10 * 60_000;
const MERGE_LOCK_KEY = "mergeNearDuplicateEvents";
const RECLUSTER_SINGLETONS_LOCK_KEY = "reclusterRecentSingletonEvents";
const MERGE_LOCK_TTL_MS = 20 * 60 * 1000;
const CLUSTER_BATCH_SIZE = 32;
const RECENT_EVENT_WINDOW_MS = 48 * 60 * 60 * 1000;
const MAX_CANDIDATE_EVENTS = 220;
// Each vector-search neighbor is hydrated (candidacy + ~10KB embedding doc),
// so top-K drives both database I/O and vector bandwidth. Trimmed 20 -> 12 to
// cut per-run hydration bytes. Overridable via clustering_vector_search_limit.
const VECTOR_SEARCH_LIMIT = 12;
const EVENT_PRESENTATION_ARTICLE_LIMIT = 10;
const CANDIDACY_TOKEN_CAP = 200;
const EVENT_EMBEDDING_DIMENSIONS = 512;
const DEFAULT_MIN_CLUSTER_SIMILARITY = 0.74;
const DEFAULT_STRONG_CLUSTER_SIMILARITY = 0.84;
const DEFAULT_MIN_TITLE_TOKEN_OVERLAP = 2;
const DEFAULT_MIN_TITLE_JACCARD = 0.1;
const DEFAULT_SAME_SOURCE_MIN_SIMILARITY = 0.84;
const DEFAULT_WEAK_EXTRACTION_MIN_SIMILARITY = 0.82;
const DEFAULT_WEAK_EXTRACTION_STRONG_SIMILARITY = 0.88;
const DEFAULT_RECLUSTER_MIN_SIMILARITY = 0.74;
const DEFAULT_RECLUSTER_WINDOW_HOURS = 48;
const DEFAULT_TOPIC_INFERENCE_MIN_SCORE = 4.5;
const DEFAULT_TOPIC_INFERENCE_CONFIDENCE_RATIO = 0.55;
const DEFAULT_TOPIC_INFERENCE_MAX_TOPICS = 3;
const DEFAULT_CLUSTER_PUBLISH_MIN_ARTICLES = 2;
const DEFAULT_CLUSTER_PUBLISH_MIN_SOURCES = 2;
const DEFAULT_MERGE_MIN_SIMILARITY = 0.94;
const DEFAULT_MERGE_MIN_TITLE_JACCARD = 0.45;
const DEFAULT_MERGE_MAX_TIME_DELTA_HOURS = 48;
const MERGE_VECTOR_SEARCH_LIMIT = 8;
const MERGE_CHANGED_SEED_LIMIT = 8;
const RECLUSTER_VECTOR_SEARCH_LIMIT = 8;
const RECLUSTER_CHANGED_SEED_LIMIT = 8;
const MERGE_RECENT_BUCKET = "recent_2d";
const MERGE_STALE_BUCKET = "stale";
const SINGLETON_BUCKET = "singleton";
const MULTI_ARTICLE_BUCKET = "multi";

type ClusteringJobName =
  | "clusterEnrichedArticles"
  | "mergeNearDuplicateEvents"
  | "reclusterRecentSingletonEvents";

type JobMetrics = {
  jobName: ClusteringJobName;
  runId: string;
  budgetAllowed: boolean;
  usedFallbackMode: boolean;
  vectorSearches: number;
  vectorMatchesReturned: number;
  vectorMatchesHydrated: number;
  vectorMatchesDiscardedPostFetch: number;
  vectorSearchesPerArticle: number;
  vectorSearchesPerCandidateEvent: number;
  batchArticles: number;
  candidateCacheSize: number;
  mergeSeedEvents: number;
  reclusterSeedEvents: number;
  perSearchBytes: number;
  qgbRead: number;
  elapsedMs: number;
  stageMs: Record<string, number>;
};

const STOPWORDS = new Set([
  "a",
  "about",
  "after",
  "against",
  "all",
  "also",
  "an",
  "and",
  "are",
  "as",
  "at",
  "back",
  "be",
  "been",
  "before",
  "by",
  "can",
  "could",
  "do",
  "does",
  "during",
  "even",
  "for",
  "from",
  "has",
  "have",
  "he",
  "her",
  "his",
  "if",
  "in",
  "into",
  "is",
  "it",
  "its",
  "just",
  "may",
  "more",
  "new",
  "not",
  "of",
  "on",
  "one",
  "or",
  "our",
  "over",
  "says",
  "she",
  "than",
  "that",
  "the",
  "their",
  "them",
  "they",
  "this",
  "to",
  "up",
  "was",
  "were",
  "what",
  "when",
  "who",
  "will",
  "with",
  // Romanian stopwords (BIV-501). Title tokens pass through
  // foldDiacriticsToAscii before this filter, so ASCII-folded forms only.
  // Tokens under 3 chars are already dropped by the length filter.
  "acest",
  "aceasta",
  "acestei",
  "acestui",
  "ani",
  "anunta",
  "asupra",
  "care",
  "catre",
  "cand",
  "cea",
  "cel",
  "cele",
  "celor",
  "cum",
  "dar",
  "despre",
  "din",
  "dintre",
  "doar",
  "dupa",
  "este",
  "fara",
  "fata",
  "fiind",
  "fost",
  "iar",
  "intre",
  "mai",
  "noi",
  "nou",
  "noua",
  "pentru",
  "peste",
  "prin",
  "sau",
  "spre",
  "spune",
  "sunt",
  "toate",
  "unde",
  "unei",
  "unui",
]);

function toEventEmbedding(articleEmbedding: number[]): number[] {
  const padded = new Array(EVENT_EMBEDDING_DIMENSIONS).fill(0);
  const limit = Math.min(articleEmbedding.length, EVENT_EMBEDDING_DIMENSIONS);
  for (let i = 0; i < limit; i++) {
    padded[i] = articleEmbedding[i]!;
  }
  return padded;
}

function formatUtcDayBucket(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 10);
}

function buildRecentWindowBucket(
  lastArticleAt: number,
  referenceTime: number = Date.now(),
): string {
  return referenceTime - lastArticleAt <= RECENT_EVENT_WINDOW_MS
    ? MERGE_RECENT_BUCKET
    : MERGE_STALE_BUCKET;
}

function buildSingletonBucket(articleCount: number): string {
  return articleCount <= 2 ? SINGLETON_BUCKET : MULTI_ARTICLE_BUCKET;
}

function buildEventEmbeddingFilterFields(args: {
  status?: "processing" | "published";
  lastArticleAt: number;
  articleCount: number;
  referenceTime?: number;
}) {
  const recentWindowBucket = buildRecentWindowBucket(
    args.lastArticleAt,
    args.referenceTime,
  );
  const singletonBucket = buildSingletonBucket(args.articleCount);
  const updatedDayBucket = formatUtcDayBucket(args.lastArticleAt);
  const status = args.status ?? "processing";

  return {
    recentWindowBucket,
    singletonBucket,
    updatedDayBucket,
    mergeSearchBucket: `${status}::${recentWindowBucket}::${updatedDayBucket}`,
    singletonSearchBucket: `${status}::${singletonBucket}::${updatedDayBucket}`,
  };
}

async function syncHotEventEmbedding(
  ctx: MutationCtx,
  args: {
    eventId: Id<"events">;
    embeddingId: Id<"eventEmbeddings">;
    embedding: number[];
    version: number;
    status: "processing" | "published";
    lastArticleAt: number;
    articleCount: number;
  },
) {
  const filterFields = buildEventEmbeddingFilterFields({
    status: args.status,
    lastArticleAt: args.lastArticleAt,
    articleCount: args.articleCount,
  });
  if (filterFields.recentWindowBucket !== MERGE_RECENT_BUCKET) {
    const existingHot = await ctx.db
      .query("eventEmbeddingHot")
      .withIndex("by_event", (q) => q.eq("eventId", args.eventId))
      .first();
    if (existingHot) await ctx.db.delete(existingHot._id);
    return undefined;
  }

  const existingHot = await ctx.db
    .query("eventEmbeddingHot")
    .withIndex("by_event", (q) => q.eq("eventId", args.eventId))
    .first();
  const payload = {
    embeddingId: args.embeddingId,
    embedding: args.embedding,
    version: args.version,
    status: args.status,
    recentWindowBucket: filterFields.recentWindowBucket,
    updatedDayBucket: filterFields.updatedDayBucket,
    lastArticleAt: args.lastArticleAt,
    articleCount: args.articleCount,
    updatedAt: Date.now(),
  };

  if (existingHot) {
    await ctx.db.patch(existingHot._id, payload);
    return existingHot._id;
  }

  return await ctx.db.insert("eventEmbeddingHot", {
    eventId: args.eventId,
    ...payload,
  });
}

function collectRecentDayBuckets(
  windowHours: number,
  now: number = Date.now(),
) {
  const dayCount = Math.max(1, Math.ceil(windowHours / 24) + 1);
  const buckets: string[] = [];
  for (let offset = 0; offset < dayCount; offset++) {
    buckets.push(formatUtcDayBucket(now - offset * 24 * 60 * 60 * 1000));
  }
  return buckets;
}

function buildMergeSearchBuckets(dayBuckets: string[]) {
  return dayBuckets.flatMap((dayBucket) => [
    `published::${MERGE_RECENT_BUCKET}::${dayBucket}`,
    `processing::${MERGE_RECENT_BUCKET}::${dayBucket}`,
  ]);
}

function buildSingletonSearchBuckets(dayBuckets: string[]) {
  return dayBuckets.flatMap((dayBucket) => [
    `published::${SINGLETON_BUCKET}::${dayBucket}`,
    `processing::${SINGLETON_BUCKET}::${dayBucket}`,
  ]);
}

function buildRunId(jobName: ClusteringJobName): string {
  return `${jobName}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function createJobMetrics(
  jobName: ClusteringJobName,
  perSearchBytes: number,
): JobMetrics {
  return {
    jobName,
    runId: buildRunId(jobName),
    budgetAllowed: true,
    usedFallbackMode: false,
    vectorSearches: 0,
    vectorMatchesReturned: 0,
    vectorMatchesHydrated: 0,
    vectorMatchesDiscardedPostFetch: 0,
    vectorSearchesPerArticle: 0,
    vectorSearchesPerCandidateEvent: 0,
    batchArticles: 0,
    candidateCacheSize: 0,
    mergeSeedEvents: 0,
    reclusterSeedEvents: 0,
    perSearchBytes,
    qgbRead: 0,
    elapsedMs: 0,
    stageMs: {},
  };
}

function markStageDuration(
  metrics: JobMetrics,
  stage: string,
  startedAt: number,
): number {
  const elapsed = Date.now() - startedAt;
  metrics.stageMs[stage] = (metrics.stageMs[stage] ?? 0) + elapsed;
  return elapsed;
}

async function flushJobMetrics(
  ctx: ActionCtx,
  metrics: JobMetrics,
  startedAt: number,
): Promise<void> {
  metrics.elapsedMs = Date.now() - startedAt;
  metrics.qgbRead = estimateVectorSearchQgbRead({
    vectorSearches: metrics.vectorSearches,
    estimatedPerSearchBytes: metrics.perSearchBytes,
  });

  console.log(
    `[clustering] ${metrics.jobName} metrics ${JSON.stringify(metrics)}`,
  );

  await ctx.runMutation(internal.vectorSearchBudget.recordUsage, {
    jobName: metrics.jobName,
    runId: metrics.runId,
    qgbRead: metrics.qgbRead,
    vectorSearches: metrics.vectorSearches,
    vectorMatchesReturned: metrics.vectorMatchesReturned,
    vectorMatchesHydrated: metrics.vectorMatchesHydrated,
    vectorMatchesDiscardedPostFetch: metrics.vectorMatchesDiscardedPostFetch,
    usedFallbackMode: metrics.usedFallbackMode,
    budgetAllowed: metrics.budgetAllowed,
    elapsedMs: metrics.elapsedMs,
    metricsJson: JSON.stringify(metrics),
  });
  try {
    await ctx.runMutation(internal.pipeline.insertRunLog, {
      jobName: metrics.jobName,
      runId: metrics.runId,
      startedAt,
      finishedAt: Date.now(),
      durationMs: metrics.elapsedMs,
      status: metrics.usedFallbackMode ? "degraded" : "ok",
      counters: {
        vectorSearches: metrics.vectorSearches,
        vectorMatchesReturned: metrics.vectorMatchesReturned,
        vectorMatchesHydrated: metrics.vectorMatchesHydrated,
        vectorMatchesDiscardedPostFetch:
          metrics.vectorMatchesDiscardedPostFetch,
        batchArticles: metrics.batchArticles,
        mergeSeedEvents: metrics.mergeSeedEvents,
        reclusterSeedEvents: metrics.reclusterSeedEvents,
      },
      gauges: {
        qgbRead: metrics.qgbRead,
        usedFallbackMode: metrics.usedFallbackMode,
        budgetAllowed: metrics.budgetAllowed,
        candidateCacheSize: metrics.candidateCacheSize,
      },
      metadata: {
        stageMs: metrics.stageMs,
      },
    });
  } catch (error) {
    console.error(
      JSON.stringify({
        scope: metrics.jobName,
        event: "pipeline_run_log_error",
        runId: metrics.runId,
        errorMessage: error instanceof Error ? error.message : String(error),
      }),
    );
  }
}

async function getVectorSearchBudgetState(ctx: ActionCtx) {
  return await ctx.runQuery(internal.vectorSearchBudget.checkBudget, {});
}

async function reserveVectorSearch(ctx: ActionCtx, metrics: JobMetrics) {
  const reservation = await ctx.runMutation(
    internal.vectorSearchBudget.reserveUsage,
    {
      jobName: metrics.jobName,
      runId: metrics.runId,
      qgbRead: estimateVectorSearchQgbRead({
        vectorSearches: 1,
        estimatedPerSearchBytes: metrics.perSearchBytes,
      }),
      vectorSearches: 1,
    },
  );

  metrics.budgetAllowed = reservation.allowed;
  if (!reservation.allowed) {
    metrics.usedFallbackMode = reservation.fallbackModeEnabled;
    console.log(
      `[clustering] ${metrics.jobName} vector search skipped: budget exhausted (${reservation.usedQgb}/${reservation.dailyLimitQgb} qGB)`,
    );
    return null;
  }

  return reservation.reservationId;
}

async function reserveVectorSearchBatch(
  ctx: ActionCtx,
  metrics: JobMetrics,
  vectorSearches: number,
) {
  const reservedSearches = Math.max(1, Math.floor(vectorSearches));
  const reservation = await ctx.runMutation(
    internal.vectorSearchBudget.reserveUsage,
    {
      jobName: metrics.jobName,
      runId: metrics.runId,
      qgbRead: estimateVectorSearchQgbRead({
        vectorSearches: reservedSearches,
        estimatedPerSearchBytes: metrics.perSearchBytes,
      }),
      vectorSearches: reservedSearches,
    },
  );

  metrics.budgetAllowed = reservation.allowed;
  if (!reservation.allowed) {
    metrics.usedFallbackMode = reservation.fallbackModeEnabled;
    console.log(
      `[clustering] ${metrics.jobName} vector search batch skipped: budget exhausted (${reservation.usedQgb}/${reservation.dailyLimitQgb} qGB)`,
    );
    return null;
  }

  return reservation.reservationId;
}

async function consumeVectorSearchBatchReservation(
  ctx: ActionCtx,
  metrics: JobMetrics,
  reservationId: Id<"vectorSearchReservations">,
) {
  await ctx.runMutation(internal.vectorSearchBudget.consumeReservation, {
    reservationId,
    qgbRead: estimateVectorSearchQgbRead({
      vectorSearches: metrics.vectorSearches,
      estimatedPerSearchBytes: metrics.perSearchBytes,
    }),
    vectorSearches: metrics.vectorSearches,
  });
}

async function consumeVectorSearchReservation(
  ctx: ActionCtx,
  metrics: JobMetrics,
  reservationId: Id<"vectorSearchReservations">,
) {
  await ctx.runMutation(internal.vectorSearchBudget.consumeReservation, {
    reservationId,
    qgbRead: estimateVectorSearchQgbRead({
      vectorSearches: 1,
      estimatedPerSearchBytes: metrics.perSearchBytes,
    }),
    vectorSearches: 1,
  });
}

async function releaseVectorSearchReservation(
  ctx: ActionCtx,
  reservationId: Id<"vectorSearchReservations">,
) {
  await ctx.runMutation(internal.vectorSearchBudget.releaseReservation, {
    reservationId,
  });
}

function appendArticleEmbeddingToEventMean(
  existingEventEmbedding: number[],
  currentArticleCount: number,
  newArticleEmbedding: number[],
): number[] {
  // Invariant: eventEmbeddings.embedding is the arithmetic mean of all member
  // article embeddings, padded to EVENT_EMBEDDING_DIMENSIONS. create/attach/
  // merge/recompute paths must preserve this shape.
  const existing = toEventEmbedding(existingEventEmbedding);
  const incoming = toEventEmbedding(newArticleEmbedding);
  if (currentArticleCount <= 0) return incoming;
  return existing.map(
    (value, index) =>
      (value * currentArticleCount + incoming[index]!) /
      (currentArticleCount + 1),
  );
}

function cosineSimilarity(a: number[], b: number[]): number {
  const length = Math.min(a.length, b.length);
  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < length; i++) {
    const av = a[i] ?? 0;
    const bv = b[i] ?? 0;
    dot += av * bv;
    normA += av * av;
    normB += bv * bv;
  }

  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

function normalizeText(text: string): string {
  // Fold diacritics first so Romanian titles written with and without
  // diacritics ("ședință" vs "sedinta") produce the same tokens instead of
  // being gutted by the ASCII filter.
  return foldDiacriticsToAscii(text)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeTitleTokens(text: string): Set<string> {
  return new Set(
    normalizeText(text)
      .split(" ")
      .map((token) => token.trim())
      .filter((token) => token.length >= 3 && !STOPWORDS.has(token)),
  );
}

function countTokenOverlap(a: Set<string>, b: Set<string>): number {
  let overlap = 0;
  for (const token of a) {
    if (b.has(token)) overlap++;
  }
  return overlap;
}

function mergeTokenSets(...sets: Array<Set<string>>): Set<string> {
  const merged = new Set<string>();
  for (const set of sets) {
    for (const token of set) {
      merged.add(token);
    }
  }
  return merged;
}

function mergeAndCapTokenArray(
  existing: string[] | undefined,
  incoming: Iterable<string>,
  cap: number = CANDIDACY_TOKEN_CAP,
): string[] {
  const result = existing ? [...existing] : [];
  const seen = new Set(result);
  for (const token of incoming) {
    const cleaned = token.trim();
    if (!cleaned || seen.has(cleaned)) continue;
    result.push(cleaned);
    seen.add(cleaned);
    while (result.length > cap) {
      const removed = result.shift();
      if (removed !== undefined) {
        seen.delete(removed);
      }
    }
  }
  return result;
}

function mergeTopicSlugs(
  existing: string[] | undefined,
  incoming: Iterable<string>,
): string[] {
  const result = new Set(existing ?? []);
  for (const slug of incoming) {
    if (!slug) continue;
    result.add(slug);
  }
  return Array.from(result);
}

function buildArticleEvidenceTokens(
  article: Pick<Doc<"articles">, "rssSnippet" | "summary">,
): Set<string> {
  return mergeTokenSets(
    normalizeTitleTokens(normalizeSnippetForClustering(article.rssSnippet)),
    normalizeTitleTokens(normalizeSnippetForClustering(article.summary)),
  );
}

function buildArticleFactTokens(
  article: Pick<Doc<"articles">, "atomicFacts">,
): Set<string> {
  return normalizeTitleTokens(
    (article.atomicFacts ?? [])
      .map((fact) => normalizeSnippetForClustering(fact))
      .join(" "),
  );
}

function buildArticleEntityTokens(
  eventTitle: string,
  article: Pick<
    Doc<"articles">,
    "title" | "rssSnippet" | "summary" | "entities" | "atomicFacts"
  >,
): Set<string> {
  return extractEntityTokens(
    normalizeTitleForClustering(eventTitle),
    normalizeTitleForClustering(article.title),
    normalizeSnippetForClustering(article.rssSnippet),
    normalizeSnippetForClustering(article.summary),
    (article.entities ?? [])
      .map((entity) => normalizeSnippetForClustering(entity))
      .join(" "),
    (article.atomicFacts ?? [])
      .map((fact) => normalizeSnippetForClustering(fact))
      .join(" "),
  );
}

function buildCandidacyFromArticle(
  eventTitle: string,
  article: Pick<
    Doc<"articles">,
    "title" | "rssSnippet" | "summary" | "atomicFacts" | "entities"
  >,
  topicSlugs: string[],
): {
  titleTokens: string[];
  evidenceTokens: string[];
  factTokens: string[];
  entityTokens: string[];
  topicSlugs: string[];
} {
  const titleTokens = normalizeTitleTokens(
    normalizeTitleForClustering(eventTitle),
  );
  const evidenceTokens = buildArticleEvidenceTokens(article);
  const factTokens = buildArticleFactTokens(article);
  const entityTokens = buildArticleEntityTokens(eventTitle, article);

  return {
    titleTokens: [...titleTokens],
    evidenceTokens: [...evidenceTokens].slice(0, CANDIDACY_TOKEN_CAP),
    factTokens: [...factTokens].slice(0, CANDIDACY_TOKEN_CAP),
    entityTokens: [...entityTokens].slice(0, CANDIDACY_TOKEN_CAP),
    topicSlugs: mergeTopicSlugs([], topicSlugs),
  };
}

function buildCandidacyFromArticles(
  eventTitle: string,
  articles: Array<
    Pick<
      Doc<"articles">,
      "title" | "rssSnippet" | "summary" | "atomicFacts" | "entities"
    >
  >,
  topicSlugs: string[],
): {
  titleTokens: string[];
  evidenceTokens: string[];
  factTokens: string[];
  entityTokens: string[];
  topicSlugs: string[];
} {
  const titleTokens = normalizeTitleTokens(
    normalizeTitleForClustering(eventTitle),
  );
  const evidenceTokens = mergeTokenSets(
    ...articles.map((article) => buildArticleEvidenceTokens(article)),
  );
  const factTokens = mergeTokenSets(
    ...articles.map((article) => buildArticleFactTokens(article)),
  );
  const entityTokens = mergeTokenSets(
    extractEntityTokens(normalizeTitleForClustering(eventTitle)),
    ...articles.map((article) => buildArticleEntityTokens(eventTitle, article)),
  );

  return {
    titleTokens: [...titleTokens],
    evidenceTokens: [...evidenceTokens].slice(0, CANDIDACY_TOKEN_CAP),
    factTokens: [...factTokens].slice(0, CANDIDACY_TOKEN_CAP),
    entityTokens: [...entityTokens].slice(0, CANDIDACY_TOKEN_CAP),
    topicSlugs: mergeTopicSlugs([], topicSlugs),
  };
}

function buildCandidacySnapshotFields(args: {
  status: "processing" | "published";
  firstPublishedAt: number;
  lastArticleAt: number;
  articleCount: number;
  sourceCount: number;
  sourceIds: Id<"sources">[];
}) {
  return {
    status: args.status,
    firstPublishedAt: args.firstPublishedAt,
    lastArticleAt: args.lastArticleAt,
    articleCount: args.articleCount,
    sourceCount: args.sourceCount,
    sourceIds: args.sourceIds,
  };
}

function stripHtmlTags(text: string): string {
  return text
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function extractEntityTokens(...texts: string[]): Set<string> {
  const entities = new Set<string>();

  for (const rawText of texts) {
    const text = stripHtmlTags(rawText);
    if (!text) continue;

    const capitalizedMatches =
      text.match(
        /\b(?:[A-Z][a-z]+|[A-Z]{2,})(?:\s+(?:[A-Z][a-z]+|[A-Z]{2,}|of|the|and|for|in|on|to)){0,4}\b/g,
      ) ?? [];
    for (const match of capitalizedMatches) {
      const normalized = match.trim().replace(/\s+/g, " ").toLowerCase();
      if (normalized.length >= 4) {
        entities.add(normalized);
      }
    }

    const numericMatches =
      text.match(
        /\$\d[\d,.]*(?:\s?(?:billion|million|trillion))?|\b\d+(?:\.\d+)?%|\b\d+(?:st|nd|rd|th)\b/gi,
      ) ?? [];
    for (const match of numericMatches) {
      entities.add(match.trim().toLowerCase());
    }
  }

  return entities;
}

function normalizeSnippetForClustering(text: string | undefined): string {
  return normalizeArticleSnippet(text ?? "");
}

function normalizeTitleForClustering(text: string): string {
  return normalizeArticleTitle(text);
}

function slugify(value: string): string {
  const slug = foldDiacriticsToAscii(value)
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 80);
  return slug.length > 0 ? slug : "event";
}

function buildEventSlug(
  title: string,
  publishedAt: number,
  articleId: Id<"articles">,
): string {
  const ymd = new Date(publishedAt).toISOString().slice(0, 10);
  const suffix = String(articleId)
    .replace(/[^a-zA-Z0-9]/g, "")
    .slice(-6);
  return `${slugify(title)}-${ymd}-${suffix}`.toLowerCase();
}

function buildClusterPairKey(
  leftArticleId: Id<"articles">,
  rightArticleId: Id<"articles">,
): string {
  return [String(leftArticleId), String(rightArticleId)].sort().join("::");
}

function buildEventPairKey(
  leftEventId: Id<"events">,
  rightEventId: Id<"events">,
): string {
  return [String(leftEventId), String(rightEventId)].sort().join("::");
}

type ClusterCandidate = {
  eventId: Id<"events">;
  embeddingId?: Id<"eventEmbeddings">;
  hotEmbeddingId?: Id<"eventEmbeddingHot">;
  title: string;
  slug: string;
  firstPublishedAt: number;
  lastArticleAt: number;
  articleCount: number;
  sourceCount: number;
  embedding?: number[];
  similarity?: number;
  titleTokens: Set<string>;
  evidenceTokens: Set<string>;
  factTokens: Set<string>;
  entityTokens: Set<string>;
  topicSlugs: Set<string>;
  sourceIds: Set<Id<"sources">>;
  perspectiveSummaries?: {
    neutral?: string;
    reformist?: string;
    suveranist?: string;
  };
  globalImpact?: string;
  imageUrl?: string;
  perspectiveSource?: "heuristic" | "ai";
  lastSummarizedAt?: number;
  lastSummarySignature?: string;
  creationTime: number;
};

type ClusterCandidateQueryResult = {
  eventId: Id<"events">;
  embeddingId: Id<"eventEmbeddings">;
  hotEmbeddingId?: Id<"eventEmbeddingHot">;
  title: string;
  slug: string;
  firstPublishedAt: number;
  lastArticleAt: number;
  articleCount: number;
  sourceCount: number;
  embedding?: number[];
  sourceIds: Id<"sources">[];
  evidenceTokens: string[];
  factTokens: string[];
  entityTokens: string[];
  topicSlugs: string[];
  perspectiveSummaries?: {
    neutral?: string;
    reformist?: string;
    suveranist?: string;
  };
  globalImpact?: string;
  imageUrl?: string;
  perspectiveSource?: "heuristic" | "ai";
  lastSummarizedAt?: number;
  lastSummarySignature?: string;
  creationTime: number;
};

type ClusterCandidateVectorResult = ClusterCandidateQueryResult & {
  similarity: number;
};

function hydrateClusterCandidate(
  candidate: ClusterCandidateQueryResult | ClusterCandidateVectorResult,
): ClusterCandidate {
  return {
    ...candidate,
    embeddingId: candidate.embeddingId,
    lastArticleAt: candidate.lastArticleAt ?? candidate.firstPublishedAt,
    sourceCount: candidate.sourceCount ?? candidate.sourceIds?.length ?? 0,
    titleTokens: normalizeTitleTokens(candidate.title),
    evidenceTokens: new Set(candidate.evidenceTokens ?? []),
    factTokens: new Set(candidate.factTokens ?? []),
    entityTokens: new Set(candidate.entityTokens ?? []),
    topicSlugs: new Set(candidate.topicSlugs ?? []),
    sourceIds: new Set(candidate.sourceIds ?? []),
  };
}

type ClusterSettings = {
  minSimilarity: number;
  strongSimilarity: number;
  minTitleTokenOverlap: number;
  minTitleJaccard: number;
  sameSourceMinSimilarity: number;
  weakExtractionMinSimilarity: number;
  weakExtractionStrongSimilarity: number;
};

export type TopicInferenceSettings = {
  minScore: number;
  confidenceRatio: number;
  maxTopics: number;
};

type ClusterPublishSettings = {
  minArticles: number;
  minSources: number;
};

type MergeSettings = {
  minSimilarity: number;
  minTitleJaccard: number;
  maxTimeDeltaHours: number;
};

type ReclusterSettings = {
  minSimilarity: number;
  windowHours: number;
};

export type TopicInferenceTopic = Pick<
  Doc<"topics">,
  | "_id"
  | "slug"
  | "displayName"
  | "description"
  | "aliases"
  | "keywords"
  | "keyPhrases"
  | "excludePhrases"
>;

type CompiledTopicInferenceTopic = {
  slug: string;
  titlePhrases: string[];
  bodyPhrases: string[];
  keywordTokens: string[];
  excludePhrases: string[];
  displayNameTokens: Set<string>;
};

export type TopicArticleContext = {
  title: string;
  rssSnippet: string;
  summary: string;
  atomicFacts: string[];
  entities?: string[];
  extractionQuality?: "strong" | "weak";
};

type NormalizedTopicField = {
  text: string;
  tokens: Set<string>;
};

type TopicInferenceFieldContexts = {
  title: NormalizedTopicField;
  snippet: NormalizedTopicField;
  summary: NormalizedTopicField;
  facts: NormalizedTopicField;
  combined: NormalizedTopicField;
};

export type TopicInferenceCandidate = {
  slug: string;
  score: number;
  signalCount: number;
  titlePhraseHits: number;
  snippetPhraseHits: number;
  summaryPhraseHits: number;
  factPhraseHits: number;
  titleKeywordHits: number;
  snippetKeywordHits: number;
  summaryKeywordHits: number;
  factKeywordHits: number;
  displayNameCoverage: number;
  fullDisplayNameCoverage: boolean;
  excludeHits: number;
};

function clampNumber(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}

function safeInteger(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
) {
  return Math.floor(clampNumber(value, fallback, min, max));
}

function normalizePhrase(value: string): string {
  return normalizeText(value);
}

function countPhraseOccurrences(text: string, phrase: string): number {
  if (!text || !phrase) return 0;

  const paddedText = ` ${text} `;
  const paddedPhrase = ` ${phrase} `;
  let count = 0;
  let start = 0;

  while (true) {
    const index = paddedText.indexOf(paddedPhrase, start);
    if (index === -1) break;
    count++;
    start = index + paddedPhrase.length;
  }

  return count;
}

function countMatchedKeywords(
  tokens: Set<string>,
  keywordTokens: string[],
): number {
  let matches = 0;
  for (const token of keywordTokens) {
    if (tokens.has(token)) {
      matches++;
    }
  }
  return matches;
}

function buildTopicFieldContexts(
  article: TopicArticleContext,
): TopicInferenceFieldContexts {
  const titleText = normalizeText(article.title);
  const snippetText = normalizeText(article.rssSnippet);
  const summaryText = normalizeText(article.summary);
  const factsText = normalizeText(article.atomicFacts.join(" "));
  const combinedText = [titleText, snippetText, summaryText, factsText]
    .filter(Boolean)
    .join(" ")
    .trim();

  return {
    title: { text: titleText, tokens: normalizeTitleTokens(article.title) },
    snippet: {
      text: snippetText,
      tokens: normalizeTitleTokens(article.rssSnippet),
    },
    summary: {
      text: summaryText,
      tokens: normalizeTitleTokens(article.summary),
    },
    facts: {
      text: factsText,
      tokens: normalizeTitleTokens(article.atomicFacts.join(" ")),
    },
    combined: {
      text: combinedText,
      tokens: normalizeTitleTokens(combinedText),
    },
  };
}

function compileTopicForInference(
  topic: TopicInferenceTopic,
): CompiledTopicInferenceTopic {
  const aliases = topic.aliases ?? [];
  const keyPhrases = topic.keyPhrases ?? [];
  const keywords = topic.keywords ?? [];
  const excludePhrases = topic.excludePhrases ?? [];

  const titlePhrases = Array.from(
    new Set(
      [
        topic.displayName,
        topic.slug.replace(/-/g, " "),
        ...aliases,
        ...keyPhrases,
      ]
        .map(normalizePhrase)
        .filter((value) => value.length >= 2),
    ),
  );

  const bodyPhrases = Array.from(
    new Set(
      [
        ...titlePhrases,
        topic.description ?? "",
        ...keywords.filter((keyword) => keyword.includes(" ")),
      ]
        .map(normalizePhrase)
        .filter((value) => value.length >= 2),
    ),
  );

  const keywordTokens = Array.from(
    new Set(
      [
        ...keywords,
        ...aliases,
        ...keyPhrases,
        topic.displayName,
        topic.slug.replace(/-/g, " "),
      ]
        .flatMap((value) => normalizePhrase(value).split(" "))
        .map((token) => token.trim())
        .filter((token) => token.length >= 3 && !STOPWORDS.has(token)),
    ),
  );

  return {
    slug: topic.slug,
    titlePhrases,
    bodyPhrases,
    keywordTokens,
    excludePhrases: excludePhrases.map(normalizePhrase).filter(Boolean),
    displayNameTokens: normalizeTitleTokens(topic.displayName),
  };
}

export function evaluateTopicInference(
  article: TopicArticleContext,
  topics: TopicInferenceTopic[],
  settings: TopicInferenceSettings,
): TopicInferenceCandidate[] {
  if (topics.length === 0) return [];

  const fields = buildTopicFieldContexts(article);
  const compiledTopics = topics.map(compileTopicForInference);
  return compiledTopics
    .map((topic) => {
      const titlePhraseHits = topic.titlePhrases.reduce(
        (sum, phrase) =>
          sum + countPhraseOccurrences(fields.title.text, phrase),
        0,
      );
      const snippetPhraseHits = topic.bodyPhrases.reduce(
        (sum, phrase) =>
          sum + countPhraseOccurrences(fields.snippet.text, phrase),
        0,
      );
      const summaryPhraseHits = topic.bodyPhrases.reduce(
        (sum, phrase) =>
          sum + countPhraseOccurrences(fields.summary.text, phrase),
        0,
      );
      const factPhraseHits = topic.bodyPhrases.reduce(
        (sum, phrase) =>
          sum + countPhraseOccurrences(fields.facts.text, phrase),
        0,
      );
      const excludeHits = topic.excludePhrases.reduce(
        (sum, phrase) =>
          sum + countPhraseOccurrences(fields.combined.text, phrase),
        0,
      );

      const titleKeywordHits = countMatchedKeywords(
        fields.title.tokens,
        topic.keywordTokens,
      );
      const snippetKeywordHits = countMatchedKeywords(
        fields.snippet.tokens,
        topic.keywordTokens,
      );
      const summaryKeywordHits = countMatchedKeywords(
        fields.summary.tokens,
        topic.keywordTokens,
      );
      const factKeywordHits = countMatchedKeywords(
        fields.facts.tokens,
        topic.keywordTokens,
      );
      const displayNameCoverage = countTokenOverlap(
        fields.combined.tokens,
        topic.displayNameTokens,
      );
      const fullDisplayNameCoverage =
        topic.displayNameTokens.size > 0 &&
        displayNameCoverage === topic.displayNameTokens.size;

      const score =
        titlePhraseHits * 5.5 +
        summaryPhraseHits * 2.8 +
        snippetPhraseHits * 2.2 +
        factPhraseHits * 3 +
        titleKeywordHits * 2.1 +
        summaryKeywordHits * 1.15 +
        snippetKeywordHits * 0.85 +
        factKeywordHits * 1.25 +
        displayNameCoverage * 0.9 +
        (fullDisplayNameCoverage ? 2.5 : 0) -
        excludeHits * 4;

      const signalCount =
        titlePhraseHits +
        summaryPhraseHits +
        snippetPhraseHits +
        factPhraseHits +
        titleKeywordHits +
        summaryKeywordHits +
        snippetKeywordHits +
        factKeywordHits;

      return {
        slug: topic.slug,
        score,
        signalCount,
        titlePhraseHits,
        snippetPhraseHits,
        summaryPhraseHits,
        factPhraseHits,
        titleKeywordHits,
        snippetKeywordHits,
        summaryKeywordHits,
        factKeywordHits,
        displayNameCoverage,
        fullDisplayNameCoverage,
        excludeHits,
      };
    })
    .filter(
      (topic) =>
        topic.score >= settings.minScore &&
        (topic.signalCount >= 2 || topic.score >= settings.minScore + 2),
    )
    .sort((a, b) => b.score - a.score);
}

export function inferTopicSlugs(
  article: TopicArticleContext,
  topics: TopicInferenceTopic[],
  settings: TopicInferenceSettings,
): string[] {
  const scored = evaluateTopicInference(article, topics, settings);
  if (scored.length === 0) return [];

  const topScore = scored[0]!.score;
  return scored
    .filter((topic) => topic.score >= topScore * settings.confidenceRatio)
    .slice(0, settings.maxTopics)
    .map((topic) => topic.slug);
}

function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  if (a.size === 0 || b.size === 0) return 0;

  let intersection = 0;
  for (const token of a) {
    if (b.has(token)) intersection++;
  }
  const union = a.size + b.size - intersection;
  return union > 0 ? intersection / union : 0;
}

function preferLongerString(
  primary: string | undefined,
  fallback: string | undefined,
): string | undefined {
  const a = primary?.trim();
  const b = fallback?.trim();
  if (!a) return b;
  if (!b) return a;
  return a.length >= b.length ? a : b;
}

function buildMergedPerspectiveSummaries(
  primary: ClusterCandidate,
  secondary: ClusterCandidate,
) {
  // Normalize first so pre-BIV-303 rows still on center/left/right keys
  // contribute their summaries instead of being dropped by the merge.
  const primaryPerspectives = normalizedPerspectives(
    primary.perspectiveSummaries,
  );
  const secondaryPerspectives = normalizedPerspectives(
    secondary.perspectiveSummaries,
  );
  const neutral = preferLongerString(
    primaryPerspectives?.neutral,
    secondaryPerspectives?.neutral,
  );
  const reformist = preferLongerString(
    primaryPerspectives?.reformist,
    secondaryPerspectives?.reformist,
  );
  const suveranist = preferLongerString(
    primaryPerspectives?.suveranist,
    secondaryPerspectives?.suveranist,
  );

  if (!neutral && !reformist && !suveranist) return undefined;
  return { neutral, reformist, suveranist };
}

function pickMergedSummaryMetadata(
  primary: Pick<ClusterCandidate, "lastSummarizedAt" | "lastSummarySignature">,
  secondary: Pick<
    ClusterCandidate,
    "lastSummarizedAt" | "lastSummarySignature"
  >,
): {
  lastSummarizedAt?: number;
  lastSummarySignature?: string;
} {
  const primaryAt = primary.lastSummarizedAt;
  const secondaryAt = secondary.lastSummarizedAt;

  if (primaryAt === undefined && secondaryAt === undefined) {
    const signature =
      primary.lastSummarySignature ?? secondary.lastSummarySignature;
    return {
      lastSummarizedAt: undefined,
      lastSummarySignature: signature || undefined,
    };
  }

  if ((primaryAt ?? 0) >= (secondaryAt ?? 0)) {
    return {
      lastSummarizedAt: primaryAt,
      lastSummarySignature:
        primary.lastSummarySignature ?? secondary.lastSummarySignature,
    };
  }

  return {
    lastSummarizedAt: secondaryAt,
    lastSummarySignature:
      secondary.lastSummarySignature ?? primary.lastSummarySignature,
  };
}

function chooseCanonicalEvent(
  a: ClusterCandidate,
  b: ClusterCandidate,
): { keep: ClusterCandidate; remove: ClusterCandidate } {
  if (a.articleCount !== b.articleCount) {
    return a.articleCount > b.articleCount
      ? { keep: a, remove: b }
      : { keep: b, remove: a };
  }
  if (a.firstPublishedAt !== b.firstPublishedAt) {
    return a.firstPublishedAt <= b.firstPublishedAt
      ? { keep: a, remove: b }
      : { keep: b, remove: a };
  }
  if (a.creationTime !== b.creationTime) {
    return a.creationTime <= b.creationTime
      ? { keep: a, remove: b }
      : { keep: b, remove: a };
  }
  return String(a.eventId) < String(b.eventId)
    ? { keep: a, remove: b }
    : { keep: b, remove: a };
}

function summarizeText(
  text: string | undefined,
  maxLength: number,
): string | undefined {
  const cleaned = text?.replace(/\s+/g, " ").trim();
  if (!cleaned) return undefined;
  if (cleaned.length <= maxLength) return cleaned;

  const slice = cleaned.slice(0, maxLength);
  const lastBoundary = Math.max(
    slice.lastIndexOf(". "),
    slice.lastIndexOf("; "),
    slice.lastIndexOf(", "),
    slice.lastIndexOf(" "),
  );
  const trimmed = (
    lastBoundary > maxLength * 0.55 ? slice.slice(0, lastBoundary) : slice
  )
    .trim()
    .replace(/[,:;.\s]+$/g, "");
  return `${trimmed}.`;
}

function computePresentationRecency(
  publishedAt: number,
  referenceTime: number = Date.now(),
  horizonMs: number = 365 * 24 * 60 * 60 * 1000,
): number {
  if (!Number.isFinite(publishedAt) || !Number.isFinite(referenceTime)) {
    return 0;
  }
  if (horizonMs <= 0) return 0;
  const delta = referenceTime - publishedAt;
  if (!Number.isFinite(delta)) return 0;
  const ratio = 1 - delta / horizonMs;
  return Math.max(0, Math.min(1, ratio));
}

function articlePresentationScore(
  article: Pick<
    Doc<"articles">,
    "title" | "rssSnippet" | "publishedAt" | "sourceId"
  >,
  source: Doc<"sources"> | null,
  eventTitleTokens: Set<string>,
): number {
  const titleTokens = normalizeTitleTokens(
    normalizeTitleForClustering(article.title),
  );
  const snippetTokens = normalizeTitleTokens(
    normalizeSnippetForClustering(article.rssSnippet),
  );
  const titleOverlap = countTokenOverlap(titleTokens, eventTitleTokens);
  const snippetOverlap = countTokenOverlap(snippetTokens, eventTitleTokens);
  const reliability = source?.reliabilityScore ?? 5;
  const biasDistance = Math.abs(source?.baseBias ?? 0);
  const recencyTieBreaker = computePresentationRecency(article.publishedAt);

  return (
    titleOverlap * 3 +
    snippetOverlap * 1.5 +
    reliability * 0.35 -
    biasDistance * 0.1 +
    recencyTieBreaker * 0.05
  );
}

function articleImageScore(
  article: Pick<
    Doc<"articles">,
    "imageUrl" | "imageWidth" | "imageHeight" | "publishedAt" | "title"
  >,
  source: Doc<"sources"> | null,
  eventTitleTokens: Set<string>,
): number {
  if (!article.imageUrl) return -Infinity;

  const width = article.imageWidth ?? 0;
  const height = article.imageHeight ?? 0;
  const areaScore = Math.min((width * height) / 200_000, 12);
  const widthBonus = width >= 1200 ? 4 : width >= 800 ? 2 : 0;
  const reliabilityBonus = (source?.reliabilityScore ?? 5) * 0.5;
  const titleOverlap = countTokenOverlap(
    normalizeTitleTokens(normalizeTitleForClustering(article.title)),
    eventTitleTokens,
  );
  const recencyTieBreaker = computePresentationRecency(article.publishedAt);

  return (
    areaScore +
    widthBonus +
    reliabilityBonus +
    titleOverlap * 1.25 +
    recencyTieBreaker * 0.05
  );
}

function pickBestEventImageCandidate(
  articlesWithSources: Array<{
    article: Pick<
      Doc<"articles">,
      | "_id"
      | "title"
      | "imageUrl"
      | "imageWidth"
      | "imageHeight"
      | "imageAlt"
      | "imageSource"
      | "publishedAt"
      | "sourceId"
      | "extractionQuality"
    >;
    source: Doc<"sources"> | null;
  }>,
  eventTitleTokens: Set<string>,
) {
  return [...articlesWithSources]
    .filter(({ article }) => Boolean(article.imageUrl))
    .sort(
      (a, b) =>
        articleImageScore(b.article, b.source, eventTitleTokens) -
        articleImageScore(a.article, a.source, eventTitleTokens),
    )[0];
}

async function refreshEventPresentation(
  ctx: MutationCtx,
  eventId: Id<"events">,
): Promise<void> {
  const event = await ctx.db.get(eventId);
  if (!event) return;

  const recentArticles = await ctx.db
    .query("articles")
    .withIndex("by_event_published", (q) => q.eq("eventId", eventId))
    .order("desc")
    .take(EVENT_PRESENTATION_ARTICLE_LIMIT);
  if (recentArticles.length === 0) return;

  let totalArticleCount = event.articleCount;
  let totalSourceCount =
    event.sourceCount ?? (event.sourceIds ? event.sourceIds.length : undefined);

  if (totalArticleCount === undefined || totalSourceCount === undefined) {
    const allArticles = await ctx.db
      .query("articles")
      .withIndex("by_event", (q) => q.eq("eventId", eventId))
      .collect();
    if (allArticles.length === 0) return;

    totalArticleCount = totalArticleCount ?? allArticles.length;
    if (totalSourceCount === undefined) {
      totalSourceCount = new Set(allArticles.map((article) => article.sourceId))
        .size;
    }
  }

  const eventTitleTokens = normalizeTitleTokens(event.title);
  const sourceCache = new Map<Id<"sources">, Doc<"sources"> | null>();
  const articlesWithSources = await Promise.all(
    recentArticles.map(async (article) => {
      const cached = sourceCache.get(article.sourceId);
      if (cached !== undefined) {
        return { article, source: cached };
      }

      const source = await ctx.db.get(article.sourceId);
      sourceCache.set(article.sourceId, source ?? null);
      return { article, source };
    }),
  );

  const ranked = [...articlesWithSources].sort(
    (a, b) =>
      articlePresentationScore(b.article, b.source, eventTitleTokens) -
      articlePresentationScore(a.article, a.source, eventTitleTokens),
  );
  const best = ranked[0]!;
  const bestImage = pickBestEventImageCandidate(
    articlesWithSources,
    eventTitleTokens,
  );
  const uniqueSources = new Set(
    articlesWithSources.map(
      ({ source, article }) => source?.name ?? String(article.sourceId),
    ),
  );
  const resolvedArticleCount = totalArticleCount ?? recentArticles.length;
  const resolvedSourceCount = totalSourceCount ?? uniqueSources.size;

  // L2 (Art. 94¹): the representative snippet is verbatim third-party text
  // and must respect the 120-char "very short extract" ceiling even inside
  // the heuristic summary (the surrounding coverage line is our own text).
  const representativeSnippet =
    truncateThirdPartySnippet(
      normalizeSnippetForClustering(best.article.rssSnippet),
    ) ??
    truncateThirdPartySnippet(
      normalizeTitleForClustering(best.article.title),
    ) ??
    "Acoperirea este încă în curs de agregare din mai multe surse.";

  const coverageLine =
    resolvedSourceCount > 1
      ? `Acest eveniment include ${romanianCount(resolvedArticleCount, "articol", "articole")} din ${romanianCount(resolvedSourceCount, "sursă", "surse")}.`
      : `Acest eveniment include ${romanianCount(resolvedArticleCount, "articol", "articole")}.`;

  const centerSummary = summarizeText(
    `${representativeSnippet} ${coverageLine}`,
    280,
  );

  const sourceNames = Array.from(uniqueSources).slice(0, 3);
  const sourceLine =
    sourceNames.length > 0
      ? `Printre sursele acestui eveniment se numără ${sourceNames.join(", ")}${resolvedSourceCount > sourceNames.length ? " și altele" : ""}.`
      : undefined;
  const globalImpact = summarizeText(
    `${coverageLine} ${sourceLine ?? ""}`.trim(),
    180,
  );
  const latestArticlePublishedAt =
    event.lastArticleAt ??
    recentArticles[0]?.publishedAt ??
    event.firstPublishedAt;
  const nextLastUpdatedAt = Math.max(
    event.lastUpdatedAt ?? 0,
    latestArticlePublishedAt,
  );
  const nextImageUrl = bestImage?.article.imageUrl;
  const resolvedImageUrl = nextImageUrl ?? event.imageUrl;
  const nextImageAlt =
    bestImage?.article.imageAlt ??
    (bestImage ? bestImage.article.title : event.imageAlt);
  const nextImageWidth =
    bestImage?.article.imageWidth ?? event.imageWidth ?? undefined;
  const nextImageHeight =
    bestImage?.article.imageHeight ?? event.imageHeight ?? undefined;
  const isAiAuthored =
    event.perspectiveSource === "ai" || Boolean(event.lastSummarizedAt);

  const eventPerspectives = normalizedPerspectives(event.perspectiveSummaries);
  const nextPerspectiveSummaries = isAiAuthored
    ? eventPerspectives
    : centerSummary
      ? {
          neutral: centerSummary,
          reformist: eventPerspectives?.reformist,
          suveranist: eventPerspectives?.suveranist,
        }
      : eventPerspectives;
  const nextPerspectiveSource = isAiAuthored
    ? "ai"
    : centerSummary
      ? "heuristic"
      : event.perspectiveSource;
  const nextGlobalImpact = isAiAuthored ? event.globalImpact : globalImpact;

  const summariesUnchanged =
    (nextPerspectiveSummaries?.neutral ?? null) ===
      (event.perspectiveSummaries?.neutral ?? null) &&
    (nextPerspectiveSummaries?.reformist ?? null) ===
      (event.perspectiveSummaries?.reformist ?? null) &&
    (nextPerspectiveSummaries?.suveranist ?? null) ===
      (event.perspectiveSummaries?.suveranist ?? null);
  const imageUnchanged =
    resolvedImageUrl === event.imageUrl &&
    nextImageAlt === event.imageAlt &&
    nextImageWidth === event.imageWidth &&
    nextImageHeight === event.imageHeight;
  const countsUnchanged =
    event.articleCount === resolvedArticleCount &&
    event.sourceCount === resolvedSourceCount;
  const lastUpdatedUnchanged = nextLastUpdatedAt === (event.lastUpdatedAt ?? 0);
  const globalImpactUnchanged = nextGlobalImpact === event.globalImpact;
  const perspectiveSourceUnchanged =
    nextPerspectiveSource === event.perspectiveSource;

  if (
    countsUnchanged &&
    summariesUnchanged &&
    imageUnchanged &&
    lastUpdatedUnchanged &&
    globalImpactUnchanged &&
    perspectiveSourceUnchanged
  ) {
    await syncPublicEventPreview(ctx, eventId);
    return;
  }

  await ctx.db.patch(eventId, {
    articleCount: resolvedArticleCount,
    sourceCount: resolvedSourceCount,
    perspectiveSummaries: nextPerspectiveSummaries,
    perspectiveSource: nextPerspectiveSource,
    globalImpact: nextGlobalImpact,
    imageUrl: resolvedImageUrl,
    imageWidth: nextImageWidth,
    imageHeight: nextImageHeight,
    imageAlt: nextImageAlt,
    lastUpdatedAt: nextLastUpdatedAt,
  });

  await ctx.runMutation(internal.shareAssets.ensureEventShareAssetQueued, {
    eventId,
    renderSignature: buildEventShareRenderSignature({
      title: event.title,
      summary: isAiAuthored
        ? (nextPerspectiveSummaries?.neutral ?? nextGlobalImpact)
        : (centerSummary ?? globalImpact),
      imageUrl: resolvedImageUrl,
      imageAlt: nextImageAlt,
      lastUpdatedAt: nextLastUpdatedAt,
      articleCount: resolvedArticleCount,
      sourceCount: resolvedSourceCount,
      sources: Array.from(
        new Map(
          articlesWithSources.map(({ source, article }) => [
            source?._id ?? article.sourceId,
            {
              name: source?.name ?? String(article.sourceId),
              logoUrl: source?.logoUrl,
            },
          ]),
        ).values(),
      ),
    }),
  });

  await syncPublicEventPreview(ctx, eventId);
}

function diagnoseEventImageState(args: {
  eventImageUrl?: string;
  articleCount: number;
  candidateCount: number;
  bestCandidateUrl?: string;
}):
  | "no_articles"
  | "no_article_images"
  | "event_missing_best_candidate"
  | "event_image_matches_candidate"
  | "event_image_stale_or_external" {
  if (args.articleCount === 0) return "no_articles";
  if (args.candidateCount === 0) return "no_article_images";
  if (!args.eventImageUrl && args.bestCandidateUrl)
    return "event_missing_best_candidate";
  if (
    args.eventImageUrl &&
    args.bestCandidateUrl &&
    args.eventImageUrl === args.bestCandidateUrl
  ) {
    return "event_image_matches_candidate";
  }
  return "event_image_stale_or_external";
}

export const refreshEventPresentationById = internalMutation({
  args: {
    eventId: v.id("events"),
  },
  handler: async (ctx, { eventId }) => {
    await refreshEventPresentation(ctx, eventId);
    return { refreshed: true };
  },
});

function findBestCandidate(
  article: {
    articleId: Id<"articles">;
    title: string;
    rssSnippet: string;
    summary: string;
    atomicFacts: string[];
    entities: string[];
    topicSlugs: string[];
    extractionQuality: "strong" | "weak";
    publishedAt: number;
    embedding: number[];
    sourceId: Id<"sources">;
  },
  candidates: ClusterCandidate[],
  settings: ClusterSettings,
): ClusterCandidate | null {
  const normalizedTitle = normalizeTitleForClustering(article.title);
  const normalizedSnippet = normalizeSnippetForClustering(article.rssSnippet);
  const normalizedSummary = normalizeSnippetForClustering(article.summary);
  const normalizedFacts = article.atomicFacts.map((fact) =>
    normalizeSnippetForClustering(fact),
  );
  const articleTitleTokens = normalizeTitleTokens(normalizedTitle);
  const articleEvidenceTokens = mergeTokenSets(
    normalizeTitleTokens(normalizedSnippet),
    normalizeTitleTokens(normalizedSummary),
  );
  const articleFactTokens = normalizeTitleTokens(normalizedFacts.join(" "));
  const articleEntitySeed = article.entities.join(" ");
  const articleEntityTokens = extractEntityTokens(
    normalizedTitle,
    normalizedSnippet,
    normalizedSummary,
    articleEntitySeed,
    normalizedFacts.join(" "),
  );
  const articleTopicSlugs = new Set(article.topicSlugs);

  let best: { candidate: ClusterCandidate; score: number } | null = null;
  let nearMiss: {
    candidate: ClusterCandidate;
    similarity: number;
    effectiveMinSimilarity: number;
    isWeakExtraction: boolean;
    sameSource: boolean;
    lexicalSupport: boolean;
    semanticSupport: boolean;
    topicSupport: boolean;
    sameSourceMatch: boolean;
  } | null = null;

  for (const candidate of candidates) {
    const timeDeltaMs = Math.abs(
      article.publishedAt - candidate.firstPublishedAt,
    );
    if (timeDeltaMs > RECENT_EVENT_WINDOW_MS) {
      continue;
    }

    const similarity = candidate.similarity ?? 0;
    if (!Number.isFinite(similarity)) continue;
    const titleOverlap = countTokenOverlap(
      articleTitleTokens,
      candidate.titleTokens,
    );
    const titleJaccard = jaccardSimilarity(
      articleTitleTokens,
      candidate.titleTokens,
    );
    const evidenceOverlap = countTokenOverlap(
      articleEvidenceTokens,
      candidate.evidenceTokens,
    );
    const evidenceJaccard = jaccardSimilarity(
      articleEvidenceTokens,
      candidate.evidenceTokens,
    );
    const factOverlap = countTokenOverlap(
      articleFactTokens,
      candidate.factTokens,
    );
    const factJaccard = jaccardSimilarity(
      articleFactTokens,
      candidate.factTokens,
    );
    const entityOverlap = countTokenOverlap(
      articleEntityTokens,
      candidate.entityTokens,
    );
    const entityJaccard = jaccardSimilarity(
      articleEntityTokens,
      candidate.entityTokens,
    );
    const topicOverlap = countTokenOverlap(
      articleTopicSlugs,
      candidate.topicSlugs,
    );
    const topicSupport = topicOverlap >= 1;
    const sameSource = candidate.sourceIds.has(article.sourceId);
    const isWeakExtraction = article.extractionQuality === "weak";
    const effectiveMinSimilarity = isWeakExtraction
      ? settings.weakExtractionMinSimilarity
      : settings.minSimilarity;
    const effectiveStrongSimilarity = isWeakExtraction
      ? settings.weakExtractionStrongSimilarity
      : settings.strongSimilarity;
    const topicMinSimilarity = topicSupport
      ? Math.max(effectiveMinSimilarity - 0.04, settings.minSimilarity)
      : effectiveMinSimilarity;
    const topicStrongSimilarity = topicSupport
      ? Math.max(effectiveStrongSimilarity - 0.02, settings.strongSimilarity)
      : effectiveStrongSimilarity;
    const bodySupport =
      (evidenceOverlap + factOverlap + entityOverlap >= 2 &&
        Math.max(evidenceJaccard, factJaccard, entityJaccard) >=
          settings.minTitleJaccard * 0.6) ||
      (factOverlap >= 2 && factJaccard >= settings.minTitleJaccard * 0.45) ||
      (entityOverlap >= 2 && entityJaccard >= settings.minTitleJaccard * 0.45);
    const lexicalSupport =
      (titleOverlap >= settings.minTitleTokenOverlap &&
        titleJaccard >= settings.minTitleJaccard) ||
      (evidenceOverlap >= settings.minTitleTokenOverlap &&
        evidenceJaccard >= settings.minTitleJaccard * 0.75) ||
      (factOverlap >= 1 && factJaccard >= settings.minTitleJaccard * 0.5) ||
      (entityOverlap >= 1 && entityJaccard >= settings.minTitleJaccard * 0.5) ||
      bodySupport;

    const semanticSupport =
      similarity >= topicMinSimilarity + 0.05 &&
      (evidenceJaccard >= settings.minTitleJaccard * 0.75 ||
        factJaccard >= settings.minTitleJaccard * 0.6 ||
        entityJaccard >= settings.minTitleJaccard * 0.6);

    const baseMatch =
      similarity >= topicStrongSimilarity ||
      (similarity >= topicMinSimilarity &&
        (lexicalSupport || semanticSupport || topicSupport));

    const sameSourceMatch = sameSource
      ? similarity >= settings.sameSourceMinSimilarity + 0.02 ||
        (similarity >= settings.sameSourceMinSimilarity &&
          (lexicalSupport || semanticSupport || topicSupport))
      : true;

    const isNearMiss =
      similarity >= effectiveMinSimilarity - 0.05 &&
      similarity < effectiveMinSimilarity;
    if (!baseMatch || !sameSourceMatch) {
      if (isNearMiss && (!nearMiss || similarity > nearMiss.similarity)) {
        nearMiss = {
          candidate,
          similarity,
          effectiveMinSimilarity,
          isWeakExtraction,
          sameSource,
          lexicalSupport,
          semanticSupport,
          topicSupport,
          sameSourceMatch,
        };
      }
      continue;
    }

    const recencyScore = 1 - timeDeltaMs / RECENT_EVENT_WINDOW_MS;
    const overlapScore =
      Math.min(
        titleOverlap + evidenceOverlap + factOverlap + entityOverlap,
        10,
      ) / 10;
    const sourceDiversityBonus = sameSource
      ? 0
      : Math.min(candidate.sourceIds.size, 5) / 100;
    const topicBonus = topicSupport ? 0.03 : 0;
    const score =
      similarity * 0.43 +
      titleJaccard * 0.12 +
      evidenceJaccard * 0.16 +
      factJaccard * 0.11 +
      entityJaccard * 0.14 +
      recencyScore * 0.04 +
      overlapScore * 0.04 +
      sourceDiversityBonus +
      topicBonus;

    if (!best || score > best.score) {
      best = { candidate, score };
    }
  }

  if (!best && nearMiss) {
    console.log(
      `[clustering] Near-miss: article=${article.articleId} candidate=${nearMiss.candidate.eventId} sim=${nearMiss.similarity.toFixed(3)} min=${nearMiss.effectiveMinSimilarity.toFixed(3)} weak=${nearMiss.isWeakExtraction} sameSource=${nearMiss.sameSource} lexical=${nearMiss.lexicalSupport} semantic=${nearMiss.semanticSupport} topic=${nearMiss.topicSupport} sameSourceMatch=${nearMiss.sameSourceMatch}`,
    );
  }

  return best?.candidate ?? null;
}

function findBatchLocalCandidate(
  article: {
    articleId: Id<"articles">;
    title: string;
    rssSnippet: string;
    summary: string;
    atomicFacts: string[];
    entities: string[];
    topicSlugs: string[];
    extractionQuality: "strong" | "weak";
    publishedAt: number;
    embedding: number[];
    sourceId: Id<"sources">;
  },
  candidates: ClusterCandidate[],
  settings: ClusterSettings,
): ClusterCandidate | null {
  const enrichedCandidates = candidates
    .filter(
      (candidate): candidate is ClusterCandidate & { embedding: number[] } =>
        candidate.embedding !== undefined,
    )
    .map((candidate) => ({
      ...candidate,
      similarity: cosineSimilarity(
        toEventEmbedding(article.embedding),
        toEventEmbedding(candidate.embedding),
      ),
    }));

  return findBestCandidate(article, enrichedCandidates, settings);
}

function findHeuristicCandidate(
  article: {
    title: string;
    rssSnippet: string;
    summary: string;
    atomicFacts: string[];
    entities: string[];
    topicSlugs: string[];
    publishedAt: number;
    sourceId: Id<"sources">;
  },
  candidates: ClusterCandidate[],
): ClusterCandidate | null {
  const titleTokens = normalizeTitleTokens(
    normalizeTitleForClustering(article.title),
  );
  const evidenceTokens = mergeTokenSets(
    normalizeTitleTokens(normalizeSnippetForClustering(article.rssSnippet)),
    normalizeTitleTokens(normalizeSnippetForClustering(article.summary)),
  );
  const factTokens = normalizeTitleTokens(article.atomicFacts.join(" "));
  const entityTokens = extractEntityTokens(
    article.title,
    article.rssSnippet,
    article.summary,
    article.entities.join(" "),
    article.atomicFacts.join(" "),
  );
  const topicTokens = new Set(article.topicSlugs);

  let best: { candidate: ClusterCandidate; score: number } | null = null;
  for (const candidate of candidates) {
    const timeDeltaMs = Math.abs(
      article.publishedAt - candidate.firstPublishedAt,
    );
    if (timeDeltaMs > RECENT_EVENT_WINDOW_MS) continue;

    const sameSourcePenalty = candidate.sourceIds.has(article.sourceId)
      ? -1.5
      : 0;
    const score =
      countTokenOverlap(titleTokens, candidate.titleTokens) * 4 +
      jaccardSimilarity(titleTokens, candidate.titleTokens) * 6 +
      countTokenOverlap(evidenceTokens, candidate.evidenceTokens) * 1.8 +
      countTokenOverlap(factTokens, candidate.factTokens) * 2 +
      countTokenOverlap(entityTokens, candidate.entityTokens) * 2.2 +
      countTokenOverlap(topicTokens, candidate.topicSlugs) * 2.5 +
      sameSourcePenalty;

    if (score < 4) continue;
    if (!best || score > best.score) {
      best = { candidate, score };
    }
  }

  return best?.candidate ?? null;
}

function shouldPublishCluster(
  articleCount: number,
  uniqueSourceCount: number,
  settings: ClusterPublishSettings,
): boolean {
  return (
    articleCount >= settings.minArticles &&
    uniqueSourceCount >= settings.minSources
  );
}

async function getTopicInferenceSettingsForQuery(
  ctx: Parameters<typeof getConfig>[0],
): Promise<TopicInferenceSettings> {
  return {
    minScore: clampNumber(
      await getConfig(
        ctx,
        "topic_inference_min_score",
        DEFAULT_TOPIC_INFERENCE_MIN_SCORE,
      ),
      DEFAULT_TOPIC_INFERENCE_MIN_SCORE,
      1,
      20,
    ),
    confidenceRatio: clampNumber(
      await getConfig(
        ctx,
        "topic_inference_confidence_ratio",
        DEFAULT_TOPIC_INFERENCE_CONFIDENCE_RATIO,
      ),
      DEFAULT_TOPIC_INFERENCE_CONFIDENCE_RATIO,
      0.1,
      1,
    ),
    maxTopics: safeInteger(
      await getConfig(
        ctx,
        "topic_inference_max_topics",
        DEFAULT_TOPIC_INFERENCE_MAX_TOPICS,
      ),
      DEFAULT_TOPIC_INFERENCE_MAX_TOPICS,
      1,
      5,
    ),
  };
}

function isWeakEventPresentation(
  event: Pick<Doc<"events">, "perspectiveSummaries" | "globalImpact">,
): boolean {
  const center = event.perspectiveSummaries?.neutral?.trim() ?? "";
  const globalImpact = event.globalImpact?.trim() ?? "";
  return center.length < 120 || globalImpact.length < 60;
}

function buildEventTopicInferenceContext(
  event: Pick<Doc<"events">, "title">,
  articles: Array<
    Pick<
      Doc<"articles">,
      "rssSnippet" | "summary" | "atomicFacts" | "publishedAt"
    >
  >,
): TopicArticleContext {
  const sortedArticles = [...articles].sort(
    (a, b) => b.publishedAt - a.publishedAt,
  );
  const topArticles = sortedArticles.slice(0, 6);

  return {
    title: normalizeTitleForClustering(event.title),
    rssSnippet: topArticles
      .map((article) => normalizeSnippetForClustering(article.rssSnippet))
      .filter(Boolean)
      .slice(0, 4)
      .join(" "),
    summary: topArticles
      .map((article) => normalizeSnippetForClustering(article.summary))
      .filter(Boolean)
      .slice(0, 4)
      .join(" "),
    atomicFacts: topArticles
      .flatMap((article) => article.atomicFacts ?? [])
      .map((fact) => normalizeSnippetForClustering(fact))
      .slice(0, 24),
  };
}

export const getEnrichedArticlesForClustering = internalQuery({
  args: { limit: v.number() },
  handler: async (ctx, { limit }) => {
    const articles = await ctx.db
      .query("articles")
      .withIndex("by_status_published", (q) => q.eq("status", "enriched"))
      .order("desc")
      .take(limit * 8);

    const prioritizedArticles = [...articles]
      .sort((a, b) => {
        const aHasImage = a.imageUrl ? 1 : 0;
        const bHasImage = b.imageUrl ? 1 : 0;
        if (aHasImage !== bHasImage) return bHasImage - aHasImage;

        return b.publishedAt - a.publishedAt;
      })
      .slice(0, limit);

    const enriched = (
      await Promise.all(
        prioritizedArticles.map(async (article) => {
          const embeddingRow = await ctx.db
            .query("articleEmbeddings")
            .withIndex("by_article_version", (q) =>
              q.eq("articleId", article._id),
            )
            .order("desc")
            .first();

          if (!embeddingRow) {
            console.warn(
              `[clustering] Missing embedding for enriched article ${article._id}; skipping`,
            );
            return null;
          }

          return {
            _id: article._id,
            title: normalizeTitleForClustering(article.title),
            rssSnippet: normalizeSnippetForClustering(article.rssSnippet),
            summary: normalizeSnippetForClustering(article.summary),
            atomicFacts: (article.atomicFacts ?? []).map((fact) =>
              normalizeSnippetForClustering(fact),
            ),
            entities: (article.entities ?? []).map((entity) =>
              normalizeSnippetForClustering(entity),
            ),
            extractionQuality: article.extractionQuality ?? "weak",
            publishedAt: article.publishedAt,
            embedding: embeddingRow.embedding,
            sourceId: article.sourceId,
          };
        }),
      )
    ).filter((article) => article !== null);

    return enriched;
  },
});

export const hasEnrichedArticlesForClustering = internalQuery({
  args: {},
  handler: async (ctx) => {
    const candidate = await ctx.db
      .query("articles")
      .withIndex("by_status_published", (q) => q.eq("status", "enriched"))
      .first();
    return Boolean(candidate);
  },
});

export const getEventsForCandidacyBackfill = internalQuery({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, { paginationOpts }) => {
    return await ctx.db.query("events").order("desc").paginate(paginationOpts);
  },
});

export const backfillEventCandidacy = internalAction({
  args: {
    cursor: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (
    ctx,
    { cursor, limit },
  ): Promise<{
    processed: number;
    continueCursor: string | null;
    isDone: boolean;
    reason?: string;
  }> => {
    const cfg = await ctx.runQuery(internal.config.getBatch, {
      keys: ["backfill_enabled"],
    });
    if (cfg.backfill_enabled !== true) {
      console.log(
        "[clustering] backfillEventCandidacy skipped: backfill_enabled is false",
      );
      return {
        processed: 0,
        continueCursor: cursor ?? null,
        isDone: true,
        reason: "backfill_disabled",
      };
    }
    const pageSize = Math.min(Math.max(Math.floor(limit ?? 100), 1), 200);
    const page: PaginationResult<Doc<"events">> = await ctx.runQuery(
      internal.clustering.getEventsForCandidacyBackfill,
      {
        paginationOpts: {
          cursor: cursor ?? null,
          numItems: pageSize,
        },
      },
    );

    for (const event of page.page) {
      const articles: Doc<"articles">[] = await ctx.runQuery(
        internal.clustering.getArticlesForEventBackfill,
        { eventId: event._id },
      );
      const sourceIds = Array.from(
        new Set(articles.map((article) => article.sourceId)),
      );
      const articleCount = articles.length;
      const sourceCount = sourceIds.length;
      const lastArticleAt =
        articles.length > 0
          ? articles.reduce(
              (max, article) => Math.max(max, article.publishedAt),
              event.firstPublishedAt,
            )
          : event.firstPublishedAt;

      if (
        event.articleCount !== articleCount ||
        event.sourceCount !== sourceCount ||
        (event.sourceIds ?? []).length !== sourceIds.length ||
        (event.lastArticleAt ?? event.firstPublishedAt) !== lastArticleAt
      ) {
        await ctx.runMutation(internal.clustering.patchEventCountsForBackfill, {
          eventId: event._id,
          articleCount,
          sourceCount,
          sourceIds,
          lastArticleAt,
        });
      }

      const topicSlugs = await ctx.runQuery(
        internal.clustering.getTopicSlugsForEventBackfill,
        { eventId: event._id },
      );

      const tokens = buildCandidacyFromArticles(
        event.title,
        articles,
        topicSlugs,
      );

      await ctx.runMutation(
        internal.clustering.upsertEventCandidacyForBackfill,
        {
          eventId: event._id,
          title: event.title,
          slug: event.slug,
          status: event.status,
          firstPublishedAt: event.firstPublishedAt,
          lastArticleAt,
          articleCount,
          sourceCount,
          sourceIds,
          titleTokens: tokens.titleTokens,
          evidenceTokens: tokens.evidenceTokens,
          factTokens: tokens.factTokens,
          entityTokens: tokens.entityTokens,
          topicSlugs: tokens.topicSlugs,
        },
      );

      await ctx.runMutation(
        internal.clustering.syncEmbeddingStatusForBackfill,
        {
          eventId: event._id,
          status: event.status,
          lastArticleAt,
          articleCount,
        },
      );

      await ctx.runMutation(
        internal.clustering.syncPublicEventPreviewForBackfill,
        {
          eventId: event._id,
        },
      );
    }

    return {
      processed: page.page.length,
      continueCursor: page.continueCursor ?? null,
      isDone: page.isDone,
    };
  },
});

export const backfillEventEmbeddingBuckets = internalAction({
  args: {
    cursor: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (
    ctx,
    { cursor, limit },
  ): Promise<{
    processed: number;
    continueCursor: string | null;
    isDone: boolean;
    reason?: string;
  }> => {
    const cfg = await ctx.runQuery(internal.config.getBatch, {
      keys: ["backfill_enabled"],
    });
    if (cfg.backfill_enabled !== true) {
      console.log(
        "[clustering] backfillEventEmbeddingBuckets skipped: backfill_enabled is false",
      );
      return {
        processed: 0,
        continueCursor: cursor ?? null,
        isDone: true,
        reason: "backfill_disabled",
      };
    }
    const pageSize = Math.min(Math.max(Math.floor(limit ?? 100), 1), 200);
    const page: PaginationResult<Doc<"events">> = await ctx.runQuery(
      internal.clustering.getEventsForCandidacyBackfill,
      {
        paginationOpts: {
          cursor: cursor ?? null,
          numItems: pageSize,
        },
      },
    );

    for (const event of page.page) {
      const fallbackArticles =
        event.articleCount === undefined || event.lastArticleAt === undefined
          ? await ctx.runQuery(
              internal.clustering.getArticlesForEventBackfill,
              {
                eventId: event._id,
              },
            )
          : null;
      const articleCount = event.articleCount ?? fallbackArticles?.length ?? 0;
      const lastArticleAt =
        event.lastArticleAt ??
        (fallbackArticles && fallbackArticles.length > 0
          ? fallbackArticles.reduce(
              (max: number, article: { publishedAt: number }) =>
                Math.max(max, article.publishedAt),
              event.firstPublishedAt,
            )
          : event.firstPublishedAt);
      await ctx.runMutation(
        internal.clustering.syncEmbeddingStatusForBackfill,
        {
          eventId: event._id,
          status: event.status,
          lastArticleAt,
          articleCount,
        },
      );
    }

    return {
      processed: page.page.length,
      continueCursor: page.continueCursor ?? null,
      isDone: page.isDone,
    };
  },
});

export const getArticlesForEventBackfill = internalQuery({
  args: { eventId: v.id("events") },
  handler: async (ctx, { eventId }) => {
    return await ctx.db
      .query("articles")
      .withIndex("by_event", (q) => q.eq("eventId", eventId))
      .collect();
  },
});

export const getTopicSlugsForEventBackfill = internalQuery({
  args: { eventId: v.id("events") },
  handler: async (ctx, { eventId }) => {
    const eventTopicRows = await ctx.db
      .query("eventTopics")
      .withIndex("by_event", (q) => q.eq("eventId", eventId))
      .collect();
    const topics = await Promise.all(
      eventTopicRows.map((row) => ctx.db.get(row.topicId)),
    );
    return topics.filter((topic) => topic !== null).map((topic) => topic.slug);
  },
});

export const patchEventCountsForBackfill = internalMutation({
  args: {
    eventId: v.id("events"),
    articleCount: v.number(),
    sourceCount: v.number(),
    sourceIds: v.array(v.id("sources")),
    lastArticleAt: v.number(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.eventId, {
      articleCount: args.articleCount,
      sourceCount: args.sourceCount,
      sourceIds: args.sourceIds,
      lastArticleAt: args.lastArticleAt,
    });
  },
});

export const upsertEventCandidacyForBackfill = internalMutation({
  args: {
    eventId: v.id("events"),
    title: v.string(),
    slug: v.string(),
    status: v.union(v.literal("processing"), v.literal("published")),
    firstPublishedAt: v.number(),
    lastArticleAt: v.number(),
    articleCount: v.number(),
    sourceCount: v.number(),
    sourceIds: v.array(v.id("sources")),
    titleTokens: v.array(v.string()),
    evidenceTokens: v.array(v.string()),
    factTokens: v.array(v.string()),
    entityTokens: v.array(v.string()),
    topicSlugs: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const [event, embeddingRow] = await Promise.all([
      ctx.db.get(args.eventId),
      ctx.db
        .query("eventEmbeddings")
        .withIndex("by_event", (q) => q.eq("eventId", args.eventId))
        .first(),
    ]);
    const existing = await ctx.db
      .query("eventCandidacy")
      .withIndex("by_event", (q) => q.eq("eventId", args.eventId))
      .first();
    const hotEmbeddingId =
      embeddingRow === null || embeddingRow === undefined
        ? undefined
        : await syncHotEventEmbedding(ctx, {
            eventId: args.eventId,
            embeddingId: embeddingRow._id,
            embedding: embeddingRow.embedding,
            version: embeddingRow.version,
            status: args.status,
            lastArticleAt: args.lastArticleAt,
            articleCount: args.articleCount,
          });

    if (existing) {
      await ctx.db.patch(existing._id, {
        ...buildCandidacySnapshotFields(args),
        embeddingId: embeddingRow?._id,
        hotEmbeddingId,
        eventCreationTime: event?._creationTime,
        title: args.title,
        slug: args.slug,
        titleTokens: args.titleTokens,
        evidenceTokens: args.evidenceTokens,
        factTokens: args.factTokens,
        entityTokens: args.entityTokens,
        topicSlugs: args.topicSlugs,
        updatedAt: Date.now(),
      });
      return;
    }

    await ctx.db.insert("eventCandidacy", {
      eventId: args.eventId,
      embeddingId: embeddingRow?._id,
      hotEmbeddingId,
      eventCreationTime: event?._creationTime,
      title: args.title,
      slug: args.slug,
      ...buildCandidacySnapshotFields(args),
      titleTokens: args.titleTokens,
      evidenceTokens: args.evidenceTokens,
      factTokens: args.factTokens,
      entityTokens: args.entityTokens,
      topicSlugs: args.topicSlugs,
      updatedAt: Date.now(),
    });
  },
});

export const syncPublicEventPreviewForBackfill = internalMutation({
  args: {
    eventId: v.id("events"),
  },
  handler: async (ctx, { eventId }) => {
    await syncPublicEventPreview(ctx, eventId);
  },
});

export const syncEmbeddingStatusForBackfill = internalMutation({
  args: {
    eventId: v.id("events"),
    status: v.union(v.literal("processing"), v.literal("published")),
    lastArticleAt: v.number(),
    articleCount: v.number(),
  },
  handler: async (ctx, { eventId, status, lastArticleAt, articleCount }) => {
    const embeddingRow = await ctx.db
      .query("eventEmbeddings")
      .withIndex("by_event", (q) => q.eq("eventId", eventId))
      .first();
    if (embeddingRow) {
      await ctx.db.patch(embeddingRow._id, {
        status,
        ...buildEventEmbeddingFilterFields({
          status,
          lastArticleAt,
          articleCount,
        }),
      });
      const hotEmbeddingId = await syncHotEventEmbedding(ctx, {
        eventId,
        embeddingId: embeddingRow._id,
        embedding: embeddingRow.embedding,
        version: embeddingRow.version,
        status,
        lastArticleAt,
        articleCount,
      });
      const candidacy = await ctx.db
        .query("eventCandidacy")
        .withIndex("by_event", (q) => q.eq("eventId", eventId))
        .first();
      if (
        candidacy &&
        (candidacy.embeddingId !== embeddingRow._id ||
          candidacy.hotEmbeddingId !== hotEmbeddingId)
      ) {
        await ctx.db.patch(candidacy._id, {
          embeddingId: embeddingRow._id,
          hotEmbeddingId,
        });
      }
    }
  },
});

export const backfillEventCandidacyEmbeddingIds = internalMutation({
  args: {
    cursor: v.optional(v.string()),
    pageSize: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const pageSize = Math.min(Math.max(Math.floor(args.pageSize ?? 100), 1), 500);
    const page = await ctx.db.query("eventCandidacy").paginate({
      cursor: args.cursor ?? null,
      numItems: pageSize,
    });

    let updated = 0;
    let missingEmbedding = 0;
    let missingEvent = 0;
    for (const candidacy of page.page) {
      if (candidacy.embeddingId && candidacy.eventCreationTime !== undefined) {
        continue;
      }
      const [event, embeddingRow] = await Promise.all([
        candidacy.eventCreationTime === undefined
          ? ctx.db.get(candidacy.eventId)
          : Promise.resolve(null),
        candidacy.embeddingId
          ? Promise.resolve(null)
          : ctx.db
              .query("eventEmbeddings")
              .withIndex("by_event", (q) => q.eq("eventId", candidacy.eventId))
              .first(),
      ]);
      if (!event && candidacy.eventCreationTime === undefined) {
        missingEvent++;
      }
      if (!embeddingRow) {
        if (!candidacy.embeddingId) missingEmbedding++;
      }
      const patch: {
        embeddingId?: Id<"eventEmbeddings">;
        hotEmbeddingId?: Id<"eventEmbeddingHot">;
        eventCreationTime?: number;
      } = {};
      if (embeddingRow) {
        patch.embeddingId = embeddingRow._id;
        patch.hotEmbeddingId = await syncHotEventEmbedding(ctx, {
          eventId: candidacy.eventId,
          embeddingId: embeddingRow._id,
          embedding: embeddingRow.embedding,
          version: embeddingRow.version,
          status: candidacy.status,
          lastArticleAt: candidacy.lastArticleAt,
          articleCount: candidacy.articleCount,
        });
      }
      if (event) patch.eventCreationTime = event._creationTime;
      if (Object.keys(patch).length > 0) {
        await ctx.db.patch(candidacy._id, patch);
        updated++;
      }
    }

    return {
      processed: page.page.length,
      updated,
      missingEmbedding,
      missingEvent,
      isDone: page.isDone,
      continueCursor: page.continueCursor,
    };
  },
});

type CandidacyWithProjection = Doc<"eventCandidacy"> & {
  title?: string;
  slug?: string;
};

function projectClusterCandidate(args: {
  title: string;
  slug: string;
  creationTime: number;
  embeddingId: Id<"eventEmbeddings">;
  embedding?: number[];
  candidacy: CandidacyWithProjection;
}): ClusterCandidateQueryResult {
  return {
    eventId: args.candidacy.eventId,
    embeddingId: args.embeddingId,
    hotEmbeddingId: args.candidacy.hotEmbeddingId,
    title: args.title,
    slug: args.slug,
    firstPublishedAt: args.candidacy.firstPublishedAt,
    lastArticleAt: args.candidacy.lastArticleAt,
    articleCount: args.candidacy.articleCount,
    sourceCount: args.candidacy.sourceCount,
    embedding: args.embedding,
    sourceIds: args.candidacy.sourceIds,
    evidenceTokens: args.candidacy.evidenceTokens,
    factTokens: args.candidacy.factTokens,
    entityTokens: args.candidacy.entityTokens,
    topicSlugs: args.candidacy.topicSlugs,
    creationTime: args.creationTime,
  };
}

export const getRecentClusterCandidates = internalQuery({
  args: {
    sinceTs: v.number(),
    limit: v.number(),
  },
  handler: async (ctx, { sinceTs, limit }) => {
    const candidacies = await Promise.all([
      ctx.db
        .query("eventCandidacy")
        .withIndex("by_status_last_article_at", (q) =>
          q.eq("status", "published").gte("lastArticleAt", sinceTs),
        )
        .order("desc")
        .take(limit * 2),
      ctx.db
        .query("eventCandidacy")
        .withIndex("by_status_last_article_at", (q) =>
          q.eq("status", "processing").gte("lastArticleAt", sinceTs),
        )
        .order("desc")
        .take(limit * 2),
    ]);

    const rows = [...candidacies[0], ...candidacies[1]]
      .sort(
        (a, b) =>
          b.lastArticleAt - a.lastArticleAt ||
          b._creationTime - a._creationTime,
      )
      .slice(0, limit);

    let missingEvents = 0;
    let missingEmbeddings = 0;

    const candidates = (
      await Promise.all(
        rows.map(async (candidacy) => {
          const projected = candidacy as CandidacyWithProjection;
          const [event, embeddingRow] = await Promise.all([
            projected.title && projected.slug
              ? Promise.resolve(null)
              : ctx.db.get(candidacy.eventId),
            ctx.db
              .query("eventEmbeddings")
              .withIndex("by_event", (q) => q.eq("eventId", candidacy.eventId))
              .first(),
          ]);

          const title = projected.title ?? event?.title;
          const slug = projected.slug ?? event?.slug;
          if (!title || !slug) {
            missingEvents++;
            return null;
          }
          if (!embeddingRow) {
            missingEmbeddings++;
            return null;
          }

          return projectClusterCandidate({
            title,
            slug,
            creationTime: event?._creationTime ?? projected.eventCreationTime ?? projected._creationTime,
            embeddingId: embeddingRow._id,
            embedding: embeddingRow.embedding,
            candidacy: projected,
          });
        }),
      )
    ).filter(
      (candidate): candidate is ClusterCandidateQueryResult =>
        candidate !== null,
    );

    if (missingEvents > 0 || missingEmbeddings > 0) {
      console.log(
        `[clustering] Candidate window skipped ${missingEvents} missing events and ${missingEmbeddings} missing embeddings`,
      );
    }

    return candidates;
  },
});

export const getChangedClusterCandidates = internalQuery({
  args: {
    sinceTs: v.number(),
    sinceCreationTime: v.optional(v.number()),
    recentSinceTs: v.number(),
    limit: v.number(),
    singletonOnly: v.optional(v.boolean()),
  },
  handler: async (
    ctx,
    { sinceTs, sinceCreationTime, recentSinceTs, limit, singletonOnly },
  ) => {
    const cursorCreationTime = sinceCreationTime ?? 0;
    const fetchStatusPage = async (status: Doc<"eventCandidacy">["status"]) => {
      const [sameTimestampRows, newerRows] = await Promise.all([
        ctx.db
          .query("eventCandidacy")
          .withIndex("by_status_updated_at", (q) =>
            q
              .eq("status", status)
              .eq("updatedAt", sinceTs)
              .gt("_creationTime", cursorCreationTime),
          )
          .order("asc")
          .take(limit),
        ctx.db
          .query("eventCandidacy")
          .withIndex("by_status_updated_at", (q) =>
            q.eq("status", status).gt("updatedAt", sinceTs),
          )
          .order("asc")
          .take(limit),
      ]);
      return [...sameTimestampRows, ...newerRows];
    };

    const candidacies = await Promise.all([
      fetchStatusPage("published"),
      fetchStatusPage("processing"),
    ]);

    const cursorRows = [...candidacies[0], ...candidacies[1]]
      .sort(
        (a, b) =>
          a.updatedAt - b.updatedAt || a._creationTime - b._creationTime,
      )
      .slice(0, limit);
    const rows = cursorRows
      .filter(
        (row) =>
          row.lastArticleAt >= recentSinceTs &&
          (!singletonOnly || row.articleCount <= 2),
      )
      .slice(0, limit);

    return { rows, cursorRows };
  },
});

export const getClusteringJobState = internalQuery({
  args: {
    jobName: v.string(),
  },
  handler: async (ctx, { jobName }) => {
    return await ctx.db
      .query("clusteringJobState")
      .withIndex("by_job_name", (q) => q.eq("jobName", jobName))
      .unique();
  },
});

function advanceChangedCandidateCursor(
  rows: Array<{ updatedAt: number; _creationTime: number }>,
  sinceTs: number,
  sinceCreationTime = 0,
) {
  return rows.reduce(
    (cursor, row) => {
      if (
        row.updatedAt > cursor.lastProcessedAt ||
        (row.updatedAt === cursor.lastProcessedAt &&
          row._creationTime > cursor.lastProcessedCreationTime)
      ) {
        return {
          lastProcessedAt: row.updatedAt,
          lastProcessedCreationTime: row._creationTime,
        };
      }
      return cursor;
    },
    {
      lastProcessedAt: sinceTs,
      lastProcessedCreationTime: sinceCreationTime,
    },
  );
}

export const upsertClusteringJobState = internalMutation({
  args: {
    jobName: v.string(),
    lastProcessedAt: v.optional(v.number()),
    lastProcessedCreationTime: v.optional(v.number()),
    lastProcessedDayBucket: v.optional(v.string()),
    lastRunAt: v.number(),
    lastRunMetricsJson: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("clusteringJobState")
      .withIndex("by_job_name", (q) => q.eq("jobName", args.jobName))
      .unique();

    const payload = {
      lastProcessedAt: args.lastProcessedAt,
      lastProcessedCreationTime: args.lastProcessedCreationTime,
      lastProcessedDayBucket: args.lastProcessedDayBucket,
      lastRunAt: args.lastRunAt,
      lastRunMetricsJson: args.lastRunMetricsJson,
      updatedAt: Date.now(),
    };

    if (existing) {
      await ctx.db.patch(existing._id, payload);
      return;
    }

    await ctx.db.insert("clusteringJobState", {
      jobName: args.jobName,
      ...payload,
    });
  },
});

export const getClusterCandidatesByEmbeddingMatches = internalQuery({
  args: {
    embeddingMatches: v.array(
      v.object({
        embeddingId: v.id("eventEmbeddings"),
        similarity: v.number(),
      }),
    ),
    includeEmbedding: v.optional(v.boolean()),
  },
  handler: async (ctx, { embeddingMatches, includeEmbedding }) => {
    const uniqueEmbeddingIds = Array.from(
      new Set(embeddingMatches.map((match) => String(match.embeddingId))),
    ) as string[];

    const candidacyRowsByEmbedding = await Promise.all(
      uniqueEmbeddingIds.map((embeddingId) =>
        ctx.db
          .query("eventCandidacy")
          .withIndex("by_embedding", (q) =>
            q.eq("embeddingId", embeddingId as Id<"eventEmbeddings">),
          )
          .first(),
      ),
    );
    const candidaciesByEmbeddingId = new Map<string, Doc<"eventCandidacy">>();
    for (const row of candidacyRowsByEmbedding) {
      if (row?.embeddingId) {
        candidaciesByEmbeddingId.set(String(row.embeddingId), row);
      }
    }

    const fallbackEmbeddingRows = await Promise.all(
      uniqueEmbeddingIds
        .filter((embeddingId) => !candidaciesByEmbeddingId.has(embeddingId))
        .map((embeddingId) => ctx.db.get(embeddingId as Id<"eventEmbeddings">)),
    );
    const fallbackCandidacyRows = await Promise.all(
      fallbackEmbeddingRows.map((embeddingRow) =>
        embeddingRow
          ? ctx.db
              .query("eventCandidacy")
              .withIndex("by_event", (q) => q.eq("eventId", embeddingRow.eventId))
              .first()
          : Promise.resolve(null),
      ),
    );
    for (let i = 0; i < fallbackEmbeddingRows.length; i++) {
      const embeddingRow = fallbackEmbeddingRows[i];
      const candidacy = fallbackCandidacyRows[i];
      if (embeddingRow && candidacy) {
        candidaciesByEmbeddingId.set(String(embeddingRow._id), candidacy);
      }
    }

    const embeddingRowsById = new Map<string, Doc<"eventEmbeddings">>();
    if (includeEmbedding) {
      const rows = await Promise.all(
        uniqueEmbeddingIds.map((embeddingId) =>
          ctx.db.get(embeddingId as Id<"eventEmbeddings">),
        ),
      );
      for (const row of rows) {
        if (row) embeddingRowsById.set(String(row._id), row);
      }
    } else {
      for (const row of fallbackEmbeddingRows) {
        if (row) embeddingRowsById.set(String(row._id), row);
      }
    }

    const fallbackEventRows = await Promise.all(
      Array.from(candidaciesByEmbeddingId.values()).map((candidacy) =>
        candidacy.title &&
        candidacy.slug &&
        candidacy.eventCreationTime !== undefined
          ? Promise.resolve(null)
          : ctx.db.get(candidacy.eventId),
      ),
    );
    const fallbackEventsById = new Map<string, Doc<"events">>();
    for (const event of fallbackEventRows) {
      if (event) fallbackEventsById.set(String(event._id), event);
    }

    const seenEventIds = new Set<string>();
    const candidates: ClusterCandidateVectorResult[] = [];
    let missingCandidacy = 0;
    let missingEvents = 0;
    let missingEmbeddings = 0;

    for (const match of embeddingMatches) {
      const embeddingKey = String(match.embeddingId);
      const candidacy = candidaciesByEmbeddingId.get(embeddingKey) as
        | CandidacyWithProjection
        | undefined;
      if (!candidacy) {
        missingCandidacy++;
        continue;
      }

      const eventKey = String(candidacy.eventId);
      if (seenEventIds.has(eventKey)) continue;
      seenEventIds.add(eventKey);

      const fallbackEvent = fallbackEventsById.get(eventKey);
      const title = candidacy.title ?? fallbackEvent?.title;
      const slug = candidacy.slug ?? fallbackEvent?.slug;
      if (!title || !slug) {
        missingEvents++;
        continue;
      }

      const embeddingRow = embeddingRowsById.get(embeddingKey);
      if (includeEmbedding && !embeddingRow) {
        missingEmbeddings++;
        continue;
      }

      candidates.push({
        ...projectClusterCandidate({
          title,
          slug,
          creationTime:
            fallbackEvent?._creationTime ??
            candidacy.eventCreationTime ??
            candidacy._creationTime,
          embeddingId: match.embeddingId,
          embedding: embeddingRow?.embedding,
          candidacy,
        }),
        similarity: match.similarity,
      });
    }

    if (missingCandidacy > 0 || missingEvents > 0 || missingEmbeddings > 0) {
      console.log(
        `[clustering] Vector candidate hydration skipped ${missingCandidacy} missing candidacy rows, ${missingEvents} missing events, and ${missingEmbeddings} missing embeddings`,
      );
    }

    return candidates;
  },
});

// Sweeper for the hot vector table. syncHotEventEmbedding only deletes a row
// when it is re-invoked for an event that has aged out of the recent window, so
// events that simply go quiet (no new articles, not archived) would keep their
// hot rows forever and bloat the "small" table. This prunes rows whose last
// sync is older than the recent window plus a buffer; if such an event becomes
// active again, the write path re-inserts it.
export const pruneHotEventEmbeddings = internalMutation({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const limit = Math.min(Math.max(Math.floor(args.limit ?? 500), 1), 2000);
    const cutoff = Date.now() - (RECENT_EVENT_WINDOW_MS + 6 * 60 * 60 * 1000);
    const stale = await ctx.db
      .query("eventEmbeddingHot")
      .withIndex("by_updated_at", (q) => q.lt("updatedAt", cutoff))
      .take(limit);
    for (const row of stale) {
      await ctx.db.delete(row._id);
    }
    return { deleted: stale.length, isDone: stale.length < limit };
  },
});

export const getClusterCandidatesByHotEmbeddingMatches = internalQuery({
  args: {
    embeddingMatches: v.array(
      v.object({
        hotEmbeddingId: v.id("eventEmbeddingHot"),
        similarity: v.number(),
      }),
    ),
  },
  handler: async (ctx, { embeddingMatches }) => {
    const uniqueHotIds = Array.from(
      new Set(embeddingMatches.map((match) => String(match.hotEmbeddingId))),
    ) as string[];
    const candidacyRows = await Promise.all(
      uniqueHotIds.map((hotEmbeddingId) =>
        ctx.db
          .query("eventCandidacy")
          .withIndex("by_hot_embedding", (q) =>
            q.eq("hotEmbeddingId", hotEmbeddingId as Id<"eventEmbeddingHot">),
          )
          .first(),
      ),
    );
    const candidaciesByHotId = new Map<string, Doc<"eventCandidacy">>();
    for (const row of candidacyRows) {
      if (row?.hotEmbeddingId && row.embeddingId) {
        candidaciesByHotId.set(String(row.hotEmbeddingId), row);
      }
    }

    const fallbackEventRows = await Promise.all(
      Array.from(candidaciesByHotId.values()).map((candidacy) =>
        candidacy.title &&
        candidacy.slug &&
        candidacy.eventCreationTime !== undefined
          ? Promise.resolve(null)
          : ctx.db.get(candidacy.eventId),
      ),
    );
    const fallbackEventsById = new Map<string, Doc<"events">>();
    for (const event of fallbackEventRows) {
      if (event) fallbackEventsById.set(String(event._id), event);
    }

    const seenEventIds = new Set<string>();
    const candidates: ClusterCandidateVectorResult[] = [];
    for (const match of embeddingMatches) {
      const candidacy = candidaciesByHotId.get(String(match.hotEmbeddingId)) as
        | CandidacyWithProjection
        | undefined;
      if (!candidacy?.embeddingId) continue;
      const eventKey = String(candidacy.eventId);
      if (seenEventIds.has(eventKey)) continue;
      seenEventIds.add(eventKey);
      const fallbackEvent = fallbackEventsById.get(eventKey);
      const title = candidacy.title ?? fallbackEvent?.title;
      const slug = candidacy.slug ?? fallbackEvent?.slug;
      if (!title || !slug) continue;
      candidates.push({
        ...projectClusterCandidate({
          title,
          slug,
          creationTime:
            fallbackEvent?._creationTime ??
            candidacy.eventCreationTime ??
            candidacy._creationTime,
          embeddingId: candidacy.embeddingId,
          embedding: undefined,
          candidacy,
        }),
        hotEmbeddingId: match.hotEmbeddingId,
        similarity: match.similarity,
      });
    }
    return candidates;
  },
});

export const getClusterCandidatesByEventIds = internalQuery({
  args: {
    eventIds: v.array(v.id("events")),
  },
  handler: async (ctx, { eventIds }) => {
    const uniqueEventIds = Array.from(
      new Set(eventIds.map((eventId) => String(eventId))),
    ) as Array<Id<"events">>;

    const rows = await Promise.all(
      uniqueEventIds.map(async (eventId) => {
        const [event, candidacy, embeddingRow] = await Promise.all([
          ctx.db.get(eventId),
          ctx.db
            .query("eventCandidacy")
            .withIndex("by_event", (q) => q.eq("eventId", eventId))
            .first(),
          ctx.db
            .query("eventEmbeddings")
            .withIndex("by_event", (q) => q.eq("eventId", eventId))
            .first(),
        ]);

        if (!event || !candidacy || !embeddingRow) return null;

        return projectClusterCandidate({
          title: (candidacy as CandidacyWithProjection).title ?? event.title,
          slug: (candidacy as CandidacyWithProjection).slug ?? event.slug,
          creationTime: event._creationTime,
          embeddingId: embeddingRow._id,
          embedding: embeddingRow.embedding,
          candidacy: candidacy as CandidacyWithProjection,
        });
      }),
    );

    return rows.filter(
      (candidate): candidate is ClusterCandidateQueryResult =>
        candidate !== null,
    );
  },
});

export const createEventFromArticle = internalMutation({
  args: {
    articleId: v.id("articles"),
    title: v.string(),
    slug: v.string(),
    publishedAt: v.number(),
    centerSummary: v.optional(v.string()),
    eventEmbedding: v.array(v.number()),
    version: v.number(),
    topicSlugs: v.array(v.string()),
    initialStatus: v.union(v.literal("processing"), v.literal("published")),
  },
  handler: async (
    ctx,
    {
      articleId,
      title,
      slug,
      publishedAt,
      centerSummary,
      eventEmbedding,
      version,
      topicSlugs,
      initialStatus,
    },
  ) => {
    const article = await ctx.db.get(articleId);
    if (!article || article.status !== "enriched") {
      return { created: false as const };
    }

    const eventId = await ctx.db.insert("events", {
      title,
      slug,
      perspectiveSummaries: centerSummary
        ? { neutral: centerSummary }
        : undefined,
      perspectiveSource: centerSummary ? "heuristic" : undefined,
      status: initialStatus,
      firstPublishedAt: publishedAt,
      lastUpdatedAt: publishedAt,
      lastArticleAt: publishedAt,
      articleCount: 1,
      sourceCount: 1,
      sourceIds: [article.sourceId],
    });
    const createdEvent = await ctx.db.get(eventId);

    const embeddingId = await ctx.db.insert("eventEmbeddings", {
      eventId,
      embedding: toEventEmbedding(eventEmbedding),
      version,
      status: initialStatus,
      ...buildEventEmbeddingFilterFields({
        status: initialStatus,
        lastArticleAt: publishedAt,
        articleCount: 1,
      }),
    });
    const hotEmbeddingId = await syncHotEventEmbedding(ctx, {
      eventId,
      embeddingId,
      embedding: toEventEmbedding(eventEmbedding),
      version,
      status: initialStatus,
      lastArticleAt: publishedAt,
      articleCount: 1,
    });

    const candidacyTokens = buildCandidacyFromArticle(
      title,
      article,
      topicSlugs,
    );
    await ctx.db.insert("eventCandidacy", {
      eventId,
      embeddingId,
      hotEmbeddingId,
      eventCreationTime: createdEvent?._creationTime ?? Date.now(),
      title,
      slug,
      ...buildCandidacySnapshotFields({
        status: initialStatus,
        firstPublishedAt: publishedAt,
        lastArticleAt: publishedAt,
        articleCount: 1,
        sourceCount: 1,
        sourceIds: [article.sourceId],
      }),
      ...candidacyTokens,
      updatedAt: Date.now(),
    });

    for (const topicSlug of topicSlugs) {
      const topic = await ctx.db
        .query("topics")
        .withIndex("by_slug", (q) => q.eq("slug", topicSlug))
        .unique();
      if (!topic) continue;

      const existingLink = await ctx.db
        .query("eventTopics")
        .withIndex("by_event_topic", (q) =>
          q.eq("eventId", eventId).eq("topicId", topic._id),
        )
        .unique();
      if (!existingLink) {
        await ctx.db.insert("eventTopics", {
          eventId,
          topicId: topic._id,
        });
      }
    }

    await ctx.db.patch(articleId, {
      eventId,
      status: "clustered",
    });

    await refreshEventClaimCoverage(ctx, eventId);
    await refreshEventPresentation(ctx, eventId);

    return {
      created: true as const,
      eventId,
      title,
      slug,
      firstPublishedAt: publishedAt,
      articleCount: 1,
      embeddingId,
      hotEmbeddingId,
      embedding: eventEmbedding,
      status: initialStatus,
    };
  },
});

export const attachArticleToEvent = internalMutation({
  args: {
    articleId: v.id("articles"),
    eventId: v.id("events"),
    publishedAt: v.number(),
    eventEmbedding: v.array(v.number()),
    version: v.number(),
    topicSlugs: v.array(v.string()),
  },
  handler: async (
    ctx,
    { articleId, eventId, publishedAt, eventEmbedding, version, topicSlugs },
  ) => {
    const article = await ctx.db.get(articleId);
    const event = await ctx.db.get(eventId);

    if (!article || !event || article.status !== "enriched") {
      return { updated: false as const };
    }

    let fallbackArticles: Doc<"articles">[] | null = null;
    let currentCount = event.articleCount;
    let currentSourceIds: Set<Id<"sources">> | null = event.sourceIds
      ? new Set(event.sourceIds)
      : null;

    if (currentCount === undefined || !currentSourceIds) {
      console.log(
        `[clustering] Falling back to article scan while attaching event ${String(eventId)} because counters/sourceIds are missing`,
      );
      fallbackArticles = await ctx.db
        .query("articles")
        .withIndex("by_event", (q) => q.eq("eventId", eventId))
        .collect();
      currentCount = fallbackArticles.length;
      currentSourceIds = new Set(
        fallbackArticles.map((existingArticle) => existingArticle.sourceId),
      );
    }

    await ctx.db.patch(articleId, {
      eventId,
      status: "clustered",
    });

    const existingEmbeddingRow = await ctx.db
      .query("eventEmbeddings")
      .withIndex("by_event", (q) => q.eq("eventId", eventId))
      .first();

    const nextEmbedding =
      existingEmbeddingRow && currentCount > 0
        ? appendArticleEmbeddingToEventMean(
            existingEmbeddingRow.embedding,
            currentCount,
            eventEmbedding,
          )
        : toEventEmbedding(eventEmbedding);

    const nextFirstPublishedAt = Math.min(event.firstPublishedAt, publishedAt);
    const nextLastUpdatedAt = Math.max(
      event.lastUpdatedAt ?? event.firstPublishedAt,
      publishedAt,
    );
    const nextSourceIds = new Set(currentSourceIds);
    nextSourceIds.add(article.sourceId);
    const nextSourceCount = nextSourceIds.size;
    const nextArticleCount = (currentCount ?? 0) + 1;
    const nextLastArticleAt = Math.max(
      event.lastArticleAt ?? event.firstPublishedAt,
      publishedAt,
    );
    // Publishing is gated on a successful AI summary, not on article/source
    // counts: applyEventSummaryResult flips status -> "published" once an event
    // has neutral/reformist/suveranist perspectives + globalImpact. Clustering
    // therefore preserves the event's current status here (a merge that keeps an
    // already-published event is the only path that carries "published"
    // forward). A newly-qualified event stays "processing" until the immediate
    // post-batch summarization trigger produces its summary.
    const nextStatus = event.status;
    if (
      nextFirstPublishedAt !== event.firstPublishedAt ||
      nextLastUpdatedAt !== (event.lastUpdatedAt ?? event.firstPublishedAt) ||
      nextStatus !== event.status ||
      nextArticleCount !== event.articleCount ||
      nextSourceCount !== event.sourceCount ||
      nextLastArticleAt !== (event.lastArticleAt ?? event.firstPublishedAt)
    ) {
      await ctx.db.patch(eventId, {
        firstPublishedAt: nextFirstPublishedAt,
        lastUpdatedAt: nextLastUpdatedAt,
        status: nextStatus,
        lastArticleAt: nextLastArticleAt,
        articleCount: nextArticleCount,
        sourceCount: nextSourceCount,
        sourceIds: Array.from(nextSourceIds),
      });
    }

    const embeddingId = existingEmbeddingRow
      ? existingEmbeddingRow._id
      : await ctx.db.insert("eventEmbeddings", {
          eventId,
          embedding: nextEmbedding,
          version,
          status: nextStatus,
          ...buildEventEmbeddingFilterFields({
            status: nextStatus,
            lastArticleAt: nextLastArticleAt,
            articleCount: nextArticleCount,
          }),
        });

    if (existingEmbeddingRow) {
      await ctx.db.patch(existingEmbeddingRow._id, {
        embedding: nextEmbedding,
        version,
        status: nextStatus,
        ...buildEventEmbeddingFilterFields({
          status: nextStatus,
          lastArticleAt: nextLastArticleAt,
          articleCount: nextArticleCount,
        }),
      });
    }
    const hotEmbeddingId = await syncHotEventEmbedding(ctx, {
      eventId,
      embeddingId,
      embedding: nextEmbedding,
      version,
      status: nextStatus,
      lastArticleAt: nextLastArticleAt,
      articleCount: nextArticleCount,
    });

    for (const topicSlug of topicSlugs) {
      const topic = await ctx.db
        .query("topics")
        .withIndex("by_slug", (q) => q.eq("slug", topicSlug))
        .unique();
      if (!topic) continue;

      const existingLink = await ctx.db
        .query("eventTopics")
        .withIndex("by_event_topic", (q) =>
          q.eq("eventId", eventId).eq("topicId", topic._id),
        )
        .unique();
      if (!existingLink) {
        await ctx.db.insert("eventTopics", {
          eventId,
          topicId: topic._id,
        });
      }
    }

    const candidacy = await ctx.db
      .query("eventCandidacy")
      .withIndex("by_event", (q) => q.eq("eventId", eventId))
      .first();
    const evidenceTokens = buildArticleEvidenceTokens(article);
    const factTokens = buildArticleFactTokens(article);
    const entityTokens = buildArticleEntityTokens(event.title, article);
    const mergedTopicSlugs = mergeTopicSlugs(candidacy?.topicSlugs, topicSlugs);

    if (candidacy) {
      await ctx.db.patch(candidacy._id, {
        ...buildCandidacySnapshotFields({
          status: nextStatus,
          firstPublishedAt: nextFirstPublishedAt,
          lastArticleAt: nextLastArticleAt,
          articleCount: nextArticleCount,
          sourceCount: nextSourceCount,
          sourceIds: Array.from(nextSourceIds),
        }),
        embeddingId,
        hotEmbeddingId,
        eventCreationTime: event._creationTime,
        title: event.title,
        slug: event.slug,
        titleTokens:
          candidacy.titleTokens.length > 0
            ? candidacy.titleTokens
            : [
                ...normalizeTitleTokens(
                  normalizeTitleForClustering(event.title),
                ),
              ],
        evidenceTokens: mergeAndCapTokenArray(
          candidacy.evidenceTokens,
          evidenceTokens,
        ),
        factTokens: mergeAndCapTokenArray(candidacy.factTokens, factTokens),
        entityTokens: mergeAndCapTokenArray(
          candidacy.entityTokens,
          entityTokens,
        ),
        topicSlugs: mergedTopicSlugs,
        updatedAt: Date.now(),
      });
    } else {
      const tokens = buildCandidacyFromArticle(
        event.title,
        article,
        mergedTopicSlugs,
      );
      await ctx.db.insert("eventCandidacy", {
        eventId,
        embeddingId,
        hotEmbeddingId,
        eventCreationTime: event._creationTime,
        title: event.title,
        slug: event.slug,
        ...buildCandidacySnapshotFields({
          status: nextStatus,
          firstPublishedAt: nextFirstPublishedAt,
          lastArticleAt: nextLastArticleAt,
          articleCount: nextArticleCount,
          sourceCount: nextSourceCount,
          sourceIds: Array.from(nextSourceIds),
        }),
        ...tokens,
        updatedAt: Date.now(),
      });
    }

    await refreshEventClaimCoverage(ctx, eventId);
    await refreshEventPresentation(ctx, eventId);

    return {
      updated: true as const,
      eventId,
      title: event.title,
      slug: event.slug,
      firstPublishedAt: nextFirstPublishedAt,
      articleCount: nextArticleCount,
      embeddingId,
      hotEmbeddingId,
      embedding: nextEmbedding,
      status: nextStatus,
    };
  },
});

export const getRecentClusteredEventsForAdmin = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit }) => {
    await requireAdminUser(ctx);

    const pageSize = Math.min(Math.max(Math.floor(limit ?? 20), 1), 100);
    const events = await ctx.db
      .query("events")
      .withIndex("by_status_recency", (q) => q.eq("status", "published"))
      .order("desc")
      .take(pageSize);

    return await Promise.all(
      events.map(async (event) => {
        const articles = await ctx.db
          .query("articles")
          .withIndex("by_event", (q) => q.eq("eventId", event._id))
          .collect();

        const eventTopicRows = await ctx.db
          .query("eventTopics")
          .withIndex("by_event", (q) => q.eq("eventId", event._id))
          .collect();
        const topics = (
          await Promise.all(
            eventTopicRows.map((row) => ctx.db.get(row.topicId)),
          )
        )
          .filter((topic) => topic !== null)
          .map((topic) => ({
            _id: topic._id,
            slug: topic.slug,
            displayName: topic.displayName,
          }));

        const articleEmbeddings = await Promise.all(
          articles.map((article) =>
            ctx.db
              .query("articleEmbeddings")
              .withIndex("by_article_version", (q) =>
                q.eq("articleId", article._id),
              )
              .order("desc")
              .first(),
          ),
        );

        return {
          ...event,
          topics,
          articleCount: articles.length,
          articles: articles.map((article, index) => ({
            _id: article._id,
            title: article.title,
            rssSnippet: article.rssSnippet,
            publishedAt: article.publishedAt,
            status: article.status,
            embeddingDimensions:
              articleEmbeddings[index]?.embedding.length ?? 0,
          })),
        };
      }),
    );
  },
});

export const getRecentTopicInferenceDiagnosticsForAdmin = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit }) => {
    await requireAdminUser(ctx);

    const pageSize = Math.min(Math.max(Math.floor(limit ?? 20), 1), 50);
    const [topicRows, settings] = await Promise.all([
      ctx.db.query("topics").collect(),
      getTopicInferenceSettingsForQuery(ctx),
    ]);
    const topicsForInference = topicRows.filter((topic) =>
      TOPIC_CATALOG_SLUGS.has(topic.slug),
    );
    const topicBySlug = new Map(
      topicsForInference.map((topic) => [topic.slug, topic]),
    );

    const events = await ctx.db
      .query("events")
      .withIndex("by_status_recency", (q) => q.eq("status", "published"))
      .order("desc")
      .take(pageSize);

    return await Promise.all(
      events.map(async (event) => {
        const articles = await ctx.db
          .query("articles")
          .withIndex("by_event", (q) => q.eq("eventId", event._id))
          .collect();

        const eventTopicRows = await ctx.db
          .query("eventTopics")
          .withIndex("by_event", (q) => q.eq("eventId", event._id))
          .collect();
        const attachedTopics = (
          await Promise.all(
            eventTopicRows.map((row) => ctx.db.get(row.topicId)),
          )
        )
          .filter((topic) => topic !== null)
          .map((topic) => ({
            _id: topic._id,
            slug: topic.slug,
            displayName: topic.displayName,
          }));

        const context = buildEventTopicInferenceContext(event, articles);
        const rankedCandidates = evaluateTopicInference(
          context,
          topicsForInference,
          settings,
        );
        const inferredSlugs = inferTopicSlugs(
          context,
          topicsForInference,
          settings,
        );

        return {
          eventId: event._id,
          eventTitle: event.title,
          eventSlug: event.slug,
          firstPublishedAt: event.firstPublishedAt,
          articleCount: articles.length,
          settings,
          inferenceInput: {
            title: context.title,
            rssSnippet: summarizeText(context.rssSnippet, 240) ?? "",
            summary: summarizeText(context.summary, 240) ?? "",
            atomicFacts: context.atomicFacts.slice(0, 8),
          },
          attachedTopics,
          inferredTopics: inferredSlugs.map((slug) => {
            const topic = topicBySlug.get(slug);
            return {
              slug,
              displayName: topic?.displayName ?? slug,
            };
          }),
          topCandidates: rankedCandidates.slice(0, 8).map((candidate) => ({
            slug: candidate.slug,
            displayName:
              topicBySlug.get(candidate.slug)?.displayName ?? candidate.slug,
            score: Number(candidate.score.toFixed(2)),
            signalCount: candidate.signalCount,
            breakdown: {
              titlePhraseHits: candidate.titlePhraseHits,
              summaryPhraseHits: candidate.summaryPhraseHits,
              snippetPhraseHits: candidate.snippetPhraseHits,
              factPhraseHits: candidate.factPhraseHits,
              titleKeywordHits: candidate.titleKeywordHits,
              summaryKeywordHits: candidate.summaryKeywordHits,
              snippetKeywordHits: candidate.snippetKeywordHits,
              factKeywordHits: candidate.factKeywordHits,
              displayNameCoverage: candidate.displayNameCoverage,
              fullDisplayNameCoverage: candidate.fullDisplayNameCoverage,
              excludeHits: candidate.excludeHits,
            },
          })),
          articles: articles
            .sort((a, b) => b.publishedAt - a.publishedAt)
            .slice(0, 6)
            .map((article) => ({
              _id: article._id,
              title: article.title,
              summary: summarizeText(article.summary, 180),
              rssSnippet: summarizeText(article.rssSnippet, 180),
              atomicFacts: article.atomicFacts?.slice(0, 4) ?? [],
              publishedAt: article.publishedAt,
            })),
        };
      }),
    );
  },
});

export const backfillEventTopicBatch = internalMutation({
  args: {
    limit: v.number(),
    cursor: v.optional(v.string()),
  },
  handler: async (ctx, { limit, cursor }) => {
    const pageSize = Math.min(Math.max(Math.floor(limit), 1), 200);
    const page = await ctx.db
      .query("events")
      .withIndex("by_status_recency", (q) => q.eq("status", "published"))
      .order("desc")
      .paginate({
        cursor: cursor ?? null,
        numItems: pageSize,
      });
    const events = page.page;

    const topicsForInference = (await ctx.db.query("topics").collect()).filter(
      (topic) => TOPIC_CATALOG_SLUGS.has(topic.slug),
    );
    const topicBySlug = new Map(
      topicsForInference.map((topic) => [topic.slug, topic]),
    );
    const settings = await getTopicInferenceSettingsForQuery(ctx);

    let updatedEvents = 0;
    let insertedLinks = 0;
    let removedLinks = 0;
    let updatedCandidacyRows = 0;

    for (const event of events) {
      const articles = await ctx.db
        .query("articles")
        .withIndex("by_event", (q) => q.eq("eventId", event._id))
        .collect();
      const inferredSlugs = inferTopicSlugs(
        buildEventTopicInferenceContext(event, articles),
        topicsForInference,
        settings,
      );
      const inferredSlugSet = new Set(inferredSlugs);
      const inferredTopicIds = new Set(
        inferredSlugs
          .map((slug) => topicBySlug.get(slug)?._id)
          .filter((topicId): topicId is Id<"topics"> => topicId !== undefined)
          .map((topicId) => String(topicId)),
      );

      const existingRows = await ctx.db
        .query("eventTopics")
        .withIndex("by_event", (q) => q.eq("eventId", event._id))
        .collect();
      const existingTopicIds = new Set<string>();

      for (const row of existingRows) {
        const topic = await ctx.db.get(row.topicId);
        const shouldKeep =
          topic !== null &&
          inferredSlugSet.has(topic.slug) &&
          inferredTopicIds.has(String(topic._id));
        if (shouldKeep) {
          existingTopicIds.add(String(row.topicId));
          continue;
        }
        await ctx.db.delete(row._id);
        removedLinks++;
      }

      for (const slug of inferredSlugs) {
        const topic = topicBySlug.get(slug);
        if (!topic || existingTopicIds.has(String(topic._id))) continue;
        await ctx.db.insert("eventTopics", {
          eventId: event._id,
          topicId: topic._id,
        });
        insertedLinks++;
      }

      const candidacy = await ctx.db
        .query("eventCandidacy")
        .withIndex("by_event", (q) => q.eq("eventId", event._id))
        .first();
      if (
        candidacy &&
        (candidacy.topicSlugs.length !== inferredSlugs.length ||
          candidacy.topicSlugs.some((slug, index) => slug !== inferredSlugs[index]))
      ) {
        await ctx.db.patch(candidacy._id, {
          topicSlugs: inferredSlugs,
          updatedAt: Date.now(),
        });
        updatedCandidacyRows++;
      }

      await syncPublicEventPreview(ctx, event._id);
      updatedEvents++;
    }

    return {
      processed: events.length,
      updatedEvents,
      insertedLinks,
      removedLinks,
      updatedCandidacyRows,
      continueCursor: page.continueCursor ?? null,
      isDone: page.isDone,
    };
  },
});

export const requireTopicBackfillAdmin = internalQuery({
  args: {},
  handler: async (ctx) => {
    await requireAdminUser(ctx);
    return { ok: true };
  },
});

type BackfillEventTopicsResult = {
  syncResult: {
    created: number;
    updated: number;
    deleted: number;
    removedEventTopicLinks: number;
    removedFollowedTopicRefs: number;
    totalCatalogTopics: number;
  };
  pages: number;
  processed: number;
  insertedLinks: number;
  removedLinks: number;
  updatedCandidacyRows: number;
  continueCursor: string | null;
  isDone: boolean;
};

export const backfillEventTopics = action({
  args: {
    pageSize: v.optional(v.number()),
    maxPages: v.optional(v.number()),
    cursor: v.optional(v.string()),
  },
  handler: async (
    ctx,
    { pageSize, maxPages, cursor: initialCursor },
  ): Promise<BackfillEventTopicsResult> => {
    await ctx.runQuery(internal.clustering.requireTopicBackfillAdmin, {});
    let syncResult: BackfillEventTopicsResult["syncResult"] =
      await ctx.runMutation(internal.topics.syncTopicCatalog, {});
    const limit = Math.min(Math.max(Math.floor(pageSize ?? 100), 1), 200);
    const pageLimit = Math.min(Math.max(Math.floor(maxPages ?? 20), 1), 100);
    let cursor = initialCursor ?? null;
    let pages = 0;
    let processed = 0;
    let insertedLinks = 0;
    let removedLinks = 0;
    let updatedCandidacyRows = 0;
    let isDone = false;

    while (pages < pageLimit && !isDone) {
      const result: {
        processed: number;
        insertedLinks: number;
        removedLinks: number;
        updatedCandidacyRows: number;
        continueCursor: string | null;
        isDone: boolean;
      } = await ctx.runMutation(internal.clustering.backfillEventTopicBatch, {
        limit,
        cursor: cursor ?? undefined,
      });
      pages++;
      processed += result.processed;
      insertedLinks += result.insertedLinks;
      removedLinks += result.removedLinks;
      updatedCandidacyRows += result.updatedCandidacyRows;
      isDone = result.isDone;
      cursor = result.continueCursor;
    }

    if (isDone) {
      syncResult = await ctx.runMutation(internal.topics.syncTopicCatalog, {
        pruneStale: true,
      });
      await ctx.runMutation(internal.events.rebuildPublicFeedSnapshotsJob, {});
    }

    return {
      syncResult,
      pages,
      processed,
      insertedLinks,
      removedLinks,
      updatedCandidacyRows,
      continueCursor: isDone ? null : cursor,
      isDone,
    };
  },
});

export const getRecentEventImageDiagnosticsForAdmin = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit }) => {
    await requireAdminUser(ctx);

    const pageSize = Math.min(Math.max(Math.floor(limit ?? 20), 1), 50);
    const events = await ctx.db
      .query("events")
      .withIndex("by_status_recency", (q) => q.eq("status", "published"))
      .order("desc")
      .take(pageSize);

    const diagnostics = await Promise.all(
      events.map(async (event) => {
        const articles = await ctx.db
          .query("articles")
          .withIndex("by_event", (q) => q.eq("eventId", event._id))
          .collect();
        const articlesWithSources = await Promise.all(
          articles.map(async (article) => ({
            article,
            source: await ctx.db.get(article.sourceId),
          })),
        );
        const eventTitleTokens = normalizeTitleTokens(event.title);
        const bestCandidate = pickBestEventImageCandidate(
          articlesWithSources,
          eventTitleTokens,
        );
        const articlesWithImages = articlesWithSources.filter(({ article }) =>
          Boolean(article.imageUrl),
        );
        const diagnosis = diagnoseEventImageState({
          eventImageUrl: event.imageUrl,
          articleCount: articlesWithSources.length,
          candidateCount: articlesWithImages.length,
          bestCandidateUrl: bestCandidate?.article.imageUrl,
        });

        return {
          eventId: event._id,
          eventTitle: event.title,
          eventSlug: event.slug,
          eventImageUrl: event.imageUrl,
          eventImageWidth: event.imageWidth,
          eventImageHeight: event.imageHeight,
          eventImageAlt: event.imageAlt,
          articleCount: articlesWithSources.length,
          articleImageCount: articlesWithImages.length,
          diagnosis,
          bestCandidate: bestCandidate
            ? {
                articleId: bestCandidate.article._id,
                title: bestCandidate.article.title,
                sourceName:
                  bestCandidate.source?.name ??
                  String(bestCandidate.article.sourceId),
                imageUrl: bestCandidate.article.imageUrl,
                imageWidth: bestCandidate.article.imageWidth,
                imageHeight: bestCandidate.article.imageHeight,
                imageAlt:
                  bestCandidate.article.imageAlt ?? bestCandidate.article.title,
                imageSource: bestCandidate.article.imageSource,
                extractionQuality:
                  bestCandidate.article.extractionQuality ?? "weak",
                score: Number(
                  articleImageScore(
                    bestCandidate.article,
                    bestCandidate.source,
                    eventTitleTokens,
                  ).toFixed(2),
                ),
              }
            : null,
          articles: articlesWithSources
            .sort((a, b) => b.article.publishedAt - a.article.publishedAt)
            .slice(0, 8)
            .map(({ article, source }) => ({
              articleId: article._id,
              title: article.title,
              sourceName: source?.name ?? "Unknown",
              publishedAt: article.publishedAt,
              imageUrl: article.imageUrl,
              imageWidth: article.imageWidth,
              imageHeight: article.imageHeight,
              imageAlt: article.imageAlt,
              imageSource: article.imageSource,
              extractionQuality: article.extractionQuality ?? "weak",
            })),
        };
      }),
    );

    const summary = diagnostics.reduce(
      (acc, item) => {
        acc.totalEvents++;
        if (item.eventImageUrl) acc.eventsWithImage++;
        if (item.articleImageCount > 0) acc.eventsWithArticleCandidates++;
        acc.byDiagnosis[item.diagnosis] =
          (acc.byDiagnosis[item.diagnosis] ?? 0) + 1;
        return acc;
      },
      {
        totalEvents: 0,
        eventsWithImage: 0,
        eventsWithArticleCandidates: 0,
        byDiagnosis: {} as Record<string, number>,
      },
    );

    return {
      summary,
      events: diagnostics,
    };
  },
});

export const getRecentArticleImageCoverageBySourceForAdmin = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit }) => {
    await requireAdminUser(ctx);

    const articleLimit = Math.max(50, Math.min(limit ?? 250, 1000));
    const recentArticles = await ctx.db
      .query("articles")
      .withIndex("by_published")
      .order("desc")
      .take(articleLimit);

    const rows = await Promise.all(
      recentArticles.map(async (article) => ({
        article,
        source: await ctx.db.get(article.sourceId),
      })),
    );

    const bySource = new Map<
      string,
      {
        sourceId: Id<"sources">;
        sourceName: string;
        domain: string;
        totalArticles: number;
        withImage: number;
        strongExtraction: number;
        weakExtraction: number;
        imageSources: Record<string, number>;
        sampleMissingTitles: string[];
        sampleImageTitles: string[];
      }
    >();

    for (const row of rows) {
      if (!row.source) continue;
      const key = String(row.source._id);
      const existing = bySource.get(key) ?? {
        sourceId: row.source._id,
        sourceName: row.source.name,
        domain: row.source.domain,
        totalArticles: 0,
        withImage: 0,
        strongExtraction: 0,
        weakExtraction: 0,
        imageSources: {},
        sampleMissingTitles: [],
        sampleImageTitles: [],
      };

      existing.totalArticles++;
      if ((row.article.extractionQuality ?? "weak") === "strong") {
        existing.strongExtraction++;
      } else {
        existing.weakExtraction++;
      }

      if (row.article.imageUrl) {
        existing.withImage++;
        const imageSource = row.article.imageSource ?? "unknown";
        existing.imageSources[imageSource] =
          (existing.imageSources[imageSource] ?? 0) + 1;
        if (existing.sampleImageTitles.length < 3) {
          existing.sampleImageTitles.push(row.article.title);
        }
      } else if (existing.sampleMissingTitles.length < 3) {
        existing.sampleMissingTitles.push(row.article.title);
      }

      bySource.set(key, existing);
    }

    return Array.from(bySource.values())
      .map((row) => ({
        ...row,
        imageCoverage:
          row.totalArticles > 0
            ? Number((row.withImage / row.totalArticles).toFixed(3))
            : 0,
      }))
      .sort(
        (a, b) =>
          b.totalArticles - a.totalArticles ||
          a.imageCoverage - b.imageCoverage,
      );
  },
});

export const getRecentImageArticlesWithEventStateInternal = internalQuery({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const pageSize = Math.min(Math.max(Math.floor(args.limit ?? 50), 1), 200);
    const recentArticles = await ctx.db
      .query("articles")
      .withIndex("by_published")
      .order("desc")
      .take(pageSize * 8);

    const rows = await Promise.all(
      recentArticles
        .filter((article) => Boolean(article.imageUrl))
        .slice(0, pageSize)
        .map(async (article) => {
          const source = await ctx.db.get(article.sourceId);
          const event = article.eventId
            ? await ctx.db.get(article.eventId)
            : null;
          return {
            articleId: article._id,
            articleTitle: article.title,
            articlePublishedAt: article.publishedAt,
            articleImageUrl: article.imageUrl,
            articleImageSource: article.imageSource,
            extractionQuality: article.extractionQuality ?? "weak",
            sourceName: source?.name ?? "Unknown",
            sourceDomain: source?.domain ?? null,
            eventId: article.eventId ?? null,
            eventTitle: event?.title ?? null,
            eventStatus: event?.status ?? null,
            eventImageUrl: event?.imageUrl ?? null,
          };
        }),
    );

    const summary = rows.reduce(
      (acc, row) => {
        acc.totalImageArticles++;
        if (row.eventId) acc.withEvent++;
        if (row.eventStatus === "published") acc.withPublishedEvent++;
        if (row.eventImageUrl) acc.withEventImage++;
        if (row.eventId && !row.eventImageUrl) acc.withMissingEventImage++;
        return acc;
      },
      {
        totalImageArticles: 0,
        withEvent: 0,
        withPublishedEvent: 0,
        withEventImage: 0,
        withMissingEventImage: 0,
      },
    );

    return {
      summary,
      rows,
    };
  },
});

export const getRecentEventImageDiagnosticsInternal = internalQuery({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const pageSize = Math.min(Math.max(Math.floor(args.limit ?? 20), 1), 50);
    const events = await ctx.db
      .query("events")
      .withIndex("by_status_recency", (q) => q.eq("status", "published"))
      .order("desc")
      .take(pageSize);

    const diagnostics = await Promise.all(
      events.map(async (event) => {
        const articles = await ctx.db
          .query("articles")
          .withIndex("by_event", (q) => q.eq("eventId", event._id))
          .collect();
        const articlesWithSources = await Promise.all(
          articles.map(async (article) => ({
            article,
            source: await ctx.db.get(article.sourceId),
          })),
        );
        const eventTitleTokens = normalizeTitleTokens(event.title);
        const bestCandidate = pickBestEventImageCandidate(
          articlesWithSources,
          eventTitleTokens,
        );
        const articlesWithImages = articlesWithSources.filter(({ article }) =>
          Boolean(article.imageUrl),
        );
        const diagnosis = diagnoseEventImageState({
          eventImageUrl: event.imageUrl,
          articleCount: articlesWithSources.length,
          candidateCount: articlesWithImages.length,
          bestCandidateUrl: bestCandidate?.article.imageUrl,
        });

        return {
          eventId: event._id,
          eventTitle: event.title,
          eventSlug: event.slug,
          eventImageUrl: event.imageUrl,
          articleCount: articlesWithSources.length,
          articleImageCount: articlesWithImages.length,
          diagnosis,
          bestCandidate: bestCandidate
            ? {
                articleId: bestCandidate.article._id,
                title: bestCandidate.article.title,
                sourceName:
                  bestCandidate.source?.name ??
                  String(bestCandidate.article.sourceId),
                imageUrl: bestCandidate.article.imageUrl,
                imageSource: bestCandidate.article.imageSource,
                extractionQuality:
                  bestCandidate.article.extractionQuality ?? "weak",
                score: Number(
                  articleImageScore(
                    bestCandidate.article,
                    bestCandidate.source,
                    eventTitleTokens,
                  ).toFixed(2),
                ),
              }
            : null,
          articles: articlesWithSources
            .sort((a, b) => b.article.publishedAt - a.article.publishedAt)
            .slice(0, 8)
            .map(({ article, source }) => ({
              articleId: article._id,
              title: article.title,
              sourceName: source?.name ?? "Unknown",
              imageUrl: article.imageUrl,
              imageSource: article.imageSource,
              extractionQuality: article.extractionQuality ?? "weak",
            })),
        };
      }),
    );

    const summary = diagnostics.reduce(
      (acc, item) => {
        acc.totalEvents++;
        if (item.eventImageUrl) acc.eventsWithImage++;
        if (item.articleImageCount > 0) acc.eventsWithArticleCandidates++;
        acc.byDiagnosis[item.diagnosis] =
          (acc.byDiagnosis[item.diagnosis] ?? 0) + 1;
        return acc;
      },
      {
        totalEvents: 0,
        eventsWithImage: 0,
        eventsWithArticleCandidates: 0,
        byDiagnosis: {} as Record<string, number>,
      },
    );

    return {
      summary,
      events: diagnostics,
    };
  },
});

export const getImageBearingArticlesForEventRefresh = internalQuery({
  args: {
    limit: v.number(),
    onlyMissingEventImage: v.boolean(),
  },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("articles")
      .withIndex("by_published")
      .order("desc")
      .take(args.limit * 10);

    const candidates = [];
    for (const article of rows) {
      if (!article.imageUrl || !article.eventId) continue;
      const event = await ctx.db.get(article.eventId);
      if (!event) continue;
      if (args.onlyMissingEventImage && event.imageUrl) continue;
      candidates.push({
        articleId: article._id,
        eventId: article.eventId,
        eventStatus: event.status,
        articlePublishedAt: article.publishedAt,
      });
      if (candidates.length >= args.limit) break;
    }

    return candidates;
  },
});

export const getRecentArticleImageCoverageBySourceInternal = internalQuery({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const articleLimit = Math.max(50, Math.min(args.limit ?? 250, 1000));
    const recentArticles = await ctx.db
      .query("articles")
      .withIndex("by_published")
      .order("desc")
      .take(articleLimit);

    const rows = await Promise.all(
      recentArticles.map(async (article) => ({
        article,
        source: await ctx.db.get(article.sourceId),
      })),
    );

    const bySource = new Map<
      string,
      {
        sourceId: Id<"sources">;
        sourceName: string;
        domain: string;
        totalArticles: number;
        withImage: number;
        strongExtraction: number;
        weakExtraction: number;
        imageSources: Record<string, number>;
        sampleMissingTitles: string[];
        sampleImageTitles: string[];
      }
    >();

    for (const row of rows) {
      if (!row.source) continue;
      const key = String(row.source._id);
      const existing = bySource.get(key) ?? {
        sourceId: row.source._id,
        sourceName: row.source.name,
        domain: row.source.domain,
        totalArticles: 0,
        withImage: 0,
        strongExtraction: 0,
        weakExtraction: 0,
        imageSources: {},
        sampleMissingTitles: [],
        sampleImageTitles: [],
      };

      existing.totalArticles++;
      if ((row.article.extractionQuality ?? "weak") === "strong") {
        existing.strongExtraction++;
      } else {
        existing.weakExtraction++;
      }

      if (row.article.imageUrl) {
        existing.withImage++;
        const imageSource = row.article.imageSource ?? "unknown";
        existing.imageSources[imageSource] =
          (existing.imageSources[imageSource] ?? 0) + 1;
        if (existing.sampleImageTitles.length < 3) {
          existing.sampleImageTitles.push(row.article.title);
        }
      } else if (existing.sampleMissingTitles.length < 3) {
        existing.sampleMissingTitles.push(row.article.title);
      }

      bySource.set(key, existing);
    }

    return Array.from(bySource.values())
      .map((row) => ({
        ...row,
        imageCoverage:
          row.totalArticles > 0
            ? Number((row.withImage / row.totalArticles).toFixed(3))
            : 0,
      }))
      .sort(
        (a, b) =>
          b.totalArticles - a.totalArticles ||
          a.imageCoverage - b.imageCoverage,
      );
  },
});

export const getRecentClusterPairDiagnosticsForAdmin = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit }) => {
    await requireAdminUser(ctx);

    const articleLimit = Math.max(8, Math.min(limit ?? 20, 40));
    const recentArticles = await ctx.db
      .query("articles")
      .withIndex("by_published")
      .order("desc")
      .take(articleLimit * 3);

    const candidateArticles = recentArticles
      .filter(
        (article) =>
          article.status === "enriched" || article.status === "clustered",
      )
      .slice(0, articleLimit);

    const enriched = (
      await Promise.all(
        candidateArticles.map(async (article) => {
          const embeddingRow = await ctx.db
            .query("articleEmbeddings")
            .withIndex("by_article_version", (q) =>
              q.eq("articleId", article._id),
            )
            .order("desc")
            .first();
          if (!embeddingRow) return null;
          const source = await ctx.db.get(article.sourceId);
          return {
            _id: article._id,
            title: article.title,
            sourceName: source?.name ?? "Unknown",
            publishedAt: article.publishedAt,
            eventId: article.eventId ?? null,
            extractionQuality: article.extractionQuality ?? "weak",
            entities: article.entities ?? [],
            embedding: embeddingRow.embedding,
          };
        }),
      )
    ).filter((article) => article !== null);

    const pairs: Array<Record<string, unknown>> = [];
    for (let i = 0; i < enriched.length; i++) {
      const left = enriched[i]!;
      for (let j = i + 1; j < enriched.length; j++) {
        const right = enriched[j]!;
        const hoursApart =
          Math.abs(left.publishedAt - right.publishedAt) / (60 * 60 * 1000);
        if (hoursApart > 72) continue;

        const leftTokens = normalizeTitleTokens(left.title);
        const rightTokens = normalizeTitleTokens(right.title);
        const leftEntities = new Set(left.entities);
        const rightEntities = new Set(right.entities);
        pairs.push({
          leftArticleId: left._id,
          rightArticleId: right._id,
          leftTitle: left.title,
          rightTitle: right.title,
          leftSource: left.sourceName,
          rightSource: right.sourceName,
          leftQuality: left.extractionQuality,
          rightQuality: right.extractionQuality,
          currentlySameEvent:
            left.eventId !== null && left.eventId === right.eventId,
          cosine: Number(
            cosineSimilarity(
              toEventEmbedding(left.embedding),
              toEventEmbedding(right.embedding),
            ).toFixed(4),
          ),
          titleJaccard: Number(
            jaccardSimilarity(leftTokens, rightTokens).toFixed(4),
          ),
          sharedEntityCount: countTokenOverlap(leftEntities, rightEntities),
          hoursApart: Number(hoursApart.toFixed(1)),
        });
      }
    }

    return pairs
      .sort((a, b) => Number(b.cosine) - Number(a.cosine))
      .slice(0, 150);
  },
});

export const labelClusterPairForAdmin = mutation({
  args: {
    leftArticleId: v.id("articles"),
    rightArticleId: v.id("articles"),
    sameEvent: v.boolean(),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const currentUser = await requireAdminUser(ctx);
    const pairKey = buildClusterPairKey(
      args.leftArticleId,
      args.rightArticleId,
    );
    const [leftArticleId, rightArticleId] = [
      args.leftArticleId,
      args.rightArticleId,
    ].sort((a, b) => String(a).localeCompare(String(b))) as [
      Id<"articles">,
      Id<"articles">,
    ];

    const existing = await ctx.db
      .query("clusterPairLabels")
      .withIndex("by_pair_key", (q) => q.eq("pairKey", pairKey))
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, {
        leftArticleId,
        rightArticleId,
        sameEvent: args.sameEvent,
        notes: args.notes?.trim() || undefined,
        labeledAt: Date.now(),
        labeledByEmail: currentUser.email,
      });
      return { updated: true, created: false, pairKey };
    }

    await ctx.db.insert("clusterPairLabels", {
      pairKey,
      leftArticleId,
      rightArticleId,
      sameEvent: args.sameEvent,
      notes: args.notes?.trim() || undefined,
      labeledAt: Date.now(),
      labeledByEmail: currentUser.email,
    });
    return { updated: false, created: true, pairKey };
  },
});

export const getLabeledClusterPairsForAdmin = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit }) => {
    await requireAdminUser(ctx);

    const labels = await ctx.db
      .query("clusterPairLabels")
      .withIndex("by_labeled_at")
      .order("desc")
      .take(Math.max(10, Math.min(limit ?? 50, 200)));

    const results = (
      await Promise.all(
        labels.map(async (label) => {
          const [leftArticle, rightArticle] = await Promise.all([
            ctx.db.get(label.leftArticleId),
            ctx.db.get(label.rightArticleId),
          ]);
          if (!leftArticle || !rightArticle) return null;

          const [leftEmbeddingRow, rightEmbeddingRow, leftSource, rightSource] =
            await Promise.all([
              ctx.db
                .query("articleEmbeddings")
                .withIndex("by_article_version", (q) =>
                  q.eq("articleId", leftArticle._id),
                )
                .order("desc")
                .first(),
              ctx.db
                .query("articleEmbeddings")
                .withIndex("by_article_version", (q) =>
                  q.eq("articleId", rightArticle._id),
                )
                .order("desc")
                .first(),
              ctx.db.get(leftArticle.sourceId),
              ctx.db.get(rightArticle.sourceId),
            ]);

          const leftEmbedding = leftEmbeddingRow?.embedding;
          const rightEmbedding = rightEmbeddingRow?.embedding;
          if (!leftEmbedding || !rightEmbedding) return null;

          const leftTokens = normalizeTitleTokens(leftArticle.title);
          const rightTokens = normalizeTitleTokens(rightArticle.title);
          const leftEntities = new Set(leftArticle.entities ?? []);
          const rightEntities = new Set(rightArticle.entities ?? []);
          const hoursApart =
            Math.abs(leftArticle.publishedAt - rightArticle.publishedAt) /
            (60 * 60 * 1000);

          return {
            pairKey: label.pairKey,
            sameEventLabel: label.sameEvent,
            notes: label.notes,
            labeledAt: label.labeledAt,
            leftArticleId: leftArticle._id,
            rightArticleId: rightArticle._id,
            leftTitle: leftArticle.title,
            rightTitle: rightArticle.title,
            leftSource: leftSource?.name ?? "Unknown",
            rightSource: rightSource?.name ?? "Unknown",
            leftQuality: leftArticle.extractionQuality ?? "weak",
            rightQuality: rightArticle.extractionQuality ?? "weak",
            currentlySameEvent:
              leftArticle.eventId !== undefined &&
              leftArticle.eventId === rightArticle.eventId,
            cosine: Number(
              cosineSimilarity(
                toEventEmbedding(leftEmbedding),
                toEventEmbedding(rightEmbedding),
              ).toFixed(4),
            ),
            titleJaccard: Number(
              jaccardSimilarity(leftTokens, rightTokens).toFixed(4),
            ),
            sharedEntityCount: countTokenOverlap(leftEntities, rightEntities),
            hoursApart: Number(hoursApart.toFixed(1)),
          };
        }),
      )
    ).filter((row) => row !== null);

    const trueMatches = results.filter((row) => row.sameEventLabel);
    const falseMatches = results.filter((row) => !row.sameEventLabel);

    const averageCosine = (rows: typeof results) =>
      rows.length === 0
        ? null
        : Number(
            (
              rows.reduce((sum, row) => sum + row.cosine, 0) / rows.length
            ).toFixed(4),
          );

    return {
      summary: {
        totalLabels: results.length,
        trueMatches: trueMatches.length,
        falseMatches: falseMatches.length,
        trueMatchAverageCosine: averageCosine(trueMatches),
        falseMatchAverageCosine: averageCosine(falseMatches),
      },
      pairs: results,
    };
  },
});

export const refreshWeakPublishedEventsForAdmin = mutation({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { limit }) => {
    await requireAdminUser(ctx);

    const target = Math.max(1, Math.min(limit ?? 50, 200));
    const publishedEvents = await ctx.db
      .query("events")
      .withIndex("by_status_recency", (q) => q.eq("status", "published"))
      .order("desc")
      .take(target * 4);

    let refreshed = 0;
    let scanned = 0;
    for (const event of publishedEvents) {
      if (refreshed >= target) break;
      scanned++;
      if (!isWeakEventPresentation(event)) continue;
      await refreshEventPresentation(ctx, event._id);
      refreshed++;
    }

    return { refreshed, scanned };
  },
});

export const refreshWeakPublishedEventsInternal = internalMutation({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { limit }) => {
    const target = Math.max(1, Math.min(limit ?? 50, 200));
    const publishedEvents = await ctx.db
      .query("events")
      .withIndex("by_status_recency", (q) => q.eq("status", "published"))
      .order("desc")
      .take(target * 4);

    let refreshed = 0;
    let scanned = 0;
    for (const event of publishedEvents) {
      if (refreshed >= target) break;
      scanned++;
      if (!isWeakEventPresentation(event)) continue;
      await refreshEventPresentation(ctx, event._id);
      refreshed++;
    }

    return { refreshed, scanned };
  },
});

export const refreshEventImagesInternal = internalAction({
  args: {
    limit: v.optional(v.number()),
    includeProcessing: v.optional(v.boolean()),
    onlyMissingImage: v.optional(v.boolean()),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{ scanned: number; refreshed: number }> => {
    const limit = Math.min(Math.max(Math.floor(args.limit ?? 250), 1), 2000);
    const includeProcessing = args.includeProcessing ?? true;
    const onlyMissingImage = args.onlyMissingImage ?? true;

    const publishedEvents: Array<Pick<Doc<"events">, "_id">> =
      await ctx.runQuery(internal.clustering.getEventsForImageRefresh, {
        status: "published",
        limit,
        onlyMissingImage,
      });
    const processingEvents: Array<Pick<Doc<"events">, "_id">> =
      includeProcessing
        ? await ctx.runQuery(internal.clustering.getEventsForImageRefresh, {
            status: "processing",
            limit,
            onlyMissingImage,
          })
        : [];

    const seen = new Set<string>();
    const eventIds: Id<"events">[] = [...publishedEvents, ...processingEvents]
      .map((event) => event._id)
      .filter((eventId) => {
        const key = String(eventId);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, limit);

    let refreshed = 0;
    for (const eventId of eventIds) {
      await ctx.runMutation(internal.clustering.refreshEventPresentationById, {
        eventId,
      });
      refreshed++;
    }

    return {
      scanned: eventIds.length,
      refreshed,
    };
  },
});

export const refreshEventsFromImageArticlesInternal = internalAction({
  args: {
    limit: v.optional(v.number()),
    onlyMissingEventImage: v.optional(v.boolean()),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{ scannedArticles: number; refreshedEvents: number }> => {
    const limit = Math.min(Math.max(Math.floor(args.limit ?? 250), 1), 2000);
    const onlyMissingEventImage = args.onlyMissingEventImage ?? true;

    const imageArticles: Array<{
      articleId: Id<"articles">;
      eventId: Id<"events">;
      eventStatus: "processing" | "published";
      articlePublishedAt: number;
    }> = await ctx.runQuery(
      internal.clustering.getImageBearingArticlesForEventRefresh,
      {
        limit,
        onlyMissingEventImage,
      },
    );

    const seen = new Set<string>();
    const eventIds: Id<"events">[] = [];
    for (const row of imageArticles) {
      const key = String(row.eventId);
      if (seen.has(key)) continue;
      seen.add(key);
      eventIds.push(row.eventId);
    }

    for (const eventId of eventIds) {
      await ctx.runMutation(internal.clustering.refreshEventPresentationById, {
        eventId,
      });
    }

    return {
      scannedArticles: imageArticles.length,
      refreshedEvents: eventIds.length,
    };
  },
});

export const getEventsForImageRefresh = internalQuery({
  args: {
    status: v.union(v.literal("processing"), v.literal("published")),
    limit: v.number(),
    onlyMissingImage: v.boolean(),
  },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("events")
      .withIndex("by_status_recency", (q) => q.eq("status", args.status))
      .order("desc")
      .take(args.limit * 2);

    return rows
      .filter((event) => !args.onlyMissingImage || !event.imageUrl)
      .slice(0, args.limit);
  },
});

export const mergeEvents = internalMutation({
  args: {
    keepEventId: v.id("events"),
    removeEventId: v.id("events"),
    mergedEmbedding: v.array(v.number()),
    version: v.number(),
    mergedFirstPublishedAt: v.number(),
    mergedTitle: v.string(),
    mergedPerspectiveSummaries: v.optional(
      v.object({
        neutral: v.optional(v.string()),
        reformist: v.optional(v.string()),
        suveranist: v.optional(v.string()),
      }),
    ),
    mergedPerspectiveSource: v.optional(
      v.union(v.literal("heuristic"), v.literal("ai")),
    ),
    mergedGlobalImpact: v.optional(v.string()),
    mergedImageUrl: v.optional(v.string()),
    mergedLastSummarizedAt: v.optional(v.number()),
    mergedLastSummarySignature: v.optional(v.string()),
  },
  handler: async (
    ctx,
    {
      keepEventId,
      removeEventId,
      mergedEmbedding,
      version,
      mergedFirstPublishedAt,
      mergedTitle,
      mergedPerspectiveSummaries,
      mergedPerspectiveSource,
      mergedGlobalImpact,
      mergedImageUrl,
      mergedLastSummarizedAt,
      mergedLastSummarySignature,
    },
  ) => {
    if (keepEventId === removeEventId) {
      return { merged: false as const, reason: "same-event" as const };
    }

    const keepEvent = await ctx.db.get(keepEventId);
    const removeEvent = await ctx.db.get(removeEventId);
    if (!keepEvent || !removeEvent) {
      return { merged: false as const, reason: "missing-event" as const };
    }

    const needsKeepFallback =
      keepEvent.articleCount === undefined ||
      !keepEvent.sourceIds ||
      keepEvent.lastArticleAt === undefined;
    const keepArticles = needsKeepFallback
      ? (console.log(
          `[clustering] Falling back to article scan while merging keepEvent ${String(keepEventId)} because counters/sourceIds are missing`,
        ),
        await ctx.db
          .query("articles")
          .withIndex("by_event", (q) => q.eq("eventId", keepEventId))
          .collect())
      : null;
    const keepArticleCount =
      keepEvent.articleCount ?? keepArticles?.length ?? 0;
    const keepSourceIds = new Set(
      keepEvent.sourceIds ??
        keepArticles?.map((article) => article.sourceId) ??
        [],
    );
    const keepLastArticleAt =
      keepEvent.lastArticleAt ??
      (keepArticles && keepArticles.length > 0
        ? keepArticles.reduce(
            (max, article) => Math.max(max, article.publishedAt),
            keepEvent.firstPublishedAt,
          )
        : keepEvent.firstPublishedAt);

    const removeArticles = await ctx.db
      .query("articles")
      .withIndex("by_event", (q) => q.eq("eventId", removeEventId))
      .collect();
    const removeSourceIds = new Set(
      removeEvent.sourceIds ??
        removeArticles.map((article) => article.sourceId) ??
        [],
    );
    const removeLastArticleAt =
      removeEvent.lastArticleAt ??
      (removeArticles.length > 0
        ? removeArticles.reduce(
            (max, article) => Math.max(max, article.publishedAt),
            removeEvent.firstPublishedAt,
          )
        : removeEvent.firstPublishedAt);
    const mergedSourceIds = new Set([...keepSourceIds, ...removeSourceIds]);
    const mergedArticleCount = keepArticleCount + removeArticles.length;
    const mergedSourceCount = mergedSourceIds.size;
    const mergedLastArticleAt = Math.max(
      keepLastArticleAt,
      removeLastArticleAt,
    );
    for (const article of removeArticles) {
      await ctx.db.patch(article._id, { eventId: keepEventId });
    }

    const removeInteractions = await ctx.db
      .query("interactions")
      .withIndex("by_event", (q) => q.eq("eventId", removeEventId))
      .collect();
    for (const interaction of removeInteractions) {
      await ctx.db.patch(interaction._id, { eventId: keepEventId });
    }

    const sourceInsights = await ctx.db
      .query("userInsights")
      .withIndex("by_event", (q) => q.eq("eventId", removeEventId))
      .collect();
    for (const insight of sourceInsights) {
      const existingTarget = await ctx.db
        .query("userInsights")
        .withIndex("by_user_event", (q) =>
          q.eq("userId", insight.userId).eq("eventId", keepEventId),
        )
        .unique();

      if (!existingTarget) {
        await ctx.db.patch(insight._id, { eventId: keepEventId });
        continue;
      }

      const preferSource = insight.generatedAt > existingTarget.generatedAt;
      if (preferSource) {
        await ctx.db.patch(existingTarget._id, {
          content: insight.content,
          eventLastUpdated: insight.eventLastUpdated,
          generatedAt: insight.generatedAt,
          expiresAt: insight.expiresAt,
          lastNotifiedAt: insight.lastNotifiedAt,
        });
      }
      await ctx.db.delete(insight._id);
    }

    const removeTopicRows = await ctx.db
      .query("eventTopics")
      .withIndex("by_event", (q) => q.eq("eventId", removeEventId))
      .collect();
    for (const row of removeTopicRows) {
      const existingTargetTopic = await ctx.db
        .query("eventTopics")
        .withIndex("by_event_topic", (q) =>
          q.eq("eventId", keepEventId).eq("topicId", row.topicId),
        )
        .unique();
      if (!existingTargetTopic) {
        await ctx.db.insert("eventTopics", {
          eventId: keepEventId,
          topicId: row.topicId,
        });
      }
      await ctx.db.delete(row._id);
    }

    const [keepCandidacy, removeCandidacy] = await Promise.all([
      ctx.db
        .query("eventCandidacy")
        .withIndex("by_event", (q) => q.eq("eventId", keepEventId))
        .first(),
      ctx.db
        .query("eventCandidacy")
        .withIndex("by_event", (q) => q.eq("eventId", removeEventId))
        .first(),
    ]);

    const mergedTitleTokens = normalizeTitleTokens(
      normalizeTitleForClustering(mergedTitle),
    );
    const mergedEvidenceTokens = mergeAndCapTokenArray(
      keepCandidacy?.evidenceTokens ?? [],
      removeCandidacy?.evidenceTokens ?? [],
    );
    const mergedFactTokens = mergeAndCapTokenArray(
      keepCandidacy?.factTokens ?? [],
      removeCandidacy?.factTokens ?? [],
    );
    const mergedEntityTokens = mergeAndCapTokenArray(
      keepCandidacy?.entityTokens ?? [],
      removeCandidacy?.entityTokens ?? [],
    );
    const mergedTopicSlugs = mergeTopicSlugs(
      keepCandidacy?.topicSlugs,
      removeCandidacy?.topicSlugs ?? [],
    );
    const mergedStatus =
      keepEvent.status === "published" || removeEvent.status === "published"
        ? "published"
        : keepEvent.status;

    let keepCandidacyId = keepCandidacy?._id;
    if (keepCandidacy) {
      await ctx.db.patch(keepCandidacy._id, {
        ...buildCandidacySnapshotFields({
          status: mergedStatus,
          firstPublishedAt: mergedFirstPublishedAt,
          lastArticleAt: mergedLastArticleAt,
          articleCount: mergedArticleCount,
          sourceCount: mergedSourceCount,
          sourceIds: Array.from(mergedSourceIds),
        }),
        eventCreationTime: keepEvent._creationTime,
        title: mergedTitle,
        slug: keepEvent.slug,
        titleTokens: [...mergedTitleTokens],
        evidenceTokens: mergedEvidenceTokens,
        factTokens: mergedFactTokens,
        entityTokens: mergedEntityTokens,
        topicSlugs: mergedTopicSlugs,
        updatedAt: Date.now(),
      });
    } else {
      keepCandidacyId = await ctx.db.insert("eventCandidacy", {
        eventId: keepEventId,
        eventCreationTime: keepEvent._creationTime,
        title: mergedTitle,
        slug: keepEvent.slug,
        ...buildCandidacySnapshotFields({
          status: mergedStatus,
          firstPublishedAt: mergedFirstPublishedAt,
          lastArticleAt: mergedLastArticleAt,
          articleCount: mergedArticleCount,
          sourceCount: mergedSourceCount,
          sourceIds: Array.from(mergedSourceIds),
        }),
        titleTokens: [...mergedTitleTokens],
        evidenceTokens: mergedEvidenceTokens,
        factTokens: mergedFactTokens,
        entityTokens: mergedEntityTokens,
        topicSlugs: mergedTopicSlugs,
        updatedAt: Date.now(),
      });
    }

    if (removeCandidacy) {
      await ctx.db.delete(removeCandidacy._id);
    }

    const keepEmbeddingRow = await ctx.db
      .query("eventEmbeddings")
      .withIndex("by_event", (q) => q.eq("eventId", keepEventId))
      .first();
    const keepEmbeddingId = keepEmbeddingRow
      ? keepEmbeddingRow._id
      : await ctx.db.insert("eventEmbeddings", {
          eventId: keepEventId,
          embedding: mergedEmbedding,
          version,
          status: mergedStatus,
          ...buildEventEmbeddingFilterFields({
            status: mergedStatus,
            lastArticleAt: mergedLastArticleAt,
            articleCount: mergedArticleCount,
          }),
        });
    if (keepEmbeddingRow) {
      await ctx.db.patch(keepEmbeddingRow._id, {
        embedding: mergedEmbedding,
        version,
        status: mergedStatus,
        ...buildEventEmbeddingFilterFields({
          status: mergedStatus,
          lastArticleAt: mergedLastArticleAt,
          articleCount: mergedArticleCount,
        }),
      });
    }
    const keepHotEmbeddingId = await syncHotEventEmbedding(ctx, {
      eventId: keepEventId,
      embeddingId: keepEmbeddingId,
      embedding: mergedEmbedding,
      version,
      status: mergedStatus,
      lastArticleAt: mergedLastArticleAt,
      articleCount: mergedArticleCount,
    });
    if (keepCandidacyId) {
      await ctx.db.patch(keepCandidacyId, {
        embeddingId: keepEmbeddingId,
        hotEmbeddingId: keepHotEmbeddingId,
        eventCreationTime: keepEvent._creationTime,
      });
    }

    const removeHotRows = await ctx.db
      .query("eventEmbeddingHot")
      .withIndex("by_event", (q) => q.eq("eventId", removeEventId))
      .collect();
    for (const row of removeHotRows) {
      await ctx.db.delete(row._id);
    }

    const removeEmbeddingRows = await ctx.db
      .query("eventEmbeddings")
      .withIndex("by_event", (q) => q.eq("eventId", removeEventId))
      .collect();
    for (const row of removeEmbeddingRows) {
      await ctx.db.delete(row._id);
    }

    const removeShareAssets = await ctx.db
      .query("eventShareAssets")
      .withIndex("by_event", (q) => q.eq("eventId", removeEventId))
      .collect();
    for (const row of removeShareAssets) {
      await ctx.db.delete(row._id);
    }

    const removeSummaryJobs = await ctx.db
      .query("eventSummaryJobs")
      .withIndex("by_event", (q) => q.eq("eventId", removeEventId))
      .collect();
    for (const row of removeSummaryJobs) {
      await ctx.db.delete(row._id);
    }

    const removeClaims = await ctx.db
      .query("eventClaims")
      .withIndex("by_event", (q) => q.eq("eventId", removeEventId))
      .collect();
    for (const row of removeClaims) {
      await ctx.db.delete(row._id);
    }

    const keepHasAiPerspective =
      keepEvent.perspectiveSource === "ai" || Boolean(keepEvent.lastSummarizedAt);
    const removeHasAiPerspective =
      removeEvent.perspectiveSource === "ai" ||
      Boolean(removeEvent.lastSummarizedAt);
    const keepPerspectives = normalizedPerspectives(
      keepEvent.perspectiveSummaries,
    );
    const removePerspectives = normalizedPerspectives(
      removeEvent.perspectiveSummaries,
    );
    const resolvedMergedPerspectiveSummaries =
      mergedPerspectiveSummaries ??
      (keepHasAiPerspective && !removeHasAiPerspective
        ? keepPerspectives
        : removeHasAiPerspective && !keepHasAiPerspective
          ? removePerspectives
          : {
              neutral: preferLongerString(
                keepPerspectives?.neutral,
                removePerspectives?.neutral,
              ),
              reformist: preferLongerString(
                keepPerspectives?.reformist,
                removePerspectives?.reformist,
              ),
              suveranist: preferLongerString(
                keepPerspectives?.suveranist,
                removePerspectives?.suveranist,
              ),
            });
    const normalizedMergedPerspectiveSummaries =
      resolvedMergedPerspectiveSummaries?.neutral ||
      resolvedMergedPerspectiveSummaries?.reformist ||
      resolvedMergedPerspectiveSummaries?.suveranist
        ? resolvedMergedPerspectiveSummaries
        : undefined;
    const resolvedMergedPerspectiveSource =
      mergedPerspectiveSource ??
      (keepHasAiPerspective || removeHasAiPerspective
        ? "ai"
        : normalizedMergedPerspectiveSummaries
          ? "heuristic"
          : undefined);
    const resolvedMergedGlobalImpact =
      mergedGlobalImpact ??
      (keepHasAiPerspective && !removeHasAiPerspective
        ? keepEvent.globalImpact
        : removeHasAiPerspective && !keepHasAiPerspective
          ? removeEvent.globalImpact
          : preferLongerString(keepEvent.globalImpact, removeEvent.globalImpact));
    const resolvedMergedImageUrl =
      mergedImageUrl ?? keepEvent.imageUrl ?? removeEvent.imageUrl;
    const resolvedMergedLastSummarizedAt =
      mergedLastSummarizedAt ??
      ((keepEvent.lastSummarizedAt ?? 0) >= (removeEvent.lastSummarizedAt ?? 0)
        ? keepEvent.lastSummarizedAt
        : removeEvent.lastSummarizedAt);
    const resolvedMergedLastSummarySignature =
      mergedLastSummarySignature ??
      ((keepEvent.lastSummarizedAt ?? 0) >= (removeEvent.lastSummarizedAt ?? 0)
        ? keepEvent.lastSummarySignature ?? removeEvent.lastSummarySignature
        : removeEvent.lastSummarySignature ?? keepEvent.lastSummarySignature);

    const summaryMetadata =
      resolvedMergedPerspectiveSource === "ai"
        ? {
            lastSummarizedAt:
              resolvedMergedLastSummarizedAt ??
              keepEvent.lastSummarizedAt ??
              removeEvent.lastSummarizedAt,
            lastSummarySignature:
              resolvedMergedLastSummarySignature ??
              keepEvent.lastSummarySignature ??
              removeEvent.lastSummarySignature,
          }
        : undefined;

    await ctx.db.patch(keepEventId, {
      status: mergedStatus,
      title: mergedTitle,
      firstPublishedAt: mergedFirstPublishedAt,
      lastArticleAt: mergedLastArticleAt,
      articleCount: mergedArticleCount,
      sourceCount: mergedSourceCount,
      sourceIds: Array.from(mergedSourceIds),
      perspectiveSummaries: normalizedMergedPerspectiveSummaries,
      perspectiveSource: resolvedMergedPerspectiveSource,
      globalImpact: resolvedMergedGlobalImpact,
      imageUrl: resolvedMergedImageUrl,
      ...(summaryMetadata?.lastSummarizedAt !== undefined && {
        lastSummarizedAt: summaryMetadata.lastSummarizedAt,
      }),
      ...(summaryMetadata?.lastSummarySignature !== undefined && {
        lastSummarySignature: summaryMetadata.lastSummarySignature,
      }),
    });

    await refreshEventClaimCoverage(ctx, keepEventId);
    await refreshEventPresentation(ctx, keepEventId);
    await deletePublicEventPreview(ctx, removeEventId);

    await ctx.db.delete(removeEventId);
    return { merged: true as const, keepEventId, removeEventId };
  },
});

export const mergeNearDuplicateEvents = internalAction({
  args: {},
  handler: async (
    ctx,
  ): Promise<{
    mergedPairs: number;
    examinedPairs: number;
    skipped: number;
  }> => {
    const paused = await ctx.runQuery(internal.config.isPipelinePaused, {});
    if (paused) {
      console.log("[clustering] Pipeline paused — skipping event merge");
      return { mergedPairs: 0, examinedPairs: 0, skipped: 0 };
    }

    const lockOwner = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const lock = await ctx.runMutation(internal.ingestion.acquirePipelineLock, {
      key: MERGE_LOCK_KEY,
      owner: lockOwner,
      expiresAt: Date.now() + MERGE_LOCK_TTL_MS,
    });

    if (!lock.acquired) {
      console.log(
        `[clustering] mergeNearDuplicateEvents already running
         (owner=${lock.owner}, expiresAt=${new Date(lock.expiresAt).toISOString()})`,
      );
      return { mergedPairs: 0, examinedPairs: 0, skipped: 0 };
    }

    const startedAt = Date.now();
    const mergeCalibration = await ctx.runQuery(
      internal.vectorSearchBudget.calibratePerSearchBytes,
      {},
    );
    const metrics = createJobMetrics(
      "mergeNearDuplicateEvents",
      mergeCalibration.perSearchBytes,
    );

    try {
      const budget = await getVectorSearchBudgetState(ctx);
      metrics.budgetAllowed = budget.allowed;
      if (!budget.allowed) {
        console.log(
          `[clustering] mergeNearDuplicateEvents skipped: vector-search budget exhausted (${budget.usedQgb}/${budget.dailyLimitQgb} qGB)`,
        );
        await flushJobMetrics(ctx, metrics, startedAt);
        return { mergedPairs: 0, examinedPairs: 0, skipped: 0 };
      }

      const jobState = await ctx.runQuery(
        internal.clustering.getClusteringJobState,
        {
          jobName: "mergeNearDuplicateEvents",
        },
      );
      const sinceTs = jobState?.lastProcessedAt ?? 0;
      const sinceCreationTime = jobState?.lastProcessedCreationTime ?? 0;

      const candidateFetchStart = Date.now();
      const mergeConfig = await ctx.runQuery(internal.config.getBatch, {
        keys: [
          "merge_min_similarity",
          "merge_min_title_jaccard",
          "merge_max_time_delta_hours",
          "merge_vector_search_limit",
          "merge_changed_seed_limit",
        ],
      });

      const settings: MergeSettings = {
        minSimilarity: clampNumber(
          mergeConfig.merge_min_similarity,
          DEFAULT_MERGE_MIN_SIMILARITY,
          0.75,
          0.999,
        ),
        minTitleJaccard: clampNumber(
          mergeConfig.merge_min_title_jaccard,
          DEFAULT_MERGE_MIN_TITLE_JACCARD,
          0,
          1,
        ),
        maxTimeDeltaHours: clampNumber(
          mergeConfig.merge_max_time_delta_hours,
          DEFAULT_MERGE_MAX_TIME_DELTA_HOURS,
          1,
          72,
        ),
      };
      const vectorSearchLimit = safeInteger(
        mergeConfig.merge_vector_search_limit,
        MERGE_VECTOR_SEARCH_LIMIT,
        1,
        60,
      );
      const changedSeedLimit = safeInteger(
        mergeConfig.merge_changed_seed_limit,
        MERGE_CHANGED_SEED_LIMIT,
        1,
        100,
      );
      const recentSinceTs =
        Date.now() - settings.maxTimeDeltaHours * 60 * 60 * 1000;
      const changedCandidatePage = await ctx.runQuery(
        internal.clustering.getChangedClusterCandidates,
        {
          sinceTs,
          sinceCreationTime,
          recentSinceTs,
          limit: changedSeedLimit,
          singletonOnly: false,
        },
      );
      const changedCandidateRows = changedCandidatePage.rows;
      markStageDuration(metrics, "candidateFetch", candidateFetchStart);

      if (changedCandidateRows.length === 0) {
        console.log(
          JSON.stringify({
            scope: "mergeNearDuplicateEvents",
            event: "no_candidates",
            sinceTs,
            sinceCreationTime,
          }),
        );
        const advancedCursor = advanceChangedCandidateCursor(
          changedCandidatePage.cursorRows,
          sinceTs,
          sinceCreationTime,
        );
        await ctx.runMutation(internal.clustering.upsertClusteringJobState, {
          jobName: "mergeNearDuplicateEvents",
          lastProcessedAt: advancedCursor.lastProcessedAt,
          lastProcessedCreationTime: advancedCursor.lastProcessedCreationTime,
          lastProcessedDayBucket:
            jobState?.lastProcessedDayBucket ?? formatUtcDayBucket(Date.now()),
          lastRunAt: Date.now(),
          lastRunMetricsJson: JSON.stringify(metrics),
        });
        await flushJobMetrics(ctx, metrics, startedAt);
        return { mergedPairs: 0, examinedPairs: 0, skipped: 0 };
      }

      const seedCandidateResults = await ctx.runQuery(
        internal.clustering.getClusterCandidatesByEventIds,
        {
          eventIds: changedCandidateRows.map(
            (row: { eventId: Id<"events"> }) => row.eventId,
          ),
        },
      );
      const seeds = (seedCandidateResults as ClusterCandidateQueryResult[]).map(
        (candidate) => hydrateClusterCandidate(candidate),
      );
      metrics.mergeSeedEvents = seeds.length;

      const neighborSearchStart = Date.now();
      const dayBuckets = collectRecentDayBuckets(settings.maxTimeDeltaHours);
      const mergeSearchBuckets = buildMergeSearchBuckets(dayBuckets);
      const candidatesByEventId = new Map<string, ClusterCandidate>();
      for (const candidate of seeds) {
        candidatesByEventId.set(String(candidate.eventId), candidate);
      }
      const pairKeys = new Set<string>();
      const candidatePairs: Array<[ClusterCandidate, ClusterCandidate]> = [];

      for (const candidate of seeds) {
        if (!candidate.embeddingId || !candidate.embedding) continue;
        const reservationId = await reserveVectorSearch(ctx, metrics);
        if (!reservationId) continue;

        let neighbors: Array<{ _id: Id<"eventEmbeddings">; _score: number }>;
        try {
          neighbors = await ctx.vectorSearch(
            "eventEmbeddings",
            "by_embedding",
            {
              vector: toEventEmbedding(candidate.embedding),
              limit: vectorSearchLimit,
              filter: (q) =>
                mergeSearchBuckets.length <= 1
                  ? q.eq(
                      "mergeSearchBucket",
                      mergeSearchBuckets[0] ??
                        `published::${MERGE_RECENT_BUCKET}::${formatUtcDayBucket(Date.now())}`,
                    )
                  : q.or(
                      ...mergeSearchBuckets.map((bucket) =>
                        q.eq("mergeSearchBucket", bucket),
                      ),
                    ),
            },
          );
        } catch (error) {
          await releaseVectorSearchReservation(ctx, reservationId);
          throw error;
        }
        await consumeVectorSearchReservation(ctx, metrics, reservationId);
        metrics.vectorSearches++;
        metrics.vectorMatchesReturned += neighbors.length;
        if (neighbors.length === 0) continue;

        const hydratedResults = await ctx.runQuery(
          internal.clustering.getClusterCandidatesByEmbeddingMatches,
          {
            embeddingMatches: neighbors.map((result) => ({
              embeddingId: result._id,
              similarity: result._score,
            })),
            includeEmbedding: true,
          },
        );
        metrics.vectorMatchesHydrated += hydratedResults.length;
        metrics.vectorMatchesDiscardedPostFetch +=
          neighbors.length - hydratedResults.length;

        for (const result of hydratedResults as ClusterCandidateVectorResult[]) {
          const matchKey = String(result.eventId);
          let match = candidatesByEventId.get(matchKey);
          if (!match) {
            match = hydrateClusterCandidate(result);
            candidatesByEventId.set(matchKey, match);
          }
          match.similarity = result.similarity;
          if (!match || match.eventId === candidate.eventId) continue;
          const key = buildEventPairKey(candidate.eventId, match.eventId);
          if (pairKeys.has(key)) continue;
          pairKeys.add(key);
          candidatePairs.push([candidate, match]);
        }
      }
      markStageDuration(metrics, "neighborSearch", neighborSearchStart);
      metrics.candidateCacheSize = candidatesByEventId.size;

      console.log(
        `[clustering] Merge candidates: ${seeds.length} seeds, ${candidatePairs.length} pairs`,
      );

      const removedIds = new Set<string>();
      let mergedPairs = 0;
      let examinedPairs = 0;
      let skipped = 0;

      for (const [a, b] of candidatePairs) {
        if (removedIds.has(String(a.eventId))) continue;
        if (removedIds.has(String(b.eventId))) continue;
        const aEmbedding = a.embedding;
        const bEmbedding = b.embedding;
        if (!aEmbedding || !bEmbedding) {
          skipped++;
          continue;
        }

        examinedPairs++;

        const timeDeltaHours =
          Math.abs(a.firstPublishedAt - b.firstPublishedAt) / (60 * 60 * 1000);
        if (timeDeltaHours > settings.maxTimeDeltaHours) {
          continue;
        }

        const similarity = cosineSimilarity(aEmbedding, bEmbedding);
        const titleJaccard = jaccardSimilarity(a.titleTokens, b.titleTokens);
        const entityOverlap = countTokenOverlap(a.entityTokens, b.entityTokens);
        const topicOverlap = countTokenOverlap(a.topicSlugs, b.topicSlugs);
        if (
          similarity < settings.minSimilarity ||
          (titleJaccard < settings.minTitleJaccard &&
            entityOverlap < 2 &&
            topicOverlap < 1)
        ) {
          continue;
        }

        const { keep, remove } = chooseCanonicalEvent(a, b);
        if (!keep.embedding || !remove.embedding) {
          skipped++;
          continue;
        }
        const keepEmbedding = keep.embedding;
        const removeEmbedding = remove.embedding;
        const totalArticles = keep.articleCount + remove.articleCount;
        const mergedEmbedding = keepEmbedding.map(
          (value, index) =>
            (value * keep.articleCount +
              (removeEmbedding[index] ?? 0) * remove.articleCount) /
            Math.max(totalArticles, 1),
        );
        const keepHasAiPerspective =
          keep.perspectiveSource === "ai" || Boolean(keep.lastSummarizedAt);
        const removeHasAiPerspective =
          remove.perspectiveSource === "ai" || Boolean(remove.lastSummarizedAt);
        const mergedPerspectiveSummaries =
          keepHasAiPerspective && !removeHasAiPerspective
            ? keep.perspectiveSummaries
            : removeHasAiPerspective && !keepHasAiPerspective
              ? remove.perspectiveSummaries
              : buildMergedPerspectiveSummaries(keep, remove);
        const mergedPerspectiveSource =
          keepHasAiPerspective || removeHasAiPerspective
            ? "ai"
            : mergedPerspectiveSummaries
              ? "heuristic"
              : undefined;
        const mergedGlobalImpact =
          keepHasAiPerspective && !removeHasAiPerspective
            ? keep.globalImpact
            : removeHasAiPerspective && !keepHasAiPerspective
              ? remove.globalImpact
              : preferLongerString(keep.globalImpact, remove.globalImpact);
        const mergedImageUrl = keep.imageUrl ?? remove.imageUrl;
        const mergedTitle =
          preferLongerString(keep.title, remove.title) ?? keep.title;
        const mergedSummaryMetadata = pickMergedSummaryMetadata(keep, remove);
        const mergedLastSummarizedAt = mergedSummaryMetadata.lastSummarizedAt;
        const mergedLastSummarySignature =
          mergedSummaryMetadata.lastSummarySignature;

        const result = await ctx.runMutation(internal.clustering.mergeEvents, {
          keepEventId: keep.eventId,
          removeEventId: remove.eventId,
          mergedEmbedding,
          version: 1,
          mergedFirstPublishedAt: Math.min(
            keep.firstPublishedAt,
            remove.firstPublishedAt,
          ),
          mergedTitle,
          mergedPerspectiveSummaries,
          mergedPerspectiveSource,
          mergedGlobalImpact,
          mergedImageUrl,
          mergedLastSummarizedAt,
          mergedLastSummarySignature,
        });

        if (!result.merged) {
          skipped++;
          continue;
        }

        mergedPairs++;
        removedIds.add(String(remove.eventId));
        keep.articleCount = totalArticles;
        keep.embedding = mergedEmbedding;
        keep.firstPublishedAt = Math.min(
          keep.firstPublishedAt,
          remove.firstPublishedAt,
        );
        keep.lastArticleAt = Math.max(
          keep.lastArticleAt ?? keep.firstPublishedAt,
          remove.lastArticleAt ?? remove.firstPublishedAt,
        );
        keep.title = mergedTitle;
        keep.titleTokens = normalizeTitleTokens(mergedTitle);
        keep.perspectiveSummaries = mergedPerspectiveSummaries;
        keep.perspectiveSource = mergedPerspectiveSource;
        keep.globalImpact = mergedGlobalImpact;
        keep.imageUrl = mergedImageUrl;
        if (mergedLastSummarizedAt !== undefined) {
          keep.lastSummarizedAt = mergedLastSummarizedAt;
        }
        if (mergedLastSummarySignature !== undefined) {
          keep.lastSummarySignature = mergedLastSummarySignature;
        }
        for (const sourceId of remove.sourceIds) {
          keep.sourceIds.add(sourceId);
        }
        keep.sourceCount = keep.sourceIds.size;
        for (const token of remove.entityTokens) {
          keep.entityTokens.add(token);
        }
        for (const token of remove.evidenceTokens) {
          keep.evidenceTokens.add(token);
        }
        for (const token of remove.factTokens) {
          keep.factTokens.add(token);
        }
        for (const topicSlug of remove.topicSlugs) {
          keep.topicSlugs.add(topicSlug);
        }
        candidatesByEventId.set(String(keep.eventId), keep);
      }

      metrics.vectorSearchesPerCandidateEvent =
        seeds.length > 0 ? metrics.vectorSearches / seeds.length : 0;

      console.log(
        `[clustering] Merge pass complete: ${mergedPairs} merged, ${examinedPairs} pairs examined, ${skipped} skipped`,
      );

      const advancedCursor = advanceChangedCandidateCursor(
        changedCandidatePage.cursorRows,
        sinceTs,
        sinceCreationTime,
      );
      await ctx.runMutation(internal.clustering.upsertClusteringJobState, {
        jobName: "mergeNearDuplicateEvents",
        lastProcessedAt: advancedCursor.lastProcessedAt,
        lastProcessedCreationTime: advancedCursor.lastProcessedCreationTime,
        lastProcessedDayBucket: formatUtcDayBucket(Date.now()),
        lastRunAt: Date.now(),
        lastRunMetricsJson: JSON.stringify(metrics),
      });
      await flushJobMetrics(ctx, metrics, startedAt);

      // Merges/reclusters can push an event over the summary/publish bar, so
      // trigger summarization immediately rather than waiting for the cron.
      if (mergedPairs > 0) {
        await ctx.scheduler.runAfter(
          0,
          internal.summarizationNode.summarizeQueuedEvents,
          {},
        );
      }

      return { mergedPairs, examinedPairs, skipped };
    } finally {
      try {
        await ctx.runMutation(internal.ingestion.releasePipelineLock, {
          key: MERGE_LOCK_KEY,
          owner: lockOwner,
        });
      } catch (error) {
        console.error(
          `[clustering] Failed to release merge lock: ${error instanceof Error ? error.message : "Unknown error"}`,
        );
      }
    }
  },
});

export const reclusterRecentSingletonEvents = internalAction({
  args: {},
  handler: async (
    ctx,
  ): Promise<{
    mergedPairs: number;
    examinedPairs: number;
    skipped: number;
  }> => {
    const paused = await ctx.runQuery(internal.config.isPipelinePaused, {});
    if (paused) {
      console.log(
        "[clustering] Pipeline paused — skipping singleton recluster",
      );
      return { mergedPairs: 0, examinedPairs: 0, skipped: 0 };
    }

    const lockOwner = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const lock = await ctx.runMutation(internal.ingestion.acquirePipelineLock, {
      key: RECLUSTER_SINGLETONS_LOCK_KEY,
      owner: lockOwner,
      expiresAt: Date.now() + MERGE_LOCK_TTL_MS,
    });

    if (!lock.acquired) {
      console.log(
        `[clustering] reclusterRecentSingletonEvents already running (owner=${lock.owner}, expiresAt=${new Date(lock.expiresAt).toISOString()})`,
      );
      return { mergedPairs: 0, examinedPairs: 0, skipped: 0 };
    }

    const startedAt = Date.now();
    const reclusterCalibration = await ctx.runQuery(
      internal.vectorSearchBudget.calibratePerSearchBytes,
      {},
    );
    const metrics = createJobMetrics(
      "reclusterRecentSingletonEvents",
      reclusterCalibration.perSearchBytes,
    );

    try {
      const budget = await getVectorSearchBudgetState(ctx);
      metrics.budgetAllowed = budget.allowed;
      if (!budget.allowed) {
        console.log(
          `[clustering] reclusterRecentSingletonEvents skipped: vector-search budget exhausted (${budget.usedQgb}/${budget.dailyLimitQgb} qGB)`,
        );
        await flushJobMetrics(ctx, metrics, startedAt);
        return { mergedPairs: 0, examinedPairs: 0, skipped: 0 };
      }

      const jobState = await ctx.runQuery(
        internal.clustering.getClusteringJobState,
        {
          jobName: "reclusterRecentSingletonEvents",
        },
      );
      const sinceTs = jobState?.lastProcessedAt ?? 0;
      const sinceCreationTime = jobState?.lastProcessedCreationTime ?? 0;

      const reclusterConfig = await ctx.runQuery(internal.config.getBatch, {
        keys: [
          "singleton_recluster_min_similarity",
          "singleton_recluster_window_hours",
          "recluster_vector_search_limit",
          "recluster_changed_seed_limit",
        ],
      });
      const settings: ReclusterSettings = {
        minSimilarity: clampNumber(
          reclusterConfig.singleton_recluster_min_similarity,
          DEFAULT_RECLUSTER_MIN_SIMILARITY,
          0.6,
          0.999,
        ),
        windowHours: clampNumber(
          reclusterConfig.singleton_recluster_window_hours,
          DEFAULT_RECLUSTER_WINDOW_HOURS,
          6,
          168,
        ),
      };
      const vectorSearchLimit = safeInteger(
        reclusterConfig.recluster_vector_search_limit,
        RECLUSTER_VECTOR_SEARCH_LIMIT,
        1,
        60,
      );
      const changedSeedLimit = safeInteger(
        reclusterConfig.recluster_changed_seed_limit,
        RECLUSTER_CHANGED_SEED_LIMIT,
        1,
        100,
      );

      const candidateFetchStart = Date.now();
      const changedCandidatePage = await ctx.runQuery(
        internal.clustering.getChangedClusterCandidates,
        {
          sinceTs,
          sinceCreationTime,
          recentSinceTs: Date.now() - settings.windowHours * 60 * 60 * 1000,
          limit: changedSeedLimit,
          singletonOnly: true,
        },
      );
      const changedCandidateRows = changedCandidatePage.rows;
      markStageDuration(metrics, "candidateFetch", candidateFetchStart);

      if (changedCandidateRows.length === 0) {
        console.log(
          JSON.stringify({
            scope: "reclusterRecentSingletonEvents",
            event: "no_candidates",
            sinceTs,
            sinceCreationTime,
          }),
        );
        const advancedCursor = advanceChangedCandidateCursor(
          changedCandidatePage.cursorRows,
          sinceTs,
          sinceCreationTime,
        );
        await ctx.runMutation(internal.clustering.upsertClusteringJobState, {
          jobName: "reclusterRecentSingletonEvents",
          lastProcessedAt: advancedCursor.lastProcessedAt,
          lastProcessedCreationTime: advancedCursor.lastProcessedCreationTime,
          lastProcessedDayBucket:
            jobState?.lastProcessedDayBucket ?? formatUtcDayBucket(Date.now()),
          lastRunAt: Date.now(),
          lastRunMetricsJson: JSON.stringify(metrics),
        });
        await flushJobMetrics(ctx, metrics, startedAt);
        return { mergedPairs: 0, examinedPairs: 0, skipped: 0 };
      }

      const seedCandidateResults = await ctx.runQuery(
        internal.clustering.getClusterCandidatesByEventIds,
        {
          eventIds: changedCandidateRows.map(
            (row: { eventId: Id<"events"> }) => row.eventId,
          ),
        },
      );
      const candidates = (
        seedCandidateResults as ClusterCandidateQueryResult[]
      ).map((candidate) => hydrateClusterCandidate(candidate));
      metrics.reclusterSeedEvents = candidates.length;

      const neighborSearchStart = Date.now();
      const candidatesByEventId = new Map<string, ClusterCandidate>();
      for (const candidate of candidates) {
        if (!candidate.embeddingId || !candidate.embedding) continue;
        candidatesByEventId.set(String(candidate.eventId), candidate);
      }

      const pairKeys = new Set<string>();
      const candidatePairs: Array<[ClusterCandidate, ClusterCandidate]> = [];
      const dayBuckets = collectRecentDayBuckets(settings.windowHours);
      const singletonSearchBuckets = buildSingletonSearchBuckets(dayBuckets);

      for (const candidate of candidates) {
        if (!candidate.embeddingId || !candidate.embedding) continue;
        const reservationId = await reserveVectorSearch(ctx, metrics);
        if (!reservationId) continue;

        let neighbors: Array<{ _id: Id<"eventEmbeddings">; _score: number }>;
        try {
          neighbors = await ctx.vectorSearch(
            "eventEmbeddings",
            "by_embedding",
            {
              vector: toEventEmbedding(candidate.embedding),
              limit: vectorSearchLimit,
              filter: (q) =>
                singletonSearchBuckets.length <= 1
                  ? q.eq(
                      "singletonSearchBucket",
                      singletonSearchBuckets[0] ??
                        `published::${SINGLETON_BUCKET}::${formatUtcDayBucket(Date.now())}`,
                    )
                  : q.or(
                      ...singletonSearchBuckets.map((bucket) =>
                        q.eq("singletonSearchBucket", bucket),
                      ),
                    ),
            },
          );
        } catch (error) {
          await releaseVectorSearchReservation(ctx, reservationId);
          throw error;
        }
        await consumeVectorSearchReservation(ctx, metrics, reservationId);
        metrics.vectorSearches++;
        metrics.vectorMatchesReturned += neighbors.length;
        if (neighbors.length === 0) continue;

        const hydratedResults = await ctx.runQuery(
          internal.clustering.getClusterCandidatesByEmbeddingMatches,
          {
            embeddingMatches: neighbors.map((result) => ({
              embeddingId: result._id,
              similarity: result._score,
            })),
            includeEmbedding: true,
          },
        );
        metrics.vectorMatchesHydrated += hydratedResults.length;
        metrics.vectorMatchesDiscardedPostFetch +=
          neighbors.length - hydratedResults.length;

        for (const result of hydratedResults as ClusterCandidateVectorResult[]) {
          const matchKey = String(result.eventId);
          let match = candidatesByEventId.get(matchKey);
          if (!match) {
            match = hydrateClusterCandidate(result);
            candidatesByEventId.set(matchKey, match);
          }
          match.similarity = result.similarity;
          if (!match || match.eventId === candidate.eventId) continue;
          const key = buildEventPairKey(candidate.eventId, match.eventId);
          if (pairKeys.has(key)) continue;
          pairKeys.add(key);
          candidatePairs.push([candidate, match]);
        }
      }
      markStageDuration(metrics, "neighborSearch", neighborSearchStart);
      metrics.candidateCacheSize = candidatesByEventId.size;

      console.log(
        `[clustering] Recluster candidates: ${candidates.length} seeds, ${candidatePairs.length} pairs`,
      );

      const removedIds = new Set<string>();
      let mergedPairs = 0;
      let examinedPairs = 0;
      let skipped = 0;

      for (const [a, b] of candidatePairs) {
        if (removedIds.has(String(a.eventId))) continue;
        if (removedIds.has(String(b.eventId))) continue;
        const aEmbedding = a.embedding;
        const bEmbedding = b.embedding;
        if (!aEmbedding || !bEmbedding) {
          skipped++;
          continue;
        }
        examinedPairs++;

        const hoursApart =
          Math.abs(a.firstPublishedAt - b.firstPublishedAt) / (60 * 60 * 1000);
        if (hoursApart > settings.windowHours) continue;

        const similarity = cosineSimilarity(aEmbedding, bEmbedding);
        const entityOverlap = countTokenOverlap(a.entityTokens, b.entityTokens);
        const topicOverlap = countTokenOverlap(a.topicSlugs, b.topicSlugs);
        const titleJaccard = jaccardSimilarity(a.titleTokens, b.titleTokens);
        const hasEntitySupport = entityOverlap >= 1;
        const hasTitleSupport = titleJaccard >= DEFAULT_MIN_TITLE_JACCARD * 1.5;
        const hasSimilaritySupport =
          similarity >= settings.minSimilarity + 0.08;
        const hasTopicSupport = topicOverlap >= 1;
        if (
          similarity < settings.minSimilarity ||
          (!hasEntitySupport &&
            !hasTitleSupport &&
            !hasSimilaritySupport &&
            !hasTopicSupport)
        ) {
          continue;
        }

        const { keep, remove } = chooseCanonicalEvent(a, b);
        if (!keep.embedding || !remove.embedding) {
          skipped++;
          continue;
        }
        const keepEmbedding = keep.embedding;
        const removeEmbedding = remove.embedding;
        const totalArticles = keep.articleCount + remove.articleCount;
        const mergedEmbedding = keepEmbedding.map(
          (value, index) =>
            (value * keep.articleCount +
              (removeEmbedding[index] ?? 0) * remove.articleCount) /
            Math.max(totalArticles, 1),
        );
        const keepHasAiPerspective =
          keep.perspectiveSource === "ai" || Boolean(keep.lastSummarizedAt);
        const removeHasAiPerspective =
          remove.perspectiveSource === "ai" || Boolean(remove.lastSummarizedAt);
        const mergedPerspectiveSummaries =
          keepHasAiPerspective && !removeHasAiPerspective
            ? keep.perspectiveSummaries
            : removeHasAiPerspective && !keepHasAiPerspective
              ? remove.perspectiveSummaries
              : buildMergedPerspectiveSummaries(keep, remove);
        const mergedPerspectiveSource =
          keepHasAiPerspective || removeHasAiPerspective
            ? "ai"
            : mergedPerspectiveSummaries
              ? "heuristic"
              : undefined;
        const mergedGlobalImpact =
          keepHasAiPerspective && !removeHasAiPerspective
            ? keep.globalImpact
            : removeHasAiPerspective && !keepHasAiPerspective
              ? remove.globalImpact
              : preferLongerString(keep.globalImpact, remove.globalImpact);
        const mergedImageUrl = keep.imageUrl ?? remove.imageUrl;
        const mergedTitle =
          preferLongerString(keep.title, remove.title) ?? keep.title;
        const mergedSummaryMetadata = pickMergedSummaryMetadata(keep, remove);
        const mergedLastSummarizedAt = mergedSummaryMetadata.lastSummarizedAt;
        const mergedLastSummarySignature =
          mergedSummaryMetadata.lastSummarySignature;

        const result = await ctx.runMutation(internal.clustering.mergeEvents, {
          keepEventId: keep.eventId,
          removeEventId: remove.eventId,
          mergedEmbedding,
          version: 1,
          mergedFirstPublishedAt: Math.min(
            keep.firstPublishedAt,
            remove.firstPublishedAt,
          ),
          mergedTitle,
          mergedPerspectiveSummaries,
          mergedPerspectiveSource,
          mergedGlobalImpact,
          mergedImageUrl,
          mergedLastSummarizedAt,
          mergedLastSummarySignature,
        });

        if (!result.merged) {
          skipped++;
          continue;
        }

        mergedPairs++;
        removedIds.add(String(remove.eventId));
        keep.articleCount = totalArticles;
        keep.embedding = mergedEmbedding;
        keep.firstPublishedAt = Math.min(
          keep.firstPublishedAt,
          remove.firstPublishedAt,
        );
        keep.lastArticleAt = Math.max(
          keep.lastArticleAt ?? keep.firstPublishedAt,
          remove.lastArticleAt ?? remove.firstPublishedAt,
        );
        keep.title = mergedTitle;
        keep.titleTokens = normalizeTitleTokens(mergedTitle);
        keep.perspectiveSummaries = mergedPerspectiveSummaries;
        keep.perspectiveSource = mergedPerspectiveSource;
        keep.globalImpact = mergedGlobalImpact;
        keep.imageUrl = mergedImageUrl;
        if (mergedLastSummarizedAt !== undefined) {
          keep.lastSummarizedAt = mergedLastSummarizedAt;
        }
        if (mergedLastSummarySignature !== undefined) {
          keep.lastSummarySignature = mergedLastSummarySignature;
        }
        for (const sourceId of remove.sourceIds) keep.sourceIds.add(sourceId);
        keep.sourceCount = keep.sourceIds.size;
        for (const token of remove.entityTokens) keep.entityTokens.add(token);
        for (const topicSlug of remove.topicSlugs) {
          keep.topicSlugs.add(topicSlug);
        }
        candidatesByEventId.set(String(keep.eventId), keep);
      }

      metrics.vectorSearchesPerCandidateEvent =
        candidates.length > 0 ? metrics.vectorSearches / candidates.length : 0;

      console.log(
        `[clustering] Singleton recluster complete: ${mergedPairs} merged, ${examinedPairs} pairs examined, ${skipped} skipped`,
      );

      const advancedCursor = advanceChangedCandidateCursor(
        changedCandidatePage.cursorRows,
        sinceTs,
        sinceCreationTime,
      );
      await ctx.runMutation(internal.clustering.upsertClusteringJobState, {
        jobName: "reclusterRecentSingletonEvents",
        lastProcessedAt: advancedCursor.lastProcessedAt,
        lastProcessedCreationTime: advancedCursor.lastProcessedCreationTime,
        lastProcessedDayBucket: formatUtcDayBucket(Date.now()),
        lastRunAt: Date.now(),
        lastRunMetricsJson: JSON.stringify(metrics),
      });
      await flushJobMetrics(ctx, metrics, startedAt);

      // Merges/reclusters can push an event over the summary/publish bar, so
      // trigger summarization immediately rather than waiting for the cron.
      if (mergedPairs > 0) {
        await ctx.scheduler.runAfter(
          0,
          internal.summarizationNode.summarizeQueuedEvents,
          {},
        );
      }

      return { mergedPairs, examinedPairs, skipped };
    } finally {
      try {
        await ctx.runMutation(internal.ingestion.releasePipelineLock, {
          key: RECLUSTER_SINGLETONS_LOCK_KEY,
          owner: lockOwner,
        });
      } catch (error) {
        console.error(
          `[clustering] Failed to release singleton recluster lock: ${error instanceof Error ? error.message : "Unknown error"}`,
        );
      }
    }
  },
});

export const clusterEnrichedArticles = internalAction({
  args: {},
  handler: async (
    ctx,
  ): Promise<{
    clusteredIntoExisting: number;
    createdEvents: number;
    skipped: number;
  }> => {
    const paused = await ctx.runQuery(internal.config.isPipelinePaused, {});
    if (paused) {
      console.log("[clustering] Pipeline paused — skipping clustering");
      return {
        clusteredIntoExisting: 0,
        createdEvents: 0,
        skipped: 0,
      };
    }

    const lockOwner = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const lock = await ctx.runMutation(internal.ingestion.acquirePipelineLock, {
      key: CLUSTER_LOCK_KEY,
      owner: lockOwner,
      expiresAt: Date.now() + CLUSTER_LOCK_TTL_MS,
    });

    if (!lock.acquired) {
      console.log(
        `[clustering] clusterEnrichedArticles already running (owner=${lock.owner}, expiresAt=${new Date(lock.expiresAt).toISOString()})`,
      );
      return {
        clusteredIntoExisting: 0,
        createdEvents: 0,
        skipped: 0,
      };
    }

    const startedAt = Date.now();
    const clusterCalibration = await ctx.runQuery(
      internal.vectorSearchBudget.calibratePerSearchBytes,
      {},
    );
    const metrics = createJobMetrics(
      "clusterEnrichedArticles",
      clusterCalibration.perSearchBytes,
    );
    let clusterRunReservationId: Id<"vectorSearchReservations"> | null = null;
    let clusterRunReservationSettled = false;

    try {
      const hasEnriched = await ctx.runQuery(
        internal.clustering.hasEnrichedArticlesForClustering,
        {},
      );
      if (!hasEnriched) {
        console.log("[clustering] No enriched articles to cluster");
        return {
          clusteredIntoExisting: 0,
          createdEvents: 0,
          skipped: 0,
        };
      }

      await ctx.runMutation(internal.topics.syncTopicCatalog, {});

      const articles = await ctx.runQuery(
        internal.clustering.getEnrichedArticlesForClustering,
        { limit: CLUSTER_BATCH_SIZE },
      );

      if (articles.length === 0) {
        console.log("[clustering] No enriched articles to cluster");
        return {
          clusteredIntoExisting: 0,
          createdEvents: 0,
          skipped: 0,
        };
      }

      const topicsForInference = await ctx.runQuery(
        internal.topics.getTopicsForInference,
        {},
      );

      const clusteringConfig = await ctx.runQuery(
        internal.config.getPipelineRuntimeConfig,
        {},
      );

      const settings: ClusterSettings = {
        minSimilarity: clampNumber(
          clusteringConfig.clustering_min_similarity,
          DEFAULT_MIN_CLUSTER_SIMILARITY,
          0.5,
          0.99,
        ),
        strongSimilarity: clampNumber(
          clusteringConfig.clustering_strong_similarity,
          DEFAULT_STRONG_CLUSTER_SIMILARITY,
          0.6,
          0.999,
        ),
        minTitleTokenOverlap: safeInteger(
          clusteringConfig.clustering_min_title_overlap,
          DEFAULT_MIN_TITLE_TOKEN_OVERLAP,
          1,
          10,
        ),
        minTitleJaccard: clampNumber(
          clusteringConfig.clustering_min_title_jaccard,
          DEFAULT_MIN_TITLE_JACCARD,
          0,
          1,
        ),
        sameSourceMinSimilarity: clampNumber(
          clusteringConfig.clustering_same_source_min_similarity,
          DEFAULT_SAME_SOURCE_MIN_SIMILARITY,
          0.5,
          0.999,
        ),
        weakExtractionMinSimilarity: clampNumber(
          clusteringConfig.clustering_weak_extraction_min_similarity,
          DEFAULT_WEAK_EXTRACTION_MIN_SIMILARITY,
          0.6,
          0.999,
        ),
        weakExtractionStrongSimilarity: clampNumber(
          clusteringConfig.clustering_weak_extraction_strong_similarity,
          DEFAULT_WEAK_EXTRACTION_STRONG_SIMILARITY,
          0.7,
          0.999,
        ),
      };
      const publishSettings: ClusterPublishSettings = {
        minArticles: safeInteger(
          clusteringConfig.cluster_publish_min_articles,
          DEFAULT_CLUSTER_PUBLISH_MIN_ARTICLES,
          1,
          10,
        ),
        minSources: safeInteger(
          clusteringConfig.cluster_publish_min_sources,
          DEFAULT_CLUSTER_PUBLISH_MIN_SOURCES,
          1,
          10,
        ),
      };
      const topicSettings: TopicInferenceSettings = {
        minScore: clampNumber(
          clusteringConfig.topic_inference_min_score,
          DEFAULT_TOPIC_INFERENCE_MIN_SCORE,
          1,
          20,
        ),
        confidenceRatio: clampNumber(
          clusteringConfig.topic_inference_confidence_ratio,
          DEFAULT_TOPIC_INFERENCE_CONFIDENCE_RATIO,
          0.1,
          1,
        ),
        maxTopics: safeInteger(
          clusteringConfig.topic_inference_max_topics,
          DEFAULT_TOPIC_INFERENCE_MAX_TOPICS,
          1,
          5,
        ),
      };
      const vectorSearchLimit = safeInteger(
        clusteringConfig.clustering_vector_search_limit,
        VECTOR_SEARCH_LIMIT,
        1,
        80,
      );

      const budget = await getVectorSearchBudgetState(ctx);
      metrics.budgetAllowed = budget.allowed;
      metrics.batchArticles = articles.length;
      let useFallbackMode = !budget.allowed && budget.fallbackModeEnabled;
      metrics.usedFallbackMode = useFallbackMode;

      if (!budget.allowed && !budget.fallbackModeEnabled) {
        console.log(
          `[clustering] clusterEnrichedArticles skipped: vector-search budget exhausted (${budget.usedQgb}/${budget.dailyLimitQgb} qGB)`,
        );
        await flushJobMetrics(ctx, metrics, startedAt);
        return {
          clusteredIntoExisting: 0,
          createdEvents: 0,
          skipped: 0,
        };
      }

      const candidateSearchStart = Date.now();
      const candidateCache = new Map<string, ClusterCandidate>();
      let batchStateVersion = 0;
      const searchedArticleIds = new Set<string>();
      const representativeSearchCache = new Map<
        string,
        { embedding: number[]; candidates: ClusterCandidate[] }
      >();
      const articleBatchVersionSeen = new Map<string, number>();
      if (!useFallbackMode) {
        clusterRunReservationId = await reserveVectorSearchBatch(
          ctx,
          metrics,
          articles.length,
        );
        if (!clusterRunReservationId) {
          useFallbackMode = true;
          metrics.usedFallbackMode = true;
        }
      }
      if (useFallbackMode) {
        const fallbackCandidates = await ctx.runQuery(
          internal.clustering.getRecentClusterCandidates,
          {
            sinceTs: Date.now() - RECENT_EVENT_WINDOW_MS,
            limit: MAX_CANDIDATE_EVENTS,
          },
        );
        for (const candidate of fallbackCandidates as ClusterCandidateQueryResult[]) {
          candidateCache.set(
            String(candidate.eventId),
            hydrateClusterCandidate(candidate),
          );
        }
        metrics.candidateCacheSize = candidateCache.size;
      }
      const loadCandidatesForEmbedding = async (
        articleId: Id<"articles">,
        embedding: number[],
      ): Promise<ClusterCandidate[]> => {
        searchedArticleIds.add(String(articleId));

        let vectorResults: Array<{
          _id: Id<"eventEmbeddingHot">;
          _score: number;
        }>;
        vectorResults = await ctx.vectorSearch(
          "eventEmbeddingHot",
          "by_embedding",
          {
            vector: toEventEmbedding(embedding),
            limit: vectorSearchLimit,
          },
        );
        metrics.vectorSearches++;

        metrics.vectorMatchesReturned += vectorResults.length;

        if (vectorResults.length === 0) return [];

        const vectorCandidates = await ctx.runQuery(
          internal.clustering.getClusterCandidatesByHotEmbeddingMatches,
          {
            embeddingMatches: vectorResults.map((result) => ({
              hotEmbeddingId: result._id,
              similarity: result._score,
            })),
          },
        );
        metrics.vectorMatchesHydrated += vectorCandidates.length;
        metrics.vectorMatchesDiscardedPostFetch +=
          vectorResults.length - vectorCandidates.length;

        const matches: ClusterCandidate[] = [];
        for (const result of vectorCandidates as ClusterCandidateVectorResult[]) {
          const key = String(result.eventId);
          let candidate = candidateCache.get(key);
          if (!candidate) {
            candidate = hydrateClusterCandidate(result);
            candidateCache.set(key, candidate);
          }
          candidate.similarity = result.similarity;
          matches.push(candidate);
        }

        return matches;
      };

      const loadCandidatesForRepresentative = async (
        payload: AttachPayload,
        forceFresh = false,
      ): Promise<ClusterCandidate[]> => {
        // Reuse a prior article's vector-search results when this article is a
        // near-duplicate of an already-searched "representative". We pick the
        // single best (highest-similarity) representative above the strong
        // threshold so reuse is deterministic regardless of insertion order,
        // and we store the representative's embedding alongside its candidates
        // to avoid an O(n) lookup per comparison. Missing in-batch-created
        // events are still recovered by the pending-phase local matching below,
        // so this only trades a vector search for near-identical inputs.
        //
        // forceFresh skips reuse entirely: the forced-retry path runs precisely
        // because the batch state changed (new events were created), so a stale
        // representative result must not be returned there.
        const queryEmbedding = toEventEmbedding(payload.article.embedding);
        if (!forceFresh) {
          let bestCandidates: ClusterCandidate[] | null = null;
          let bestSimilarity = settings.strongSimilarity;
          for (const cached of representativeSearchCache.values()) {
            const similarity = cosineSimilarity(queryEmbedding, cached.embedding);
            if (similarity >= bestSimilarity) {
              bestSimilarity = similarity;
              bestCandidates = cached.candidates;
            }
          }
          if (bestCandidates) {
            return bestCandidates;
          }
        }
        const matches = await loadCandidatesForEmbedding(
          payload.article._id,
          payload.paddedEmbedding,
        );
        representativeSearchCache.set(String(payload.article._id), {
          embedding: queryEmbedding,
          candidates: matches,
        });
        return matches;
      };

      let clusteredIntoExisting = 0;
      let createdEvents = 0;
      let skipped = 0;
      type AttachPayload = {
        article: (typeof articles)[number];
        paddedEmbedding: number[];
        topicSlugs: string[];
      };
      type PendingArticle = AttachPayload & {
        seedRank: {
          extractionRank: number;
          entityTokenCount: number;
          titleLength: number;
          publishedAt: number;
          id: string;
        };
        lastBatchStateVersionSeen: number;
        needsFreshVectorSearch: boolean;
      };
      const pendingArticles: PendingArticle[] = [];

      const applyCandidateUpdate = (
        candidate: ClusterCandidate,
        article: (typeof articles)[number],
        topicSlugs: string[],
        result: {
          embedding: number[];
          articleCount: number;
          firstPublishedAt: number;
        },
      ) => {
        candidate.embedding = result.embedding;
        candidate.articleCount = result.articleCount;
        candidate.firstPublishedAt = result.firstPublishedAt;
        candidate.lastArticleAt = Math.max(
          candidate.lastArticleAt ?? candidate.firstPublishedAt,
          article.publishedAt,
        );
        candidate.sourceIds.add(article.sourceId);
        candidate.sourceCount = candidate.sourceIds.size;
        candidate.evidenceTokens = mergeTokenSets(
          candidate.evidenceTokens,
          buildArticleEvidenceTokens(article),
        );
        candidate.factTokens = mergeTokenSets(
          candidate.factTokens,
          buildArticleFactTokens(article),
        );
        candidate.entityTokens = mergeTokenSets(
          candidate.entityTokens,
          buildArticleEntityTokens(candidate.title, article),
        );
        for (const topicSlug of topicSlugs) {
          candidate.topicSlugs.add(topicSlug);
        }
        batchStateVersion++;
      };

      const resolveArticle = (
        article: (typeof articles)[number],
        topicSlugs: string[],
      ) => ({
        articleId: article._id,
        title: article.title,
        rssSnippet: article.rssSnippet,
        summary: article.summary,
        atomicFacts: article.atomicFacts,
        entities: article.entities,
        topicSlugs,
        extractionQuality: article.extractionQuality,
        publishedAt: article.publishedAt,
        embedding: article.embedding,
        sourceId: article.sourceId,
      });

      const attachToMatch = async (
        payload: AttachPayload,
        match: ClusterCandidate,
      ): Promise<"attached" | "skipped"> => {
        const { article, paddedEmbedding, topicSlugs } = payload;
        const result = await ctx.runMutation(
          internal.clustering.attachArticleToEvent,
          {
            articleId: article._id,
            eventId: match.eventId,
            publishedAt: article.publishedAt,
            eventEmbedding: paddedEmbedding,
            version: 1,
            topicSlugs,
          },
        );

        if (!result.updated) {
          skipped++;
          return "skipped";
        }

        clusteredIntoExisting++;

        const candidate = candidateCache.get(String(match.eventId));
        if (candidate) {
          applyCandidateUpdate(candidate, article, topicSlugs, result);
        }

        return "attached";
      };

      const tryBatchLocalAttach = async (
        payload: AttachPayload,
        heuristicOnly = false,
      ): Promise<"attached" | "unmatched" | "skipped"> => {
        const { article, topicSlugs } = payload;
        const candidatePool = Array.from(candidateCache.values());
        if (candidatePool.length === 0) return "unmatched";

        const articleContext = resolveArticle(article, topicSlugs);
        const match = heuristicOnly
          ? findHeuristicCandidate(articleContext, candidatePool)
          : findBatchLocalCandidate(articleContext, candidatePool, settings);
        if (!match) return "unmatched";
        return await attachToMatch(payload, match);
      };

      const tryVectorAttach = async (
        payload: AttachPayload,
        forceFresh = false,
      ): Promise<"attached" | "unmatched" | "skipped"> => {
        const { article, topicSlugs } = payload;
        const candidates = await loadCandidatesForRepresentative(
          payload,
          forceFresh,
        );
        const match = findBestCandidate(
          resolveArticle(article, topicSlugs),
          candidates,
          settings,
        );
        if (!match) return "unmatched";
        return await attachToMatch(payload, match);
      };

      for (const article of articles) {
        const paddedEmbedding = toEventEmbedding(article.embedding);
        const topicSlugs = inferTopicSlugs(
          {
            title: article.title,
            rssSnippet: article.rssSnippet,
            summary: article.summary,
            atomicFacts: article.atomicFacts,
            entities: article.entities,
            extractionQuality: article.extractionQuality,
          },
          topicsForInference,
          topicSettings,
        );
        const payload: AttachPayload = {
          article,
          paddedEmbedding,
          topicSlugs,
        };
        const outcome = useFallbackMode
          ? await tryBatchLocalAttach(payload)
          : await tryVectorAttach(payload);
        if (outcome === "unmatched") {
          const entityTokenCount = extractEntityTokens(
            article.title,
            article.rssSnippet,
            article.summary,
            article.entities.join(" "),
            article.atomicFacts.join(" "),
          ).size;
          pendingArticles.push({
            ...payload,
            seedRank: {
              extractionRank: article.extractionQuality === "strong" ? 2 : 1,
              entityTokenCount,
              titleLength: article.title.length,
              publishedAt: article.publishedAt,
              id: String(article._id),
            },
            lastBatchStateVersionSeen: batchStateVersion,
            needsFreshVectorSearch: false,
          });
          articleBatchVersionSeen.set(String(article._id), batchStateVersion);
        }
      }

      pendingArticles.sort(
        (a, b) =>
          b.seedRank.extractionRank - a.seedRank.extractionRank ||
          b.seedRank.entityTokenCount - a.seedRank.entityTokenCount ||
          b.seedRank.titleLength - a.seedRank.titleLength ||
          b.seedRank.publishedAt - a.seedRank.publishedAt ||
          a.seedRank.id.localeCompare(b.seedRank.id),
      );

      for (const pending of pendingArticles) {
        let outcome = await tryBatchLocalAttach(pending);
        if (outcome !== "unmatched") continue;

        const pendingKey = String(pending.article._id);
        const lastSeenVersion =
          articleBatchVersionSeen.get(pendingKey) ??
          pending.lastBatchStateVersionSeen;
        const batchChanged = batchStateVersion > lastSeenVersion;
        if (!useFallbackMode && batchChanged) {
          pending.needsFreshVectorSearch = true;
        }
        articleBatchVersionSeen.set(pendingKey, batchStateVersion);

        if (!useFallbackMode && pending.needsFreshVectorSearch) {
          outcome = await tryVectorAttach(pending, true);
          pending.needsFreshVectorSearch = false;
          pending.lastBatchStateVersionSeen = batchStateVersion;
        }

        if (outcome !== "unmatched") continue;

        const { article, paddedEmbedding, topicSlugs } = pending;

        const slug = buildEventSlug(
          article.title,
          article.publishedAt,
          article._id,
        );
        const centerSummary =
          article.rssSnippet.trim().length > 0
            ? article.rssSnippet.trim().slice(0, 280)
            : undefined;

        const result = await ctx.runMutation(
          internal.clustering.createEventFromArticle,
          {
            articleId: article._id,
            title: article.title,
            slug,
            publishedAt: article.publishedAt,
            centerSummary,
            eventEmbedding: paddedEmbedding,
            version: 1,
            topicSlugs,
            initialStatus: shouldPublishCluster(1, 1, publishSettings)
              ? "published"
              : "processing",
          },
        );

        if (!result.created) {
          skipped++;
          continue;
        }

        createdEvents++;
        const newCandidate: ClusterCandidate = {
          eventId: result.eventId,
          embeddingId: result.embeddingId,
          hotEmbeddingId: result.hotEmbeddingId,
          title: result.title,
          slug: result.slug,
          firstPublishedAt: result.firstPublishedAt,
          lastArticleAt: result.firstPublishedAt,
          articleCount: result.articleCount,
          sourceCount: 1,
          embedding: result.embedding,
          titleTokens: normalizeTitleTokens(result.title),
          evidenceTokens: mergeTokenSets(
            normalizeTitleTokens(article.rssSnippet),
            normalizeTitleTokens(article.summary),
          ),
          factTokens: normalizeTitleTokens(article.atomicFacts.join(" ")),
          entityTokens: extractEntityTokens(
            article.title,
            article.rssSnippet,
            article.summary,
            article.entities.join(" "),
            article.atomicFacts.join(" "),
          ),
          topicSlugs: new Set(topicSlugs),
          sourceIds: new Set([article.sourceId]),
          perspectiveSummaries: centerSummary
            ? { neutral: centerSummary }
            : undefined,
          perspectiveSource: centerSummary ? "heuristic" : undefined,
          globalImpact: undefined,
          imageUrl: undefined,
          creationTime: Date.now(),
        };
        candidateCache.set(String(result.eventId), newCandidate);
        batchStateVersion++;
      }

      markStageDuration(metrics, "candidateSearch", candidateSearchStart);
      metrics.candidateCacheSize = candidateCache.size;
      metrics.vectorSearchesPerArticle =
        articles.length > 0 ? metrics.vectorSearches / articles.length : 0;
      console.log(
        `[clustering] Candidate search: ${metrics.vectorSearches} queries, ${metrics.vectorMatchesReturned} matches, ${candidateCache.size} unique`,
      );
      console.log(
        `[clustering] Done: ${clusteredIntoExisting} attached, ${createdEvents} new events, ${skipped} skipped (minSim=${settings.minSimilarity}, strongSim=${settings.strongSimilarity}, sameSourceMinSim=${settings.sameSourceMinSimilarity}, publishMin=${publishSettings.minArticles} articles/${publishSettings.minSources} sources, topicMinScore=${topicSettings.minScore})`,
      );
      if (clusterRunReservationId) {
        await consumeVectorSearchBatchReservation(
          ctx,
          metrics,
          clusterRunReservationId,
        );
        clusterRunReservationSettled = true;
      }
      await flushJobMetrics(ctx, metrics, startedAt);
      if (clusteredIntoExisting + createdEvents > 0) {
        await ctx.scheduler.runAfter(
          MERGE_NEAR_DUPLICATES_DELAY_MS,
          internal.clustering.mergeNearDuplicateEvents,
          {},
        );
      }
      if (createdEvents > 0) {
        await ctx.scheduler.runAfter(
          RECLUSTER_RECENT_SINGLETONS_DELAY_MS,
          internal.clustering.reclusterRecentSingletonEvents,
          {},
        );
      }
      // Events publish only after a summary, so kick summarization immediately
      // after a clustering batch instead of waiting up to 45 min for the cron —
      // any event that just crossed the summary/publish bar gets its perspective
      // summaries + globalImpact (and goes public) as soon as possible.
      if (clusteredIntoExisting + createdEvents > 0) {
        await ctx.scheduler.runAfter(
          0,
          internal.summarizationNode.summarizeQueuedEvents,
          {},
        );
      }

      return {
        clusteredIntoExisting,
        createdEvents,
        skipped,
      };
    } finally {
      if (clusterRunReservationId && !clusterRunReservationSettled) {
        try {
          if (metrics.vectorSearches > 0) {
            // Searches completed before an error aborted the run; settle the
            // actual usage instead of releasing so budget accounting is not
            // undercounted.
            await consumeVectorSearchBatchReservation(
              ctx,
              metrics,
              clusterRunReservationId,
            );
          } else {
            await releaseVectorSearchReservation(ctx, clusterRunReservationId);
          }
        } catch (error) {
          console.error(
            `[clustering] Failed to settle cluster vector reservation: ${error instanceof Error ? error.message : "Unknown error"}`,
          );
        }
      }
      try {
        await ctx.runMutation(internal.ingestion.releasePipelineLock, {
          key: CLUSTER_LOCK_KEY,
          owner: lockOwner,
        });
      } catch (error) {
        console.error(
          `[clustering] Failed to release cluster lock: ${error instanceof Error ? error.message : "Unknown error"}`,
        );
      }
    }
  },
});
