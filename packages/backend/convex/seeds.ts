import { internalMutation, query } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { TOPIC_CATALOG } from "./topicCatalog";
import { ROMANIAN_SOURCE_REPUTATION } from "./sourceReputation";
import { namedAxisBias } from "./lib/biasAxis";

/**
 * Seed/refresh the Romanian source-reputation rows (BIV-401).
 * Idempotent upsert by domain — safe to re-run after editing
 * sourceReputation.ts. Run: npx convex run seeds:seedRomanianSources
 */
export const seedRomanianSources = internalMutation({
  args: {},
  handler: async (ctx) => {
    let created = 0;
    let updated = 0;

    for (const entry of ROMANIAN_SOURCE_REPUTATION) {
      const values = {
        name: entry.name,
        bias: namedAxisBias(entry.biasScore),
        baseBias: entry.biasScore,
        reliabilityScore: entry.reliabilityScore,
        provenance: entry.provenance,
      };

      const existing = await ctx.db
        .query("sources")
        .withIndex("by_domain", (q) => q.eq("domain", entry.domain))
        .first();

      if (existing) {
        await ctx.db.patch(existing._id, values);
        updated++;
      } else {
        await ctx.db.insert("sources", {
          domain: entry.domain,
          logoUrl: `https://logo.clearbit.com/${entry.domain}`,
          ...values,
        });
        created++;
      }
    }

    console.log(
      `✅ Romanian source reputation seeded: ${created} created, ${updated} updated`,
    );
    return { created, updated };
  },
});

/**
 * Seed the database with dummy data for UI development.
 * Run via Convex Dashboard: npx convex run seeds:seedDB
 */
export const seedDB = internalMutation({
  args: {},
  handler: async (ctx) => {
    // Check if already seeded
    const existingTopics = await ctx.db.query("topics").first();
    if (existingTopics) {
      console.log("Database already seeded. Skipping...");
      return { message: "Database already seeded" };
    }

    // =========================================================================
    // 1. TOPICS
    // =========================================================================
    const topicIdsBySlug = new Map<string, Id<"topics">>();
    for (const topic of TOPIC_CATALOG) {
      const topicId = await ctx.db.insert("topics", {
        slug: topic.slug,
        displayName: topic.displayName,
        description: topic.description,
        aliases: topic.aliases,
        keywords: topic.keywords,
        keyPhrases: topic.keyPhrases,
        excludePhrases: topic.excludePhrases,
      });
      topicIdsBySlug.set(topic.slug, topicId);
    }

    const topicEconomy = topicIdsBySlug.get("economy");
    const topicTech = topicIdsBySlug.get("tech");
    if (!topicEconomy || !topicTech) {
      throw new Error("Seed topic catalog is missing required economy/tech topics");
    }

    console.log(`✅ Created ${TOPIC_CATALOG.length} topics`);

    // =========================================================================
    // 2. SOURCES
    // =========================================================================
    const sourceCNN = await ctx.db.insert("sources", {
      domain: "cnn.com",
      name: "CNN",
      baseBias: -4,
      reliabilityScore: 7,
      logoUrl: "https://logo.clearbit.com/cnn.com",
      mbfcCategory: "left",
      mbfcFactual: "mostly-factual",
      mbfcCredibility: "medium",
      mbfcLastChecked: Date.now(),
    });

    const sourceFox = await ctx.db.insert("sources", {
      domain: "foxnews.com",
      name: "Fox News",
      baseBias: 4,
      reliabilityScore: 5,
      logoUrl: "https://logo.clearbit.com/foxnews.com",
      mbfcCategory: "right",
      mbfcFactual: "mixed",
      mbfcCredibility: "medium",
      mbfcLastChecked: Date.now(),
    });

    const sourceReuters = await ctx.db.insert("sources", {
      domain: "reuters.com",
      name: "Reuters",
      baseBias: 0,
      reliabilityScore: 9,
      logoUrl: "https://logo.clearbit.com/reuters.com",
      mbfcCategory: "center",
      mbfcFactual: "very-high",
      mbfcCredibility: "high",
      mbfcLastChecked: Date.now(),
    });

    console.log("✅ Created 3 sources");

    // =========================================================================
    // 3. EVENTS
    // =========================================================================
    const now = Date.now();

    const eventFedRates = await ctx.db.insert("events", {
      title: "Federal Reserve Raises Interest Rates to 5.5%",
      slug: "fed-raises-rates-2026",
      imageUrl:
        "https://images.unsplash.com/photo-1454165804606-c3d57bc86b40?auto=format&fit=crop&w=1200&q=80",
      perspectiveSummaries: {
        neutral:
          "The Federal Reserve raised interest rates by 0.25% to combat persistent inflation, bringing the federal funds rate to 5.5%. This marks the highest level in over two decades.",
        reformist: "Critics argue the rate hike disproportionately affects working-class Americans and small businesses, while large corporations can absorb the costs. Housing affordability continues to decline.",
        suveranist:
          "The Fed's decisive action demonstrates fiscal responsibility. Controlling inflation is essential for long-term economic stability, and markets have responded positively to the measured approach.",
      },
      globalImpact:
        "Higher borrowing costs affect mortgages, car loans, and credit cards. Savers benefit from better yields on savings accounts.",
      status: "published",
      firstPublishedAt: now - 86400000, // 1 day ago
      lastSummarizedAt: now - 3600000, // 1 hour ago
    });

    const eventAIRegulations = await ctx.db.insert("events", {
      title: "Congress Proposes Comprehensive AI Regulation Framework",
      slug: "ai-regulations-congress-2026",
      imageUrl:
        "https://images.unsplash.com/photo-1518770660439-4636190af475?auto=format&fit=crop&w=1200&q=80",
      perspectiveSummaries: {
        neutral:
          "A bipartisan bill introduced in Congress aims to establish the first comprehensive regulatory framework for AI systems, requiring transparency in training data and mandatory safety audits for high-risk applications.",
        reformist: "The bill doesn't go far enough in protecting workers from AI displacement. Stronger provisions are needed for algorithmic bias prevention and union consultation rights.",
        suveranist:
          "While some oversight is reasonable, excessive regulation could stifle American innovation and hand competitive advantage to China. The free market should primarily guide AI development.",
      },
      globalImpact:
        "Tech companies may face new compliance costs. Consumers could see improved AI transparency and safety standards.",
      status: "published",
      firstPublishedAt: now - 172800000, // 2 days ago
      lastSummarizedAt: now - 7200000, // 2 hours ago
    });

    console.log("✅ Created 2 events");

    // =========================================================================
    // 3a. EVENT TOPICS (Junction table)
    // =========================================================================
    await ctx.db.insert("eventTopics", {
      eventId: eventFedRates,
      topicId: topicEconomy,
    });
    await ctx.db.insert("eventTopics", {
      eventId: eventAIRegulations,
      topicId: topicTech,
    });

    console.log("✅ Created 2 eventTopics");

    // =========================================================================
    // 3b. EVENT EMBEDDINGS (placeholder zeros — real embeddings come from AI)
    // =========================================================================
    const dummyEmbedding = new Array(512).fill(0);
    const day = new Date().toISOString().slice(0, 10);

    await ctx.db.insert("eventEmbeddings", {
      eventId: eventFedRates,
      embedding: dummyEmbedding,
      version: 1,
      status: "published",
      recentWindowBucket: "recent_2d",
      singletonBucket: "multi",
      updatedDayBucket: day,
      mergeSearchBucket: `published::recent_2d::${day}`,
      singletonSearchBucket: `published::multi::${day}`,
    });
    await ctx.db.insert("eventEmbeddings", {
      eventId: eventAIRegulations,
      embedding: dummyEmbedding,
      version: 1,
      status: "published",
      recentWindowBucket: "recent_2d",
      singletonBucket: "multi",
      updatedDayBucket: day,
      mergeSearchBucket: `published::recent_2d::${day}`,
      singletonSearchBucket: `published::multi::${day}`,
    });

    console.log("✅ Created 2 eventEmbeddings");

    // =========================================================================
    // 4. ARTICLES
    // =========================================================================

    // --- Articles for Fed Rates Event ---
    await ctx.db.insert("articles", {
      eventId: eventFedRates,
      sourceId: sourceCNN,
      title:
        "Fed Hikes Rates Again as Inflation Persists, Squeezing American Families",
      url: "https://cnn.com/2026/01/06/economy/fed-rate-hike-inflation",
      canonicalUrl:
        "https://cnn.com/2026/01/06/economy/fed-rate-hike-inflation",
      summary:
        "The Federal Reserve raised its benchmark interest rate to 5.5%, the highest since 2001. Economists warn this could further strain household budgets already stretched by years of inflation.",
      atomicFacts: [
        "Rate increased by 0.25%",
        "New rate: 5.5%",
        "Highest since 2001",
        "11th hike in current cycle",
        "Mortgage rates expected to rise",
      ],
      aiBiasScore: -2,
      status: "clustered",
      publishedAt: new Date("2026-01-06T14:30:00Z").getTime(),
    });

    await ctx.db.insert("articles", {
      eventId: eventFedRates,
      sourceId: sourceFox,
      title:
        "Federal Reserve Takes Strong Action to Tame Inflation, Markets Rally",
      url: "https://foxnews.com/2026/01/06/fed-rate-hike-markets-rally",
      canonicalUrl:
        "https://foxnews.com/2026/01/06/fed-rate-hike-markets-rally",
      summary:
        "The Fed's latest rate increase signals commitment to price stability. Wall Street responded positively, with the S&P 500 gaining 1.2% following the announcement.",
      atomicFacts: [
        "Rate increased to 5.5%",
        "S&P 500 up 1.2%",
        "Dow Jones up 350 points",
        "Fed Chair: 'Inflation battle continuing'",
        "Next meeting in 6 weeks",
      ],
      aiBiasScore: 2,
      status: "clustered",
      publishedAt: new Date("2026-01-06T15:00:00Z").getTime(),
    });

    await ctx.db.insert("articles", {
      eventId: eventFedRates,
      sourceId: sourceReuters,
      title:
        "U.S. Federal Reserve Raises Rates to 5.5%, Signals Cautious Outlook",
      url: "https://reuters.com/2026/01/06/fed-rate-decision",
      canonicalUrl: "https://reuters.com/2026/01/06/fed-rate-decision",
      summary:
        "The U.S. Federal Reserve raised interest rates by 25 basis points to 5.5% on Wednesday, while indicating future decisions will depend on incoming economic data.",
      atomicFacts: [
        "25 basis point increase",
        "Target range: 5.25%-5.5%",
        "Decision was unanimous",
        "Data-dependent approach emphasized",
        "Inflation at 3.2% (down from 3.5%)",
      ],
      aiBiasScore: 0,
      status: "clustered",
      publishedAt: new Date("2026-01-06T14:00:00Z").getTime(),
    });

    // --- Articles for AI Regulations Event ---
    await ctx.db.insert("articles", {
      eventId: eventAIRegulations,
      sourceId: sourceCNN,
      title: "Landmark AI Bill Faces Uphill Battle as Tech Lobbyists Push Back",
      url: "https://cnn.com/2026/01/05/tech/ai-regulation-bill-congress",
      canonicalUrl:
        "https://cnn.com/2026/01/05/tech/ai-regulation-bill-congress",
      summary:
        "The proposed AI Safety and Transparency Act would require companies to disclose training data sources and conduct bias audits. Silicon Valley has mobilized against key provisions.",
      atomicFacts: [
        "Bill: AI Safety and Transparency Act",
        "Sponsors: Bipartisan coalition",
        "Requires training data disclosure",
        "Mandatory bias audits for high-risk AI",
        "Tech industry opposition growing",
      ],
      aiBiasScore: -1,
      status: "clustered",
      publishedAt: new Date("2026-01-05T10:00:00Z").getTime(),
    });

    await ctx.db.insert("articles", {
      eventId: eventAIRegulations,
      sourceId: sourceFox,
      title: "New AI Regulations Could Cost Economy Billions, Industry Warns",
      url: "https://foxnews.com/2026/01/05/ai-regulation-economic-impact",
      canonicalUrl:
        "https://foxnews.com/2026/01/05/ai-regulation-economic-impact",
      summary:
        "Tech executives warn that proposed AI regulations could cost the industry $50 billion in compliance costs and push innovation overseas to less regulated markets.",
      atomicFacts: [
        "Estimated compliance cost: $50B",
        "Could affect 500,000 jobs",
        "China not implementing similar rules",
        "Small AI startups most affected",
        "Chamber of Commerce opposes bill",
      ],
      aiBiasScore: 3,
      status: "clustered",
      publishedAt: new Date("2026-01-05T12:00:00Z").getTime(),
    });

    await ctx.db.insert("articles", {
      eventId: eventAIRegulations,
      sourceId: sourceReuters,
      title: "U.S. Lawmakers Unveil Bipartisan AI Regulation Framework",
      url: "https://reuters.com/2026/01/05/us-ai-regulation-bill",
      canonicalUrl: "https://reuters.com/2026/01/05/us-ai-regulation-bill",
      summary:
        "A bipartisan group of U.S. senators introduced legislation to regulate artificial intelligence, marking the first comprehensive federal approach to AI governance.",
      atomicFacts: [
        "First comprehensive federal AI bill",
        "Bipartisan support from 8 senators",
        "Covers models above certain compute threshold",
        "Creates AI Safety Board",
        "90-day comment period begins",
      ],
      aiBiasScore: 0,
      status: "clustered",
      publishedAt: new Date("2026-01-05T09:30:00Z").getTime(),
    });

    console.log("✅ Created 6 articles");

    // =========================================================================
    // SUMMARY
    // =========================================================================
    return {
      message: "Database seeded successfully!",
      created: {
        topics: TOPIC_CATALOG.length,
        sources: 3,
        events: 2,
        articles: 6,
      },
      ids: {
        topics: {
          economy: topicEconomy,
          tech: topicTech,
        },
        sources: { cnn: sourceCNN, fox: sourceFox, reuters: sourceReuters },
        events: { fedRates: eventFedRates, aiRegulations: eventAIRegulations },
      },
    };
  },
});

/**
 * Clear all seeded data (for testing purposes).
 * Run via Convex Dashboard: npx convex run seeds:clearDB
 */
export const clearDB = internalMutation({
  args: {},
  handler: async (ctx) => {
    // Delete in reverse order of dependencies
    const tablesToClear = [
      "articleEmbeddings",
      "articles",
      "eventEmbeddings",
      "eventTopics",
      "events",
      "sources",
      "topics",
      "userPrivateContext",
      "userStats",
    ] as const;

    for (const table of tablesToClear) {
      const rows = await ctx.db.query(table).collect();
      for (const row of rows) {
        await ctx.db.delete(row._id);
      }
    }

    console.log("✅ Cleared all seeded data");
    return { message: "Database cleared" };
  },
});

/**
 * Verify seeded data and relationships.
 * Public query for easy testing.
 */
export const verifySeedData = query({
  args: {},
  handler: async (ctx) => {
    const topics = await ctx.db.query("topics").collect();
    const sources = await ctx.db.query("sources").collect();
    const events = await ctx.db.query("events").collect();
    const articles = await ctx.db.query("articles").collect();
    const eventTopicsRows = await ctx.db.query("eventTopics").collect();

    // Verify relationships: Get topic names for each event via junction table
    const eventsWithTopics = await Promise.all(
      events.map(async (event) => {
        const junctionRows = eventTopicsRows.filter(
          (row) => row.eventId === event._id,
        );
        const topicNames = await Promise.all(
          junctionRows.map(async (row) => {
            const topic = await ctx.db.get(row.topicId);
            return topic?.displayName ?? "Unknown";
          }),
        );
        return {
          title: event.title,
          topics: topicNames,
          articleCount: articles.filter((a) => a.eventId === event._id).length,
        };
      }),
    );

    // Verify relationships: Get source and event for each article
    const articlesWithRelations = await Promise.all(
      articles.map(async (article) => {
        const source = await ctx.db.get(article.sourceId);
        const event = article.eventId
          ? await ctx.db.get(article.eventId)
          : null;
        return {
          title: article.title.substring(0, 50) + "...",
          source: source?.name ?? "Unknown",
          event: event ? event.title.substring(0, 30) + "..." : "Unclustered",
          biasScore: article.aiBiasScore,
        };
      }),
    );

    return {
      counts: {
        topics: topics.length,
        sources: sources.length,
        events: events.length,
        articles: articles.length,
      },
      topics: topics.map((t) => ({ slug: t.slug, displayName: t.displayName })),
      sources: sources.map((s) => ({
        name: s.name,
        domain: s.domain,
        bias: s.baseBias,
      })),
      eventsWithTopics,
      articlesWithRelations,
    };
  },
});
