import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import {
  namedAxisBiasValidator,
  perspectiveSummariesValidator,
} from "./lib/biasAxis";

const pipelineMetricValue = v.union(
  v.string(),
  v.number(),
  v.boolean(),
  v.null(),
);

const pipelineGaugeValue = v.union(
  pipelineMetricValue,
  v.array(
    v.object({
      key: v.string(),
      owner: v.string(),
      expiresAt: v.number(),
    }),
  ),
);

const pipelineMetadataValue = v.union(
  pipelineMetricValue,
  v.record(v.string(), v.number()),
);

export default defineSchema({
  // =========================================================================
  // 1. TOPICS (Normalized Taxonomy)
  // =========================================================================
  topics: defineTable({
    slug: v.string(),
    displayName: v.string(),
    description: v.optional(v.string()),
    aliases: v.optional(v.array(v.string())),
    keywords: v.optional(v.array(v.string())),
    keyPhrases: v.optional(v.array(v.string())),
    excludePhrases: v.optional(v.array(v.string())),
  }).index("by_slug", ["slug"]),

  // =========================================================================
  // 2. SOURCES (Reputation Layer)
  // =========================================================================
  sources: defineTable({
    domain: v.string(), // "digi24.ro"
    name: v.string(), // "Digi24"
    // Canonical named-axis bias (BIV-302); baseBias is the derived
    // single-score mirror consumed by the UI and must stay in sync.
    bias: v.optional(namedAxisBiasValidator),
    baseBias: v.number(), // -5 (reformist) to +5 (suveranist) — see docs/bias-axis-spec.md
    reliabilityScore: v.number(), // 1-10 (10 = wire service, 1 = tabloid)
    // One-line provenance for the manual bias/reliability ratings (BIV-401).
    provenance: v.optional(v.string()),
    logoUrl: v.optional(v.string()),

    // Legacy MBFC (Media Bias/Fact Check) metadata. The RapidAPI integration
    // was removed (BIV-402); these fields remain readable for existing rows
    // and are seeded from feeds.ts curated data where available.
    mbfcCategory: v.optional(v.string()), // "left", "left-center", "center", "right-center", "right", "unrated"
    mbfcFactual: v.optional(v.string()), // "very-high", "high", "mostly-factual", "mixed", "low", "very-low"
    mbfcCredibility: v.optional(v.string()), // "high", "medium", "low"
    mbfcLastChecked: v.optional(v.number()), // Timestamp of last MBFC lookup

    // Rolling article-level AI bias stats, updated by the daily outlier job.
    rollingBiasMean: v.optional(v.number()),
    rollingBiasStddev: v.optional(v.number()),
    rollingBiasSampleSize: v.optional(v.number()),
    rollingBiasUpdatedAt: v.optional(v.number()),
  })
    .index("by_domain", ["domain"])
    .index("by_mbfc_last_checked", ["mbfcLastChecked"])
    .index("by_rolling_bias_updated_at", ["rollingBiasUpdatedAt"]),

  // =========================================================================
  // 3. EVENTS (The Clusters/Stories)
  // =========================================================================
  events: defineTable({
    title: v.string(),
    slug: v.string(),

    imageUrl: v.optional(v.string()),
    imageWidth: v.optional(v.number()),
    imageHeight: v.optional(v.number()),
    imageAlt: v.optional(v.string()),

    // neutral / reformist / suveranist framing summaries (BIV-303);
    // legacy center/left/right keys remain readable pre-migration.
    perspectiveSummaries: v.optional(perspectiveSummariesValidator),
    perspectiveSource: v.optional(
      v.union(v.literal("heuristic"), v.literal("ai")),
    ),
    globalImpact: v.optional(v.string()), // The "Consensus So What?" for guest users

    status: v.union(v.literal("processing"), v.literal("published")),
    firstPublishedAt: v.number(),
    lastUpdatedAt: v.optional(v.number()),
    lastArticleAt: v.optional(v.number()),
    articleCount: v.optional(v.number()),
    sourceCount: v.optional(v.number()),
    sourceIds: v.optional(v.array(v.id("sources"))),
    lastSummarizedAt: v.optional(v.number()), // Set after first AI summarization
    lastSummarySignature: v.optional(v.string()),
    lastClaimAnalysisAt: v.optional(v.number()), // Set after claim divergence analysis
    lastClaimAnalysisSignature: v.optional(v.string()),
    factualArticleCount: v.optional(v.number()),
    factualSourceCount: v.optional(v.number()),
    lastFactualUpdateAt: v.optional(v.number()),
  })
    .index("by_slug", ["slug"])
    .index("by_status_recency", ["status", "firstPublishedAt"])
    .index("by_status_last_article_at", ["status", "lastArticleAt"])
    .index("by_status_factual_coverage", [
      "status",
      "factualSourceCount",
      "factualArticleCount",
    ])
    .searchIndex("by_search_text", {
      searchField: "title",
      filterFields: ["status"],
    }),

  // =========================================================================
  // 3a. EVENT TOPICS (Junction — replaces events.topicIds array)
  // =========================================================================
  eventTopics: defineTable({
    eventId: v.id("events"),
    topicId: v.id("topics"),
  })
    .index("by_event", ["eventId"])
    .index("by_topic", ["topicId"])
    .index("by_event_topic", ["eventId", "topicId"]),

  // =========================================================================
  // 3b. EVENT EMBEDDINGS (Hot/cold split — avoids ~12KB bandwidth per read)
  // =========================================================================
  eventEmbeddings: defineTable({
    eventId: v.id("events"),
    embedding: v.array(v.number()),
    version: v.number(), // Embedding model version for reprocessing tracking
    status: v.optional(
      v.union(v.literal("processing"), v.literal("published")),
    ),
    recentWindowBucket: v.optional(v.string()),
    singletonBucket: v.optional(v.string()),
    updatedDayBucket: v.optional(v.string()),
    mergeSearchBucket: v.optional(v.string()),
    singletonSearchBucket: v.optional(v.string()),
  })
    .index("by_event", ["eventId"])
    .vectorIndex("by_embedding", {
      vectorField: "embedding",
      dimensions: 512,
      filterFields: [
        "status",
        "recentWindowBucket",
        "singletonBucket",
        "updatedDayBucket",
        "mergeSearchBucket",
        "singletonSearchBucket",
      ],
    }),

  // =========================================================================
  // 3b.1. EVENT EMBEDDINGS HOT (small physical vector index for fresh clustering)
  // =========================================================================
  eventEmbeddingHot: defineTable({
    eventId: v.id("events"),
    embeddingId: v.id("eventEmbeddings"),
    embedding: v.array(v.number()),
    version: v.number(),
    status: v.union(v.literal("processing"), v.literal("published")),
    recentWindowBucket: v.string(),
    updatedDayBucket: v.string(),
    lastArticleAt: v.number(),
    articleCount: v.number(),
    updatedAt: v.number(),
  })
    .index("by_event", ["eventId"])
    .index("by_embedding_ref", ["embeddingId"])
    .index("by_updated_at", ["updatedAt"])
    // No filterFields: the hot table only ever holds recent_2d events, and the
    // clustering search wants both processing + published, so every filter we
    // tried here matched the entire table. Keeping the index lean avoids paying
    // for filter dimensions we never constrain on.
    .vectorIndex("by_embedding", {
      vectorField: "embedding",
      dimensions: 512,
    }),

  // =========================================================================
  // 3c. EVENT CANDIDACY (Clustering read model)
  // =========================================================================
  eventCandidacy: defineTable({
    eventId: v.id("events"),
    embeddingId: v.optional(v.id("eventEmbeddings")),
    hotEmbeddingId: v.optional(v.id("eventEmbeddingHot")),
    eventCreationTime: v.optional(v.number()),
    title: v.optional(v.string()),
    slug: v.optional(v.string()),
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
    updatedAt: v.number(),
  })
    .index("by_event", ["eventId"])
    .index("by_embedding", ["embeddingId"])
    .index("by_hot_embedding", ["hotEmbeddingId"])
    .index("by_status_last_article_at", ["status", "lastArticleAt"])
    .index("by_status_updated_at", ["status", "updatedAt"]),

  // =========================================================================
  // 3d. PUBLIC EVENT PREVIEWS (Denormalized feed cards for anonymous traffic)
  // =========================================================================
  publicEventPreviews: defineTable({
    eventId: v.id("events"),
    slug: v.string(),
    title: v.string(),
    imageUrl: v.optional(v.string()),
    imageAlt: v.optional(v.string()),
    perspectiveSummaries: v.optional(perspectiveSummariesValidator),
    globalImpact: v.optional(v.string()),
    firstPublishedAt: v.number(),
    lastUpdatedAt: v.number(),
    articleCount: v.number(),
    sourceCount: v.number(),
    topicIds: v.array(v.id("topics")),
    factualArticleCount: v.optional(v.number()),
    factualSourceCount: v.optional(v.number()),
    trendingScore: v.number(),
    createdAt: v.optional(v.number()),
    sourceBiasCounts: v.object({
      left: v.number(),
      center: v.number(),
      right: v.number(),
    }),
    sources: v.array(
      v.object({
        _id: v.id("sources"),
        name: v.string(),
        logoUrl: v.optional(v.string()),
        baseBias: v.number(),
        reliabilityScore: v.number(),
        mbfcCategory: v.optional(v.string()),
        mbfcFactual: v.optional(v.string()),
        mbfcCredibility: v.optional(v.string()),
      }),
    ),
    updatedAt: v.number(),
  })
    .index("by_event", ["eventId"])
    .index("by_created_at", ["createdAt"])
    .index("by_first_published_at", ["firstPublishedAt"])
    .index("by_last_updated_at", ["lastUpdatedAt"])
    .index("by_trending_score", ["trendingScore"])
    .searchIndex("by_title", {
      searchField: "title",
    }),

  publicEventPreviewTopics: defineTable({
    topicId: v.id("topics"),
    eventId: v.id("events"),
    previewId: v.id("publicEventPreviews"),
    lastUpdatedAt: v.number(),
    firstPublishedAt: v.number(),
    trendingScore: v.number(),
    updatedAt: v.number(),
  })
    .index("by_topic_updated", ["topicId", "lastUpdatedAt"])
    .index("by_topic_trending", ["topicId", "trendingScore"])
    .index("by_event", ["eventId"])
    .index("by_preview", ["previewId"]),

  // =========================================================================
  // 3d.1. PUBLIC SNAPSHOTS (Static artifacts for crawler/anonymous hot paths)
  // =========================================================================
  publicSitemapSnapshots: defineTable({
    key: v.string(),
    xml: v.string(),
    urlCount: v.number(),
    generatedAt: v.number(),
    updatedAt: v.number(),
  }).index("by_key", ["key"]),

  publicFeedSnapshots: defineTable({
    key: v.string(),
    sort: v.union(v.literal("recent"), v.literal("trending")),
    payloadJson: v.string(),
    itemCount: v.number(),
    generatedAt: v.number(),
    updatedAt: v.number(),
  }).index("by_key", ["key"]),

  // =========================================================================
  // 3e. EVENT SHARE ASSETS (Cold path — social images stored outside hot reads)
  // =========================================================================
  eventShareAssets: defineTable({
    eventId: v.id("events"),
    storageId: v.optional(v.id("_storage")),
    contentType: v.optional(v.string()),
    width: v.number(),
    height: v.number(),
    renderSignature: v.string(),
    status: v.union(
      v.literal("pending"),
      v.literal("ready"),
      v.literal("failed"),
    ),
    error: v.optional(v.string()),
    updatedAt: v.number(),
  })
    .index("by_event", ["eventId"])
    .index("by_status_updatedAt", ["status", "updatedAt"]),

  // =========================================================================
  // 3d. EVENT SUMMARY JOBS (Durable queue for AI summarization)
  // =========================================================================
  eventSummaryJobs: defineTable({
    eventId: v.id("events"),
    status: v.union(
      v.literal("queued"),
      v.literal("processing"),
      v.literal("succeeded"),
      v.literal("failed"),
      v.literal("skipped"),
    ),
    reason: v.optional(v.string()),
    attempts: v.number(),
    requestedAt: v.number(),
    nextAttemptAt: v.number(),
    updatedAt: v.number(),
    processingRunId: v.optional(v.string()),
    leaseExpiresAt: v.optional(v.number()),
    lastError: v.optional(v.string()),
    articleCount: v.optional(v.number()),
    sourceCount: v.optional(v.number()),
    summarySignature: v.optional(v.string()),
  })
    .index("by_event", ["eventId"])
    .index("by_event_updatedAt", ["eventId", "updatedAt"])
    .index("by_event_status", ["eventId", "status"])
    .index("by_status_next_attempt", ["status", "nextAttemptAt"])
    .index("by_status_updatedAt", ["status", "updatedAt"]),

  // =========================================================================
  // 3e. EVENT CLAIMS (Agreement/divergence graph for clustered coverage)
  // =========================================================================
  eventClaims: defineTable({
    eventId: v.id("events"),
    canonicalStatement: v.string(),
    claimType: v.union(
      v.literal("quantitative"),
      v.literal("event"),
      v.literal("attribution"),
      v.literal("policy"),
      v.literal("characterization"),
    ),
    status: v.union(
      v.literal("agreement"),
      v.literal("divergence"),
      v.literal("framing"),
      v.literal("exclusive_left"),
      v.literal("exclusive_right"),
      v.literal("exclusive_center"),
    ),
    variants: v.array(
      v.object({
        articleId: v.id("articles"),
        sourceId: v.id("sources"),
        sourceLean: v.string(),
        sourceFactIndex: v.optional(v.number()),
        statement: v.string(),
        value: v.optional(v.string()),
      }),
    ),
    importance: v.number(),
    confidence: v.number(),
    generatedAt: v.number(),
  })
    .index("by_event", ["eventId"])
    .index("by_event_status", ["eventId", "status"])
    .index("by_event_importance", ["eventId", "importance"]),

  // =========================================================================
  // 3f. DAILY QUIZZES (Appointment mechanic generated from grounded claims)
  // =========================================================================
  dailyQuizzes: defineTable({
    dateKey: v.string(), // "YYYY-MM-DD" in UTC
    status: v.union(
      v.literal("pending"),
      v.literal("ready"),
      v.literal("failed"),
    ),
    questions: v.array(
      v.object({
        id: v.string(),
        type: v.union(
          v.literal("claim_attribution"),
          v.literal("fact_check"),
          v.literal("perspective_match"),
          v.literal("coverage_gap"),
        ),
        question: v.object({
          en: v.string(),
          ro: v.string(),
        }),
        choices: v.array(
          v.object({
            id: v.string(),
            text: v.object({
              en: v.string(),
              ro: v.string(),
            }),
          }),
        ),
        correctChoiceId: v.string(),
        explanation: v.object({
          en: v.string(),
          ro: v.string(),
        }),
        attribution: v.object({
          eventTitle: v.string(),
          eventSlug: v.string(),
          sourceName: v.optional(v.string()),
          sourceUrl: v.optional(v.string()),
          claim: v.optional(v.string()),
        }),
        eventId: v.id("events"),
        sourceIds: v.array(v.id("sources")),
      }),
    ),
    sourceEventIds: v.array(v.id("events")),
    inputSignature: v.string(),
    model: v.string(),
    generatedAt: v.number(),
    publishedAt: v.optional(v.number()),
    lastError: v.optional(v.string()),
  })
    .index("by_date", ["dateKey"])
    .index("by_status_date", ["status", "dateKey"]),

  quizAttempts: defineTable({
    userId: v.id("users"),
    quizId: v.id("dailyQuizzes"),
    dateKey: v.string(),
    answers: v.array(
      v.object({
        questionId: v.string(),
        choiceId: v.string(),
      }),
    ),
    score: v.number(),
    maxScore: v.number(),
    completedAt: v.number(),
  })
    .index("by_user_quiz", ["userId", "quizId"])
    .index("by_user_date", ["userId", "dateKey"])
    .index("by_quiz", ["quizId"]),

  // =========================================================================
  // 3g. CLUSTER PAIR LABELS (Ground-truth tuning set for clustering)
  // =========================================================================
  clusterPairLabels: defineTable({
    pairKey: v.string(),
    leftArticleId: v.id("articles"),
    rightArticleId: v.id("articles"),
    sameEvent: v.boolean(),
    notes: v.optional(v.string()),
    labeledAt: v.number(),
    labeledByEmail: v.optional(v.string()),
  })
    .index("by_pair_key", ["pairKey"])
    .index("by_labeled_at", ["labeledAt"]),

  // =========================================================================
  // 4. ARTICLES (The Evidence)
  // =========================================================================
  articles: defineTable({
    eventId: v.optional(v.id("events")),
    sourceId: v.id("sources"),

    title: v.string(),
    url: v.string(),
    canonicalUrl: v.string(),
    contentFingerprint: v.optional(v.string()),

    // Populated by enrichment pipeline, not at ingestion time
    summary: v.optional(v.string()),
    rssSnippet: v.optional(v.string()), // Raw snippet from RSS feed
    imageUrl: v.optional(v.string()),
    imageWidth: v.optional(v.number()),
    imageHeight: v.optional(v.number()),
    imageAlt: v.optional(v.string()),
    imageSource: v.optional(
      v.union(
        v.literal("rss"),
        v.literal("og"),
        v.literal("twitter"),
        v.literal("jsonld"),
        v.literal("inline"),
      ),
    ),
    entities: v.optional(v.array(v.string())),
    extractionQuality: v.optional(
      v.union(v.literal("strong"), v.literal("weak")),
    ),

    // Feed THIS to the Event Synthesizer (cheap tokens), not the full text.
    atomicFacts: v.optional(v.array(v.string())), // ["Vote count: 60-40", "Passed on: Tuesday", "Opposition: GOP"]
    factExtractionStatus: v.optional(
      v.union(
        v.literal("pending"),
        v.literal("deferred"),
        v.literal("succeeded"),
        v.literal("succeeded_empty"),
        v.literal("failed"),
        v.literal("skipped"),
      ),
    ),
    factExtractionError: v.optional(v.string()),
    factExtractedAt: v.optional(v.number()),
    factExtractionAttempts: v.optional(v.number()),
    factExtractionLastAttemptAt: v.optional(v.number()),
    needsFactExtraction: v.optional(v.boolean()),

    // Populated by enrichment pipeline (AI bias detection).
    // aiBias is the canonical named-axis object (BIV-302); aiBiasScore is the
    // derived single-score mirror consumed by the UI.
    aiBias: v.optional(namedAxisBiasValidator),
    aiBiasScore: v.optional(v.number()),
    biasComponents: v.optional(
      v.object({
        // Legacy field name; since BIV-202 this carries the model's
        // reformist(−)↔suveranist(+) axis score.
        politicalLean: v.number(),
        emotionalLanguage: v.number(),
        sourceDiversity: v.number(),
        factOpinionRatio: v.number(),
        rationale: v.string(),
      }),
    ),
    sourceBiasDelta: v.optional(v.number()),
    sourceBiasOutlierFlag: v.optional(v.boolean()),
    biasOutlierFlag: v.optional(v.boolean()),
    biasAnalyzedAt: v.optional(v.number()),
    biasDetectionStatus: v.optional(
      v.union(
        v.literal("deferred"),
        v.literal("succeeded"),
        v.literal("failed"),
        v.literal("skipped"),
      ),
    ),
    biasDetectionError: v.optional(v.string()),
    biasDetectionAttempts: v.optional(v.number()),
    biasDetectionLastAttemptAt: v.optional(v.number()),

    status: v.union(
      v.literal("unprocessed"),
      v.literal("processing"),
      v.literal("enriched"),
      v.literal("clustered"),
      v.literal("discarded"),
      v.literal("archived"),
    ),
    archivedAt: v.optional(v.number()),
    archivedReason: v.optional(
      v.union(v.literal("stale_singleton"), v.literal("stale_processing")),
    ),
    latestEmbeddingVersion: v.optional(v.number()),
    needsReenrichment: v.optional(v.boolean()),
    enrichmentRunId: v.optional(v.string()),
    enrichmentLeaseExpiresAt: v.optional(v.number()),
    publishedAt: v.number(), // Epoch ms
  })
    .index("by_event", ["eventId"])
    .index("by_event_published", ["eventId", "publishedAt"])
    .index("by_canonical_url", ["canonicalUrl"])
    .index("by_source_content_fingerprint", ["sourceId", "contentFingerprint"])
    .index("by_status", ["status"])
    .index("by_status_published", ["status", "publishedAt"])
    .index("by_status_latest_embedding_version", [
      "status",
      "latestEmbeddingVersion",
    ])
    .index("by_needs_reenrichment_status_published", [
      "needsReenrichment",
      "status",
      "publishedAt",
    ])
    .index("by_needs_fact_extraction_status_published", [
      "needsFactExtraction",
      "status",
      "publishedAt",
    ])
    .index("by_fact_extraction_status_published", [
      "factExtractionStatus",
      "publishedAt",
    ])
    .index("by_status_enrichment_lease", ["status", "enrichmentLeaseExpiresAt"])
    .index("by_archived_reason", ["archivedReason", "archivedAt"])
    .index("by_source", ["sourceId"])
    .index("by_source_publishedAt", ["sourceId", "publishedAt"])
    .index("by_source_analyzed", ["sourceId", "biasAnalyzedAt"])
    .index("by_published", ["publishedAt"]),

  // =========================================================================
  // 4a. ARTICLE EMBEDDINGS (Hot/cold split — avoids ~12KB bandwidth per read)
  // =========================================================================
  articleEmbeddings: defineTable({
    articleId: v.id("articles"),
    embedding: v.array(v.number()),
    version: v.number(), // Embedding model version for reprocessing tracking
  })
    .index("by_article", ["articleId"])
    .index("by_article_version", ["articleId", "version"])
    .vectorIndex("by_embedding", {
      vectorField: "embedding",
      dimensions: 512,
    }),

  // =========================================================================
  // 5. USERS (Profile only — stats & private context in separate tables)
  // =========================================================================
  users: defineTable({
    authUserId: v.string(),
    email: v.string(),

    // Public Profile (Safe to render in UI)
    profile: v.object({
      name: v.optional(v.string()),
      age: v.optional(v.number()),
      avatar: v.optional(v.string()),
      job: v.optional(v.string()),
      location: v.optional(v.string()),
      preferredLanguage: v.optional(
        v.union(v.literal("ro"), v.literal("en")),
      ),
    }),

    // Topics the user follows (from onboarding's topic picker or settings).
    // Drives the client-side feed boost — never a hard filter. Optional so
    // existing rows and guests-before-signup are valid; the guest's local
    // selection migrates here at merge.
    followedTopicIds: v.optional(v.array(v.id("topics"))),
  })
    .index("by_email", ["email"])
    .index("by_auth_user_id", ["authUserId"]),

  // =========================================================================
  // 5a. USER STATS (Hot table — updated on every interaction)
  // =========================================================================
  userStats: defineTable({
    userId: v.id("users"),
    currentStreak: v.number(),
    longestStreak: v.number(),
    articlesRead: v.number(),
    biasBalance: v.number(), // -100 (Left Bubble) to +100 (Right Bubble)
    lastActiveAt: v.optional(v.number()),
  }).index("by_user", ["userId"]),

  // =========================================================================
  // 5b. USER PRIVATE CONTEXT (Structurally isolated — strict RLS required)
  // =========================================================================
  userPrivateContext: defineTable({
    userId: v.id("users"),
    incomeBracket: v.optional(v.string()),
    concerns: v.optional(v.array(v.string())), // ["Inflation", "Housing"]
    interests: v.optional(v.array(v.string())),
    politicalLeaning: v.optional(v.string()),
  }).index("by_user", ["userId"]),

  // =========================================================================
  // 6. USER INSIGHTS ("So What?" results)
  // =========================================================================
  userInsights: defineTable({
    userId: v.id("users"),
    eventId: v.id("events"),

    content: v.object({
      personalImpact: v.string(), // "This tax bill affects your software engineer salary..."
      actionableTip: v.string(),
    }),

    eventLastUpdated: v.number(), // Version control (Invalidate if event changes)
    generatedAt: v.number(),
    expiresAt: v.number(), // Delete rows older than ~30 days
    lastNotifiedAt: v.optional(v.number()),
  })
    .index("by_user_event", ["userId", "eventId"])
    .index("by_event", ["eventId"])
    .index("by_user", ["userId"])
    .index("by_expires_at", ["expiresAt"]),

  // =========================================================================
  // 7. INTERACTIONS (The Immutable Log)
  // =========================================================================
  interactions: defineTable({
    userId: v.id("users"),
    eventId: v.id("events"),
    articleId: v.optional(v.id("articles")),

    type: v.union(
      v.literal("view"),
      v.literal("click_source"),
      v.literal("bookmark"),
      v.literal("unbookmark"),
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

    metadata: v.object({
      timeSpentSeconds: v.optional(v.number()), // For "read" events
      scrollDepthPercentage: v.optional(v.number()), // 0.0 to 1.0
      deviceType: v.optional(
        v.union(v.literal("mobile"), v.literal("tablet"), v.literal("desktop")),
      ),

      extras: v.optional(
        v.object({
          feedbackText: v.optional(v.string()),
          errorMessage: v.optional(v.string()),
          experimentVariant: v.optional(v.string()),
        }),
      ),
    }),
    timestamp: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_user_type", ["userId", "type"])
    .index("by_user_event_type", ["userId", "eventId", "type"])
    .index("by_event", ["eventId"])
    .index("by_timestamp", ["timestamp"]),

  // =========================================================================
  // 7b. GUEST MERGES (Idempotency ledger for guest→account migration)
  // =========================================================================
  // One row per device that has folded its local guest activity into an
  // account. Keyed by the device UUID so a retried merge is a no-op. The
  // device UUID rotates on logout, so each guest session merges at most once.
  guestMerges: defineTable({
    userId: v.id("users"),
    deviceId: v.string(),
    mergedAt: v.number(),
    readsMerged: v.number(),
  })
    .index("by_device", ["deviceId"])
    .index("by_user", ["userId"]),

  // =========================================================================
  // 7c. PUSH TOKENS (Expo push targets, one row per device)
  // =========================================================================
  // Registered only for authenticated users (a guest's token is held locally
  // until signup, then registered). Deduped by token so a device that signs
  // into a different account reassigns rather than duplicates.
  pushTokens: defineTable({
    userId: v.id("users"),
    token: v.string(),
    platform: v.optional(v.union(v.literal("ios"), v.literal("android"))),
    updatedAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_token", ["token"]),

  // =========================================================================
  // 8. WAITLIST (Early Access Email Collection)
  // =========================================================================
  waitlist: defineTable({
    // Core fields
    email: v.string(),
    name: v.optional(v.string()), // For personalization in emails
    position: v.number(), // Their spot in line (#1, #2, etc.)

    // Attribution
    referralSource: v.optional(v.string()), // "twitter", "producthunt", "friend", etc.

    // Status tracking
    status: v.union(
      v.literal("pending"),
      v.literal("invited"),
      v.literal("converted"),
      v.literal("bounced"),
      v.literal("unsubscribed"),
    ),

    // Timestamps
    createdAt: v.number(),
    invitedAt: v.optional(v.number()),
    convertedAt: v.optional(v.number()),
    lastEmailSentAt: v.optional(v.number()),

    // Invite management
    inviteCode: v.optional(v.string()), // Unique token for signup link
  })
    .index("by_email", ["email"])
    .index("by_status", ["status", "createdAt"])
    .index("by_status_invitedAt", ["status", "invitedAt"])
    .index("by_invite_code", ["inviteCode"])
    .index("by_position", ["position"])
    .index("by_status_last_email", ["status", "lastEmailSentAt"]),

  // =========================================================================
  // 9. INGESTION META (Feed Health Tracking)
  // =========================================================================
  ingestionMeta: defineTable({
    feedUrl: v.string(),
    sourceId: v.id("sources"), // Every feed belongs to a source
    lastFeedFingerprint: v.optional(v.string()),
    lastIngestedAt: v.optional(v.number()),
    lastSuccessAt: v.optional(v.number()),
    consecutiveFailures: v.number(),
    lastError: v.optional(v.string()),
    articleCount: v.number(), // Total articles ingested from this feed
  })
    .index("by_feed_url", ["feedUrl"])
    .index("by_source", ["sourceId"]),

  // =========================================================================
  // 10. CONFIG (Runtime-Tunable Key-Value Store)
  // =========================================================================
  config: defineTable({
    key: v.string(),
    value: v.string(), // JSON-encoded for flexibility
    description: v.string(),
    updatedAt: v.number(),
  }).index("by_key", ["key"]),

  pipelineRuntimeConfig: defineTable({
    key: v.string(),
    payloadJson: v.string(),
    generatedAt: v.number(),
    updatedAt: v.number(),
  }).index("by_key", ["key"]),

  // =========================================================================
  // 11. AI USAGE (Cost Tracking & Budget Enforcement)
  // =========================================================================
  // Budget limit stored in config table: key="ai_daily_budget_usd"
  aiUsage: defineTable({
    date: v.string(), // "YYYY-MM-DD" for daily grouping
    model: v.string(), // "gemini-3.1-flash-lite", "text-embedding-3-small"
    operation: v.string(), // "summarize_event", "generate_embedding", "bias_detection"
    callType: v.optional(v.string()),
    eventId: v.optional(v.id("events")),
    articleId: v.optional(v.id("articles")),
    inputTokens: v.number(),
    outputTokens: v.number(),
    cachedInputTokens: v.optional(v.number()),
    costUsd: v.number(), // Pre-calculated
    latencyMs: v.optional(v.number()),
    timestamp: v.number(),
  })
    .index("by_date", ["date"])
    .index("by_date_model", ["date", "model"])
    .index("by_operation", ["operation", "date"])
    .index("by_timestamp", ["timestamp"])
    .index("by_event", ["eventId"])
    .index("by_callType_timestamp", ["callType", "timestamp"]),

  // =========================================================================
  // 11a. AI BUDGET DAILY SHARDS (Sharded daily aggregates)
  // =========================================================================
  aiBudgetDaily: defineTable({
    date: v.string(), // "YYYY-MM-DD"
    shard: v.number(), // 0-23 (UTC hour)
    spentUsd: v.number(),
    reservedUsd: v.number(),
    updatedAt: v.number(),
  })
    .index("by_date", ["date"])
    .index("by_date_shard", ["date", "shard"]),

  aiBudgetDailyTotal: defineTable({
    date: v.string(),
    spentUsd: v.number(),
    reservedUsd: v.number(),
    updatedAt: v.number(),
  }).index("by_date", ["date"]),

  // =========================================================================
  // 11a. AI BUDGET RESERVATIONS (In-flight budget holds)
  // =========================================================================
  aiBudgetReservations: defineTable({
    model: v.string(),
    callType: v.optional(v.string()),
    eventId: v.optional(v.id("events")),
    articleId: v.optional(v.id("articles")),
    costUsd: v.number(),
    createdAt: v.number(),
    expiresAt: v.number(),
    date: v.optional(v.string()),
    shard: v.optional(v.number()),
  }).index("by_expiresAt", ["expiresAt"]),

  // =========================================================================
  // 11b. VECTOR SEARCH BUDGET DAILY SHARDS
  // =========================================================================
  vectorSearchDaily: defineTable({
    date: v.string(), // "YYYY-MM-DD"
    shard: v.number(), // 0-23 (UTC hour)
    qgbRead: v.number(),
    vectorSearches: v.number(),
    runCount: v.number(),
    updatedAt: v.number(),
  })
    .index("by_date", ["date"])
    .index("by_date_shard", ["date", "shard"]),

  vectorSearchDailyTotal: defineTable({
    date: v.string(),
    qgbRead: v.number(),
    vectorSearches: v.number(),
    runCount: v.number(),
    updatedAt: v.number(),
  }).index("by_date", ["date"]),

  vectorSearchRuns: defineTable({
    jobName: v.string(),
    runId: v.string(),
    date: v.string(),
    qgbRead: v.number(),
    vectorSearches: v.number(),
    vectorMatchesReturned: v.number(),
    vectorMatchesHydrated: v.number(),
    vectorMatchesDiscardedPostFetch: v.number(),
    usedFallbackMode: v.boolean(),
    budgetAllowed: v.boolean(),
    elapsedMs: v.number(),
    metricsJson: v.string(),
    createdAt: v.number(),
  })
    .index("by_run_id", ["runId"])
    .index("by_date", ["date"])
    .index("by_createdAt", ["createdAt"])
    .index("by_job_createdAt", ["jobName", "createdAt"]),

  vectorSearchReservations: defineTable({
    jobName: v.string(),
    runId: v.string(),
    date: v.string(),
    shard: v.number(),
    qgbReserved: v.number(),
    vectorSearchesReserved: v.number(),
    qgbConsumed: v.optional(v.number()),
    vectorSearchesConsumed: v.optional(v.number()),
    status: v.union(
      v.literal("reserved"),
      v.literal("consumed"),
      v.literal("released"),
      v.literal("expired"),
    ),
    createdAt: v.number(),
    expiresAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_run_id", ["runId"])
    .index("by_expiresAt", ["expiresAt"])
    .index("by_status_expiresAt", ["status", "expiresAt"]),

  // =========================================================================
  // 12. PIPELINE LOCKS (Short-lived leases for scheduled jobs)
  // =========================================================================
  pipelineLocks: defineTable({
    key: v.string(),
    owner: v.string(),
    acquiredAt: v.number(),
    updatedAt: v.number(),
    expiresAt: v.number(),
  }).index("by_key", ["key"]),

  clusteringJobState: defineTable({
    jobName: v.string(),
    lastProcessedAt: v.optional(v.number()),
    lastProcessedCreationTime: v.optional(v.number()),
    lastProcessedDayBucket: v.optional(v.string()),
    lastRunAt: v.optional(v.number()),
    lastRunMetricsJson: v.optional(v.string()),
    updatedAt: v.number(),
  }).index("by_job_name", ["jobName"]),

  pipelineRunLogs: defineTable({
    jobName: v.string(),
    runId: v.string(),
    startedAt: v.number(),
    finishedAt: v.number(),
    durationMs: v.number(),
    status: v.union(
      v.literal("ok"),
      v.literal("skipped"),
      v.literal("degraded"),
      v.literal("error"),
    ),
    errorMessage: v.optional(v.string()),
    counters: v.record(v.string(), v.number()),
    gauges: v.record(v.string(), pipelineGaugeValue),
    metadata: v.record(v.string(), pipelineMetadataValue),
    createdAt: v.number(),
  })
    .index("by_job_started_at", ["jobName", "startedAt"])
    .index("by_status_started_at", ["status", "startedAt"])
    .index("by_created_at", ["createdAt"]),

  pipelineAdminRollups: defineTable({
    key: v.string(),
    payloadJson: v.string(),
    generatedAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_key", ["key"])
    .index("by_generated_at", ["generatedAt"]),

  pipelineAlerts: defineTable({
    severity: v.union(
      v.literal("info"),
      v.literal("warning"),
      v.literal("error"),
    ),
    code: v.string(),
    message: v.string(),
    details: v.record(v.string(), pipelineMetricValue),
    createdAt: v.number(),
    resolvedAt: v.optional(v.number()),
    acknowledgedBy: v.optional(v.string()),
    acknowledgedAt: v.optional(v.number()),
  })
    .index("by_code", ["code"])
    .index("by_code_resolved", ["code", "resolvedAt"])
    .index("by_created_at", ["createdAt"])
    .index("by_resolved_created_at", ["resolvedAt", "createdAt"]),

  // =========================================================================
  // RATE LIMITS (Ticket 18 — fixed-window counters for abusable mutations)
  // =========================================================================
  // One row per (key) where key encodes the limited action + subject, e.g.
  // "merge:<deviceId>" or "pushToken:<userId>". A fixed window is cheap and
  // good enough to blunt abuse of guest-reachable + auth mutations.
  rateLimits: defineTable({
    key: v.string(),
    count: v.number(),
    windowStartedAt: v.number(),
  }).index("by_key", ["key"]),

  // =========================================================================
  // BRIEFING SENDS (Ticket 19 — morning-briefing dedupe ledger)
  // =========================================================================
  // One row per (user, event) the morning briefing has already pushed, so a
  // story is never sent to the same user twice.
  briefingSends: defineTable({
    userId: v.id("users"),
    eventId: v.id("events"),
    sentAt: v.number(),
  })
    .index("by_user_event", ["userId", "eventId"])
    .index("by_user", ["userId"])
    .index("by_sent_at", ["sentAt"]),
});
