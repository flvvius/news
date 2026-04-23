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

import { v } from "convex/values";
import {
  internalAction,
  internalMutation,
  internalQuery,
  query,
} from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { authComponent } from "./auth";
import type { MutationCtx } from "./_generated/server";
import { getConfig } from "./config";

const CLUSTER_LOCK_KEY = "clusterEnrichedArticles";
const CLUSTER_LOCK_TTL_MS = 20 * 60 * 1000;
const MERGE_LOCK_KEY = "mergeNearDuplicateEvents";
const MERGE_LOCK_TTL_MS = 20 * 60 * 1000;
const CLUSTER_BATCH_SIZE = 40;
const RECENT_EVENT_WINDOW_MS = 72 * 60 * 60 * 1000;
const MAX_CANDIDATE_EVENTS = 150;
const EVENT_EMBEDDING_DIMENSIONS = 1536;
const DEFAULT_MIN_CLUSTER_SIMILARITY = 0.82;
const DEFAULT_STRONG_CLUSTER_SIMILARITY = 0.9;
const DEFAULT_MIN_TITLE_TOKEN_OVERLAP = 2;
const DEFAULT_MIN_TITLE_JACCARD = 0.2;
const DEFAULT_SAME_SOURCE_MIN_SIMILARITY = 0.9;
const DEFAULT_TOPIC_INFERENCE_MIN_SCORE = 4.5;
const DEFAULT_TOPIC_INFERENCE_CONFIDENCE_RATIO = 0.55;
const DEFAULT_TOPIC_INFERENCE_MAX_TOPICS = 3;
const DEFAULT_MERGE_MIN_SIMILARITY = 0.94;
const DEFAULT_MERGE_MIN_TITLE_JACCARD = 0.45;
const DEFAULT_MERGE_MAX_TIME_DELTA_HOURS = 24;

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
]);

function toEventEmbedding(articleEmbedding: number[]): number[] {
  const padded = new Array(EVENT_EMBEDDING_DIMENSIONS).fill(0);
  const limit = Math.min(articleEmbedding.length, EVENT_EMBEDDING_DIMENSIONS);
  for (let i = 0; i < limit; i++) {
    padded[i] = articleEmbedding[i]!;
  }
  return padded;
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
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeTitleTokens(text: string): Set<string> {
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

function slugify(value: string): string {
  const slug = value
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
  const suffix = String(articleId).replace(/[^a-zA-Z0-9]/g, "").slice(-6);
  return `${slugify(title)}-${ymd}-${suffix}`.toLowerCase();
}

type ClusterCandidate = {
  eventId: Id<"events">;
  title: string;
  slug: string;
  firstPublishedAt: number;
  articleCount: number;
  embedding: number[];
  titleTokens: Set<string>;
  sourceIds: Set<string>;
  perspectiveSummaries?: {
    center?: string;
    left?: string;
    right?: string;
  };
  globalImpact?: string;
  imageUrl?: string;
  creationTime: number;
};

type ClusterSettings = {
  minSimilarity: number;
  strongSimilarity: number;
  minTitleTokenOverlap: number;
  minTitleJaccard: number;
  sameSourceMinSimilarity: number;
};

type TopicInferenceSettings = {
  minScore: number;
  confidenceRatio: number;
  maxTopics: number;
};

type MergeSettings = {
  minSimilarity: number;
  minTitleJaccard: number;
  maxTimeDeltaHours: number;
};

type TopicInferenceTopic = Pick<
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

type TopicArticleContext = {
  title: string;
  rssSnippet: string;
  summary: string;
  atomicFacts: string[];
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

type TopicInferenceCandidate = {
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

function safeInteger(value: unknown, fallback: number, min: number, max: number) {
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

function countMatchedKeywords(tokens: Set<string>, keywordTokens: string[]): number {
  let matches = 0;
  for (const token of keywordTokens) {
    if (tokens.has(token)) {
      matches++;
    }
  }
  return matches;
}

function buildTopicFieldContexts(article: TopicArticleContext): TopicInferenceFieldContexts {
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
      [topic.displayName, topic.slug.replace(/-/g, " "), ...aliases, ...keyPhrases]
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

function evaluateTopicInference(
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
        (sum, phrase) => sum + countPhraseOccurrences(fields.title.text, phrase),
        0,
      );
      const snippetPhraseHits = topic.bodyPhrases.reduce(
        (sum, phrase) => sum + countPhraseOccurrences(fields.snippet.text, phrase),
        0,
      );
      const summaryPhraseHits = topic.bodyPhrases.reduce(
        (sum, phrase) => sum + countPhraseOccurrences(fields.summary.text, phrase),
        0,
      );
      const factPhraseHits = topic.bodyPhrases.reduce(
        (sum, phrase) => sum + countPhraseOccurrences(fields.facts.text, phrase),
        0,
      );
      const excludeHits = topic.excludePhrases.reduce(
        (sum, phrase) => sum + countPhraseOccurrences(fields.combined.text, phrase),
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

function inferTopicSlugs(
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
  const center = preferLongerString(
    primary.perspectiveSummaries?.center,
    secondary.perspectiveSummaries?.center,
  );
  const left = preferLongerString(
    primary.perspectiveSummaries?.left,
    secondary.perspectiveSummaries?.left,
  );
  const right = preferLongerString(
    primary.perspectiveSummaries?.right,
    secondary.perspectiveSummaries?.right,
  );

  if (!center && !left && !right) return undefined;
  return { center, left, right };
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

function summarizeText(text: string | undefined, maxLength: number): string | undefined {
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
  const trimmed = (lastBoundary > maxLength * 0.55 ? slice.slice(0, lastBoundary) : slice)
    .trim()
    .replace(/[,:;.\s]+$/g, "");
  return `${trimmed}.`;
}

function articlePresentationScore(
  article: Pick<Doc<"articles">, "title" | "rssSnippet" | "publishedAt" | "sourceId">,
  source: Doc<"sources"> | null,
  eventTitleTokens: Set<string>,
): number {
  const titleTokens = normalizeTitleTokens(article.title);
  const snippetTokens = normalizeTitleTokens(article.rssSnippet ?? "");
  const titleOverlap = countTokenOverlap(titleTokens, eventTitleTokens);
  const snippetOverlap = countTokenOverlap(snippetTokens, eventTitleTokens);
  const reliability = source?.reliabilityScore ?? 5;
  const biasDistance = Math.abs(source?.baseBias ?? 0);

  return (
    titleOverlap * 3 +
    snippetOverlap * 1.5 +
    reliability * 0.35 -
    biasDistance * 0.1 +
    article.publishedAt / 1_000_000_000_000
  );
}

async function refreshEventPresentation(
  ctx: MutationCtx,
  eventId: Id<"events">,
): Promise<void> {
  const event = await ctx.db.get(eventId);
  if (!event) return;

  const articles = await ctx.db
    .query("articles")
    .withIndex("by_event", (q) => q.eq("eventId", eventId))
    .collect();
  if (articles.length === 0) return;

  const eventTitleTokens = normalizeTitleTokens(event.title);
  const articlesWithSources = await Promise.all(
    articles.map(async (article) => ({
      article,
      source: await ctx.db.get(article.sourceId),
    })),
  );

  const ranked = [...articlesWithSources].sort(
    (a, b) =>
      articlePresentationScore(b.article, b.source, eventTitleTokens) -
      articlePresentationScore(a.article, a.source, eventTitleTokens),
  );
  const best = ranked[0]!;
  const uniqueSources = new Set(
    articlesWithSources.map(({ source, article }) => source?.name ?? String(article.sourceId)),
  );

  const representativeSnippet =
    summarizeText(best.article.rssSnippet, 220) ??
    summarizeText(best.article.title, 160) ??
    "Coverage is still being assembled from multiple sources.";

  const coverageLine =
    uniqueSources.size > 1
      ? `This cluster currently includes ${articles.length} articles from ${uniqueSources.size} sources.`
      : `This cluster currently includes ${articles.length} article${articles.length === 1 ? "" : "s"}.`;

  const centerSummary = summarizeText(
    `${representativeSnippet} ${coverageLine}`,
    280,
  );

  const sourceNames = Array.from(uniqueSources).slice(0, 3);
  const sourceLine =
    sourceNames.length > 0
      ? `Sources in this event include ${sourceNames.join(", ")}${uniqueSources.size > sourceNames.length ? ", and others" : ""}.`
      : undefined;
  const globalImpact = summarizeText(
    `${coverageLine} ${sourceLine ?? ""}`.trim(),
    180,
  );

  await ctx.db.patch(eventId, {
    perspectiveSummaries: centerSummary
      ? {
          center: centerSummary,
          left: event.perspectiveSummaries?.left,
          right: event.perspectiveSummaries?.right,
        }
      : event.perspectiveSummaries,
    globalImpact,
  });
}

function findBestCandidate(
  article: {
    title: string;
    publishedAt: number;
    embedding: number[];
    sourceId: Id<"sources">;
  },
  candidates: ClusterCandidate[],
  settings: ClusterSettings,
): ClusterCandidate | null {
  const articleEmbedding = toEventEmbedding(article.embedding);
  const articleTokens = normalizeTitleTokens(article.title);

  let best: { candidate: ClusterCandidate; score: number } | null = null;

  for (const candidate of candidates) {
    const timeDeltaMs = Math.abs(article.publishedAt - candidate.firstPublishedAt);
    if (timeDeltaMs > RECENT_EVENT_WINDOW_MS) {
      continue;
    }

    const similarity = cosineSimilarity(articleEmbedding, candidate.embedding);
    const overlap = countTokenOverlap(articleTokens, candidate.titleTokens);
    const titleJaccard = jaccardSimilarity(articleTokens, candidate.titleTokens);
    const sameSource = candidate.sourceIds.has(String(article.sourceId));

    const baseMatch =
      similarity >= settings.strongSimilarity ||
      (similarity >= settings.minSimilarity &&
        overlap >= settings.minTitleTokenOverlap &&
        titleJaccard >= settings.minTitleJaccard);

    const sameSourceMatch = sameSource
      ? similarity >= settings.sameSourceMinSimilarity &&
        overlap >= settings.minTitleTokenOverlap &&
        titleJaccard >= settings.minTitleJaccard
      : true;

    if (!baseMatch || !sameSourceMatch) continue;

    const recencyScore = 1 - timeDeltaMs / RECENT_EVENT_WINDOW_MS;
    const overlapScore =
      Math.min(overlap, settings.minTitleTokenOverlap + 3) / 10;
    const score =
      similarity * 0.72 +
      titleJaccard * 0.18 +
      recencyScore * 0.08 +
      overlapScore * 0.02;

    if (!best || score > best.score) {
      best = { candidate, score };
    }
  }

  return best?.candidate ?? null;
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

async function requireAdminUser(ctx: Parameters<typeof authComponent.safeGetAuthUser>[0]) {
  const adminEmails = (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
  const currentUser = await authComponent.safeGetAuthUser(ctx);

  if (!currentUser) {
    throw new Error("Not authenticated");
  }
  if (!adminEmails.includes(currentUser.email.toLowerCase())) {
    throw new Error("Unauthorized: admin access required");
  }

  return currentUser;
}

function buildEventTopicInferenceContext(
  event: Pick<Doc<"events">, "title">,
  articles: Array<
    Pick<Doc<"articles">, "rssSnippet" | "summary" | "atomicFacts" | "publishedAt">
  >,
): TopicArticleContext {
  const sortedArticles = [...articles].sort((a, b) => b.publishedAt - a.publishedAt);
  const topArticles = sortedArticles.slice(0, 6);

  return {
    title: event.title,
    rssSnippet: topArticles
      .map((article) => article.rssSnippet?.trim())
      .filter(Boolean)
      .slice(0, 4)
      .join(" "),
    summary: topArticles
      .map((article) => article.summary?.trim())
      .filter(Boolean)
      .slice(0, 4)
      .join(" "),
    atomicFacts: topArticles.flatMap((article) => article.atomicFacts ?? []).slice(0, 24),
  };
}

export const getEnrichedArticlesForClustering = internalQuery({
  args: { limit: v.number() },
  handler: async (ctx, { limit }) => {
    const articles = await ctx.db
      .query("articles")
      .withIndex("by_status", (q) => q.eq("status", "enriched"))
      .take(limit);

    const enriched = (
      await Promise.all(
        articles.map(async (article) => {
          const embeddingRow = await ctx.db
            .query("articleEmbeddings")
            .withIndex("by_article", (q) => q.eq("articleId", article._id))
            .first();

          if (!embeddingRow) {
            console.warn(
              `[clustering] Missing embedding for enriched article ${article._id}; skipping`,
            );
            return null;
          }

          return {
            _id: article._id,
            title: article.title,
            rssSnippet: article.rssSnippet ?? "",
            summary: article.summary ?? "",
            atomicFacts: article.atomicFacts ?? [],
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

export const getRecentClusterCandidates = internalQuery({
  args: {
    sinceTs: v.number(),
    limit: v.number(),
  },
  handler: async (ctx, { sinceTs, limit }) => {
    const events = await ctx.db
      .query("events")
      .withIndex("by_status_recency", (q) => q.eq("status", "published"))
      .order("desc")
      .take(limit);

    const candidates = (
      await Promise.all(
        events
          .filter((event) => event.firstPublishedAt >= sinceTs)
          .map(async (event) => {
            const embeddingRow = await ctx.db
              .query("eventEmbeddings")
              .withIndex("by_event", (q) => q.eq("eventId", event._id))
              .first();

            if (!embeddingRow) return null;

            const articleCount = (
              await ctx.db
                .query("articles")
                .withIndex("by_event", (q) => q.eq("eventId", event._id))
                .collect()
            ).length;
            const sourceIds = (
              await ctx.db
                .query("articles")
                .withIndex("by_event", (q) => q.eq("eventId", event._id))
                .collect()
            ).map((article) => String(article.sourceId));

            return {
              eventId: event._id,
              title: event.title,
              slug: event.slug,
              firstPublishedAt: event.firstPublishedAt,
              articleCount,
              embedding: embeddingRow.embedding,
              sourceIds,
              perspectiveSummaries: event.perspectiveSummaries,
              globalImpact: event.globalImpact,
              imageUrl: event.imageUrl,
              creationTime: event._creationTime,
            };
          }),
      )
    ).filter((candidate) => candidate !== null);

    return candidates;
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
        ? { center: centerSummary }
        : undefined,
      status: "published",
      firstPublishedAt: publishedAt,
    });

    await ctx.db.insert("eventEmbeddings", {
      eventId,
      embedding: eventEmbedding,
      version,
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

    await refreshEventPresentation(ctx, eventId);

    return {
      created: true as const,
      eventId,
      title,
      slug,
      firstPublishedAt: publishedAt,
      articleCount: 1,
      embedding: eventEmbedding,
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

    const existingArticles = await ctx.db
      .query("articles")
      .withIndex("by_event", (q) => q.eq("eventId", eventId))
      .collect();
    const currentCount = existingArticles.length;

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
        ? existingEmbeddingRow.embedding.map(
            (value, index) =>
              (value * currentCount + (eventEmbedding[index] ?? 0)) /
              (currentCount + 1),
          )
        : eventEmbedding;

    if (existingEmbeddingRow) {
      await ctx.db.patch(existingEmbeddingRow._id, {
        embedding: nextEmbedding,
        version,
      });
    } else {
      await ctx.db.insert("eventEmbeddings", {
        eventId,
        embedding: nextEmbedding,
        version,
      });
    }

    const nextFirstPublishedAt = Math.min(event.firstPublishedAt, publishedAt);
    if (nextFirstPublishedAt !== event.firstPublishedAt) {
      await ctx.db.patch(eventId, {
        firstPublishedAt: nextFirstPublishedAt,
      });
    }

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

    await refreshEventPresentation(ctx, eventId);

    return {
      updated: true as const,
      eventId,
      title: event.title,
      slug: event.slug,
      firstPublishedAt: nextFirstPublishedAt,
      articleCount: currentCount + 1,
      embedding: nextEmbedding,
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
          await Promise.all(eventTopicRows.map((row) => ctx.db.get(row.topicId)))
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
              .withIndex("by_article", (q) => q.eq("articleId", article._id))
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
            embeddingDimensions: articleEmbeddings[index]?.embedding.length ?? 0,
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
    const [topicsForInference, settings] = await Promise.all([
      ctx.db.query("topics").collect(),
      getTopicInferenceSettingsForQuery(ctx),
    ]);
    const topicBySlug = new Map(topicsForInference.map((topic) => [topic.slug, topic]));

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
          await Promise.all(eventTopicRows.map((row) => ctx.db.get(row.topicId)))
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
        const inferredSlugs = inferTopicSlugs(context, topicsForInference, settings);

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
        center: v.optional(v.string()),
        left: v.optional(v.string()),
        right: v.optional(v.string()),
      }),
    ),
    mergedGlobalImpact: v.optional(v.string()),
    mergedImageUrl: v.optional(v.string()),
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
      mergedGlobalImpact,
      mergedImageUrl,
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

    const removeArticles = await ctx.db
      .query("articles")
      .withIndex("by_event", (q) => q.eq("eventId", removeEventId))
      .collect();
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

    const allInsights = await ctx.db.query("userInsights").collect();
    const sourceInsights = allInsights.filter(
      (insight) => insight.eventId === removeEventId,
    );
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

    const keepEmbeddingRow = await ctx.db
      .query("eventEmbeddings")
      .withIndex("by_event", (q) => q.eq("eventId", keepEventId))
      .first();
    if (keepEmbeddingRow) {
      await ctx.db.patch(keepEmbeddingRow._id, {
        embedding: mergedEmbedding,
        version,
      });
    } else {
      await ctx.db.insert("eventEmbeddings", {
        eventId: keepEventId,
        embedding: mergedEmbedding,
        version,
      });
    }

    const removeEmbeddingRows = await ctx.db
      .query("eventEmbeddings")
      .withIndex("by_event", (q) => q.eq("eventId", removeEventId))
      .collect();
    for (const row of removeEmbeddingRows) {
      await ctx.db.delete(row._id);
    }

    await ctx.db.patch(keepEventId, {
      title: mergedTitle,
      firstPublishedAt: mergedFirstPublishedAt,
      perspectiveSummaries: mergedPerspectiveSummaries,
      globalImpact: mergedGlobalImpact,
      imageUrl: mergedImageUrl,
    });

    await refreshEventPresentation(ctx, keepEventId);

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
        `[clustering] mergeNearDuplicateEvents already running (owner=${lock.owner}, expiresAt=${new Date(lock.expiresAt).toISOString()})`,
      );
      return { mergedPairs: 0, examinedPairs: 0, skipped: 0 };
    }

    try {
      const recentCandidatesRaw = await ctx.runQuery(
        internal.clustering.getRecentClusterCandidates,
        {
          sinceTs: Date.now() - RECENT_EVENT_WINDOW_MS,
          limit: MAX_CANDIDATE_EVENTS,
        },
      );

      const mergeConfig = await ctx.runQuery(internal.config.getBatch, {
        keys: [
          "merge_min_similarity",
          "merge_min_title_jaccard",
          "merge_max_time_delta_hours",
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

      const candidates: ClusterCandidate[] = recentCandidatesRaw.map(
        (candidate) => ({
          ...candidate,
          titleTokens: normalizeTitleTokens(candidate.title),
          sourceIds: new Set(candidate.sourceIds),
        }),
      );

      const removedIds = new Set<string>();
      let mergedPairs = 0;
      let examinedPairs = 0;
      let skipped = 0;

      for (let i = 0; i < candidates.length; i++) {
        const a = candidates[i]!;
        if (removedIds.has(String(a.eventId))) continue;

        for (let j = i + 1; j < candidates.length; j++) {
          const b = candidates[j]!;
          if (removedIds.has(String(b.eventId))) continue;

          examinedPairs++;

          const timeDeltaHours =
            Math.abs(a.firstPublishedAt - b.firstPublishedAt) / (60 * 60 * 1000);
          if (timeDeltaHours > settings.maxTimeDeltaHours) {
            continue;
          }

          const similarity = cosineSimilarity(a.embedding, b.embedding);
          const titleJaccard = jaccardSimilarity(a.titleTokens, b.titleTokens);
          if (
            similarity < settings.minSimilarity ||
            titleJaccard < settings.minTitleJaccard
          ) {
            continue;
          }

          const { keep, remove } = chooseCanonicalEvent(a, b);
          const totalArticles = keep.articleCount + remove.articleCount;
          const mergedEmbedding = keep.embedding.map(
            (value, index) =>
              (value * keep.articleCount +
                (remove.embedding[index] ?? 0) * remove.articleCount) /
              Math.max(totalArticles, 1),
          );
          const mergedPerspectiveSummaries = buildMergedPerspectiveSummaries(
            keep,
            remove,
          );
          const mergedGlobalImpact = preferLongerString(
            keep.globalImpact,
            remove.globalImpact,
          );
          const mergedImageUrl = keep.imageUrl ?? remove.imageUrl;
          const mergedTitle =
            preferLongerString(keep.title, remove.title) ?? keep.title;

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
            mergedGlobalImpact,
            mergedImageUrl,
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
          keep.title = mergedTitle;
          keep.titleTokens = normalizeTitleTokens(mergedTitle);
          keep.perspectiveSummaries = mergedPerspectiveSummaries;
          keep.globalImpact = mergedGlobalImpact;
          keep.imageUrl = mergedImageUrl;
          for (const sourceId of remove.sourceIds) {
            keep.sourceIds.add(sourceId);
          }
        }
      }

      console.log(
        `[clustering] Merge pass complete: ${mergedPairs} merged, ${examinedPairs} pairs examined, ${skipped} skipped`,
      );

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

    try {
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

      const recentCandidatesRaw = await ctx.runQuery(
        internal.clustering.getRecentClusterCandidates,
        {
          sinceTs: Date.now() - RECENT_EVENT_WINDOW_MS,
          limit: MAX_CANDIDATE_EVENTS,
        },
      );

      const topicsForInference = await ctx.runQuery(
        internal.topics.getTopicsForInference,
        {},
      );

      const clusteringConfig = await ctx.runQuery(internal.config.getBatch, {
        keys: [
          "clustering_min_similarity",
          "clustering_strong_similarity",
          "clustering_min_title_overlap",
          "clustering_min_title_jaccard",
          "clustering_same_source_min_similarity",
          "topic_inference_min_score",
          "topic_inference_confidence_ratio",
          "topic_inference_max_topics",
        ],
      });

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

      const candidates: ClusterCandidate[] = recentCandidatesRaw.map(
        (candidate) => ({
          ...candidate,
          titleTokens: normalizeTitleTokens(candidate.title),
          sourceIds: new Set(candidate.sourceIds),
        }),
      );

      let clusteredIntoExisting = 0;
      let createdEvents = 0;
      let skipped = 0;

      for (const article of articles) {
        const paddedEmbedding = toEventEmbedding(article.embedding);
        const topicSlugs = inferTopicSlugs(
          {
            title: article.title,
            rssSnippet: article.rssSnippet,
            summary: article.summary,
            atomicFacts: article.atomicFacts,
          },
          topicsForInference,
          topicSettings,
        );
        const match = findBestCandidate(article, candidates, settings);

        if (match) {
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
            continue;
          }

          clusteredIntoExisting++;

          const candidate = candidates.find((c) => c.eventId === match.eventId);
          if (candidate) {
            candidate.embedding = result.embedding;
            candidate.articleCount = result.articleCount;
            candidate.firstPublishedAt = result.firstPublishedAt;
            candidate.sourceIds.add(String(article.sourceId));
          }
          continue;
        }

        const slug = buildEventSlug(article.title, article.publishedAt, article._id);
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
          },
        );

        if (!result.created) {
          skipped++;
          continue;
        }

        createdEvents++;
        candidates.unshift({
          eventId: result.eventId,
          title: result.title,
          slug: result.slug,
          firstPublishedAt: result.firstPublishedAt,
          articleCount: result.articleCount,
          embedding: result.embedding,
          titleTokens: normalizeTitleTokens(result.title),
          sourceIds: new Set([String(article.sourceId)]),
          perspectiveSummaries: centerSummary
            ? { center: centerSummary }
            : undefined,
          globalImpact: undefined,
          imageUrl: undefined,
          creationTime: Date.now(),
        });
      }

      console.log(
        `[clustering] Done: ${clusteredIntoExisting} attached, ${createdEvents} new events, ${skipped} skipped (minSim=${settings.minSimilarity}, strongSim=${settings.strongSimilarity}, sameSourceMinSim=${settings.sameSourceMinSimilarity}, topicMinScore=${topicSettings.minScore})`,
      );

      return {
        clusteredIntoExisting,
        createdEvents,
        skipped,
      };
    } finally {
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
