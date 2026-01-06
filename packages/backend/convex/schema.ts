import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  // =========================================================================
  // 1. TOPICS (Normalized Taxonomy)
  // =========================================================================
  topics: defineTable({
    slug: v.string(),
    displayName: v.string(),
  }).index("by_slug", ["slug"]),

  // =========================================================================
  // 2. SOURCES (Reputation Layer)
  // =========================================================================
  sources: defineTable({
    domain: v.string(), // "nytimes.com"
    name: v.string(), // "The New York Times"
    baseBias: v.number(), // -5 (Left) to +5 (Right)
    reliabilityScore: v.number(), // 1-10 (10 = Academic/Reuters, 1 = Tabloid)
    logoUrl: v.string(),
  }).index("by_domain", ["domain"]),

  // =========================================================================
  // 3. EVENTS (The Clusters/Stories)
  // =========================================================================
  events: defineTable({
    title: v.string(),
    slug: v.string(),

    perspectiveSummaries: v.object({
      center: v.string(),
      left: v.optional(v.string()),
      right: v.optional(v.string()),
    }),
    globalImpact: v.string(), // The "Consensus So What?" for guest users

    topicIds: v.array(v.id("topics")),
    embedding: v.array(v.number()),
    embeddingVersion: v.number(),

    status: v.union(v.literal("processing"), v.literal("published")),
    firstPublishedAt: v.number(),
    lastSummarizedAt: v.number(),
  })
    .vectorIndex("by_embedding", { vectorField: "embedding", dimensions: 1536 })
    .index("by_slug", ["slug"])
    .index("by_topic_recency", ["status", "firstPublishedAt"]),

  // =========================================================================
  // 4. ARTICLES (The Evidence)
  // =========================================================================
  articles: defineTable({
    eventId: v.optional(v.id("events")),
    sourceId: v.id("sources"),

    title: v.string(),
    url: v.string(),
    canonicalUrl: v.string(),

    summary: v.string(),

    // Feed THIS to the Event Synthesizer (cheap tokens), not the full text.
    atomicFacts: v.optional(v.array(v.string())), // ["Vote count: 60-40", "Passed on: Tuesday", "Opposition: GOP"]

    aiBiasScore: v.number(),
    embedding: v.optional(v.array(v.number())),

    status: v.union(
      v.literal("unprocessed"),
      v.literal("clustered"),
      v.literal("discarded")
    ),
    publishedAt: v.string(),
  })
    .index("by_event", ["eventId"])
    .index("by_canonical_url", ["canonicalUrl"])
    .vectorIndex("by_embedding", {
      vectorField: "embedding",
      dimensions: 1536,
    }),

  // =========================================================================
  // 5. USERS (Profile + Privacy)
  // =========================================================================
  users: defineTable({
    email: v.string(),

    // Public Profile (Safe to render in UI)
    profile: v.object({
      name: v.optional(v.string()),
	  age: v.optional(v.number()),
      avatar: v.optional(v.string()),
      job: v.optional(v.string()),
      location: v.optional(v.string()),
    }),

    // 🔒 Private Context (Strict RLS required)
    // Used for the "Personal Impact" generation
    privateContext: v.optional(
      v.object({
        incomeBracket: v.optional(v.string()),
        concerns: v.array(v.string()), // ["Inflation", "Housing"]
        interests: v.array(v.string()),
        politicalLeaning: v.optional(v.string()),
      })
    ),

    // Gamification Stats
    stats: v.object({
      currentStreak: v.number(),
	  longestStreak: v.number(),
      articlesRead: v.number(),
      biasBalance: v.number(), // -100 (Left Bubble) to +100 (Right Bubble)
    }),

    // Auth Metadata (for Better-Auth or generic use)
    emailVerified: v.optional(v.boolean()),
  }).index("by_email", ["email"]),

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
  }).index("by_user_event", ["userId", "eventId"]),

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
      v.literal("dismiss"),
      v.literal("share"),
      v.literal("feedback_bias")
    ),

    context: v.object({
      biasRating: v.number(),
      sourceReliability: v.number(),
    }),

    metadata: v.object({
      timeSpentSeconds: v.optional(v.number()), // For "read" events
      scrollDepthPercentage: v.optional(v.number()), // 0.0 to 1.0
      deviceType: v.optional(v.string()), // "mobile", "desktop"

      extras: v.optional(v.any()),
    }),
    timestamp: v.number(),
  }).index("by_user", ["userId"]),
});
