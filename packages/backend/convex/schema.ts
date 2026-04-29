import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

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
    domain: v.string(), // "nytimes.com"
    name: v.string(), // "The New York Times"
    baseBias: v.number(), // -5 (Left) to +5 (Right)
    reliabilityScore: v.number(), // 1-10 (10 = Academic/Reuters, 1 = Tabloid)
    logoUrl: v.optional(v.string()),

    // MBFC (Media Bias/Fact Check) enrichment — populated via RapidAPI
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
    .index("by_mbfc_last_checked", ["mbfcLastChecked"]),

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

    perspectiveSummaries: v.optional(
      v.object({
        center: v.optional(v.string()),
        left: v.optional(v.string()),
        right: v.optional(v.string()),
      }),
    ),
    globalImpact: v.optional(v.string()), // The "Consensus So What?" for guest users

    status: v.union(v.literal("processing"), v.literal("published")),
    firstPublishedAt: v.number(),
    lastUpdatedAt: v.optional(v.number()),
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
  })
    .index("by_event", ["eventId"])
    .vectorIndex("by_embedding", {
      vectorField: "embedding",
      dimensions: 1536,
    }),

  // =========================================================================
  // 3c. EVENT SHARE ASSETS (Cold path — social images stored outside hot reads)
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
  // 3f. CLUSTER PAIR LABELS (Ground-truth tuning set for clustering)
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
        v.literal("succeeded"),
        v.literal("failed"),
        v.literal("skipped"),
      ),
    ),
    factExtractionError: v.optional(v.string()),
    factExtractedAt: v.optional(v.number()),

    // Populated by enrichment pipeline (AI bias detection)
    aiBiasScore: v.optional(v.number()),
    biasComponents: v.optional(
      v.object({
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
        v.literal("succeeded"),
        v.literal("failed"),
        v.literal("skipped"),
      ),
    ),
    biasDetectionError: v.optional(v.string()),

    status: v.union(
      v.literal("unprocessed"),
      v.literal("processing"),
      v.literal("enriched"),
      v.literal("clustered"),
      v.literal("discarded"),
    ),
    enrichmentRunId: v.optional(v.string()),
    enrichmentLeaseExpiresAt: v.optional(v.number()),
    publishedAt: v.number(), // Epoch ms
  })
    .index("by_event", ["eventId"])
    .index("by_canonical_url", ["canonicalUrl"])
    .index("by_status", ["status"])
    .index("by_status_published", ["status", "publishedAt"])
    .index("by_status_enrichment_lease", ["status", "enrichmentLeaseExpiresAt"])
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
    }),
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
      deviceType: v.optional(v.string()), // "mobile", "desktop"

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

  // =========================================================================
  // 11. AI USAGE (Cost Tracking & Budget Enforcement)
  // =========================================================================
  // Budget limit stored in config table: key="ai_daily_budget_usd"
  aiUsage: defineTable({
    date: v.string(), // "YYYY-MM-DD" for daily grouping
    model: v.string(), // "gpt-4o-mini", "text-embedding-3-small"
    operation: v.string(), // "summarize_event", "generate_embedding", "bias_detection"
    callType: v.optional(v.string()),
    eventId: v.optional(v.id("events")),
    articleId: v.optional(v.id("articles")),
    inputTokens: v.number(),
    outputTokens: v.number(),
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
  }).index("by_expiresAt", ["expiresAt"]),

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
});
