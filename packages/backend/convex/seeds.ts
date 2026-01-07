import { internalMutation, query } from "./_generated/server";
import { Id } from "./_generated/dataModel";

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
    const topicEconomy = await ctx.db.insert("topics", {
      slug: "economy",
      displayName: "Economy",
    });

    const topicTech = await ctx.db.insert("topics", {
      slug: "tech",
      displayName: "Tech",
    });

    console.log("✅ Created 2 topics");

    // =========================================================================
    // 2. SOURCES
    // =========================================================================
    const sourceCNN = await ctx.db.insert("sources", {
      domain: "cnn.com",
      name: "CNN",
      baseBias: -2, // Slight left lean
      reliabilityScore: 7,
      logoUrl: "https://logo.clearbit.com/cnn.com",
    });

    const sourceFox = await ctx.db.insert("sources", {
      domain: "foxnews.com",
      name: "Fox News",
      baseBias: 3, // Right lean
      reliabilityScore: 6,
      logoUrl: "https://logo.clearbit.com/foxnews.com",
    });

    const sourceReuters = await ctx.db.insert("sources", {
      domain: "reuters.com",
      name: "Reuters",
      baseBias: 0, // Center
      reliabilityScore: 9,
      logoUrl: "https://logo.clearbit.com/reuters.com",
    });

    console.log("✅ Created 3 sources");

    // =========================================================================
    // 3. EVENTS
    // =========================================================================
    const now = Date.now();

    // Dummy embedding (1536 dimensions of zeros - placeholder for real embeddings)
    const dummyEmbedding = new Array(1536).fill(0);

    const eventFedRates = await ctx.db.insert("events", {
      title: "Federal Reserve Raises Interest Rates to 5.5%",
      slug: "fed-raises-rates-2026",
      perspectiveSummaries: {
        center:
          "The Federal Reserve raised interest rates by 0.25% to combat persistent inflation, bringing the federal funds rate to 5.5%. This marks the highest level in over two decades.",
        left: "Critics argue the rate hike disproportionately affects working-class Americans and small businesses, while large corporations can absorb the costs. Housing affordability continues to decline.",
        right:
          "The Fed's decisive action demonstrates fiscal responsibility. Controlling inflation is essential for long-term economic stability, and markets have responded positively to the measured approach.",
      },
      globalImpact:
        "Higher borrowing costs affect mortgages, car loans, and credit cards. Savers benefit from better yields on savings accounts.",
      topicIds: [topicEconomy],
      embedding: dummyEmbedding,
      embeddingVersion: 1,
      status: "published",
      firstPublishedAt: now - 86400000, // 1 day ago
      lastSummarizedAt: now - 3600000, // 1 hour ago
    });

    const eventAIRegulations = await ctx.db.insert("events", {
      title: "Congress Proposes Comprehensive AI Regulation Framework",
      slug: "ai-regulations-congress-2026",
      perspectiveSummaries: {
        center:
          "A bipartisan bill introduced in Congress aims to establish the first comprehensive regulatory framework for AI systems, requiring transparency in training data and mandatory safety audits for high-risk applications.",
        left: "The bill doesn't go far enough in protecting workers from AI displacement. Stronger provisions are needed for algorithmic bias prevention and union consultation rights.",
        right:
          "While some oversight is reasonable, excessive regulation could stifle American innovation and hand competitive advantage to China. The free market should primarily guide AI development.",
      },
      globalImpact:
        "Tech companies may face new compliance costs. Consumers could see improved AI transparency and safety standards.",
      topicIds: [topicTech],
      embedding: dummyEmbedding,
      embeddingVersion: 1,
      status: "published",
      firstPublishedAt: now - 172800000, // 2 days ago
      lastSummarizedAt: now - 7200000, // 2 hours ago
    });

    console.log("✅ Created 2 events");

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
      publishedAt: "2026-01-06T14:30:00Z",
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
      publishedAt: "2026-01-06T15:00:00Z",
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
      publishedAt: "2026-01-06T14:00:00Z",
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
      publishedAt: "2026-01-05T10:00:00Z",
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
      publishedAt: "2026-01-05T12:00:00Z",
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
      publishedAt: "2026-01-05T09:30:00Z",
    });

    console.log("✅ Created 6 articles");

    // =========================================================================
    // SUMMARY
    // =========================================================================
    return {
      message: "Database seeded successfully!",
      created: {
        topics: 2,
        sources: 3,
        events: 2,
        articles: 6,
      },
      ids: {
        topics: { economy: topicEconomy, tech: topicTech },
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
    const articles = await ctx.db.query("articles").collect();
    for (const article of articles) {
      await ctx.db.delete(article._id);
    }

    const events = await ctx.db.query("events").collect();
    for (const event of events) {
      await ctx.db.delete(event._id);
    }

    const sources = await ctx.db.query("sources").collect();
    for (const source of sources) {
      await ctx.db.delete(source._id);
    }

    const topics = await ctx.db.query("topics").collect();
    for (const topic of topics) {
      await ctx.db.delete(topic._id);
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

    // Verify relationships: Get topic names for each event
    const eventsWithTopics = await Promise.all(
      events.map(async (event) => {
        const topicNames = await Promise.all(
          event.topicIds.map(async (topicId) => {
            const topic = await ctx.db.get(topicId);
            return topic?.displayName ?? "Unknown";
          })
        );
        return {
          title: event.title,
          topics: topicNames,
          articleCount: articles.filter((a) => a.eventId === event._id).length,
        };
      })
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
      })
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
