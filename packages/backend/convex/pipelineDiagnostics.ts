import { v } from "convex/values";
import { internalQuery } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";

function hasText(value: string | undefined, minLength: number): boolean {
  return (value ?? "").trim().length >= minLength;
}

function hasAtomicFacts(article: Doc<"articles">): boolean {
  return (article.atomicFacts ?? []).some((fact) => fact.trim().length > 0);
}

function hasPerspectiveSummary(event: Doc<"events">): boolean {
  return Boolean(
    event.lastSummarizedAt &&
      event.perspectiveSummaries?.center?.trim() &&
      event.perspectiveSummaries?.left?.trim() &&
      event.perspectiveSummaries?.right?.trim() &&
      event.globalImpact?.trim(),
  );
}

function summarizeDrop(from: number, to: number) {
  return {
    count: from - to,
    pctOfPrevious: from === 0 ? 0 : Math.round(((from - to) / from) * 1000) / 10,
  };
}

export const eventAiFunnel = internalQuery({
  args: {
    days: v.optional(v.number()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const days = Math.max(1, Math.min(60, Math.floor(args.days ?? 14)));
    const limit = Math.max(1, Math.min(2000, Math.floor(args.limit ?? 1000)));
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
    const events = (
      await ctx.db
        .query("events")
        .withIndex("by_status_recency", (q) => q.eq("status", "published"))
        .order("desc")
        .take(limit)
    ).filter((event) => event.firstPublishedAt > cutoff);

    const stageEventIds = {
      published: new Set<Id<"events">>(),
      article3: new Set<Id<"events">>(),
      source2: new Set<Id<"events">>(),
      factualArticle3: new Set<Id<"events">>(),
      factualSource2: new Set<Id<"events">>(),
      summarized: new Set<Id<"events">>(),
      claimAnalyzed: new Set<Id<"events">>(),
      hasClaims: new Set<Id<"events">>(),
    };

    const samples = {
      missingArticleCoverage: [] as Array<{
        eventId: Id<"events">;
        title: string;
        articleCount: number;
        sourceCount: number;
      }>,
      missingFactualCoverage: [] as Array<{
        eventId: Id<"events">;
        title: string;
        articleCount: number;
        sourceCount: number;
        factualArticleCount: number;
        factualSourceCount: number;
      }>,
      qualifiedNoSummary: [] as Array<{
        eventId: Id<"events">;
        title: string;
        factualArticleCount: number;
        factualSourceCount: number;
        latestSummaryJobStatus?: string;
        latestSummaryJobReason?: string;
        latestSummaryJobError?: string;
      }>,
      eligibleNoClaimAnalysis: [] as Array<{
        eventId: Id<"events">;
        title: string;
        factualArticleCount: number;
        factualSourceCount: number;
      }>,
      claimAnalyzedNoClaimRows: [] as Array<{
        eventId: Id<"events">;
        title: string;
        lastClaimAnalysisAt?: number;
        factualArticleCount: number;
        factualSourceCount: number;
      }>,
      summarizedNoClaims: [] as Array<{
        eventId: Id<"events">;
        title: string;
        lastClaimAnalysisAt?: number;
        factualArticleCount: number;
        factualSourceCount: number;
      }>,
    };

    for (const event of events) {
      stageEventIds.published.add(event._id);

      const articles = await ctx.db
        .query("articles")
        .withIndex("by_event", (q) => q.eq("eventId", event._id))
        .collect();
      const sourceCount = new Set(articles.map((article) => article.sourceId))
        .size;
      const factualArticles = articles.filter(hasAtomicFacts);
      const factualSourceCount = new Set(
        factualArticles.map((article) => article.sourceId),
      ).size;
      const claimEligible =
        articles.length >= 3 &&
        sourceCount >= 2 &&
        factualArticles.length >= 3 &&
        factualSourceCount >= 2;

      if (articles.length >= 3) stageEventIds.article3.add(event._id);
      if (articles.length >= 3 && sourceCount >= 2) {
        stageEventIds.source2.add(event._id);
      } else if (samples.missingArticleCoverage.length < 10) {
        samples.missingArticleCoverage.push({
          eventId: event._id,
          title: event.title,
          articleCount: articles.length,
          sourceCount,
        });
      }

      if (articles.length >= 3 && sourceCount >= 2 && factualArticles.length >= 3) {
        stageEventIds.factualArticle3.add(event._id);
      }
      if (claimEligible) {
        stageEventIds.factualSource2.add(event._id);
      } else if (
        articles.length >= 3 &&
        sourceCount >= 2 &&
        samples.missingFactualCoverage.length < 10
      ) {
        samples.missingFactualCoverage.push({
          eventId: event._id,
          title: event.title,
          articleCount: articles.length,
          sourceCount,
          factualArticleCount: factualArticles.length,
          factualSourceCount,
        });
      }

      if (hasPerspectiveSummary(event)) {
        stageEventIds.summarized.add(event._id);
      }
      if (claimEligible && event.lastClaimAnalysisAt) {
        stageEventIds.claimAnalyzed.add(event._id);
      }

      const hasClaimRows = Boolean(
        await ctx.db
          .query("eventClaims")
          .withIndex("by_event", (q) => q.eq("eventId", event._id))
          .first(),
      );
      if (claimEligible && hasClaimRows) stageEventIds.hasClaims.add(event._id);

      if (claimEligible && !hasPerspectiveSummary(event) && samples.qualifiedNoSummary.length < 10) {
        const latestJob = await ctx.db
          .query("eventSummaryJobs")
          .withIndex("by_event_updatedAt", (q) => q.eq("eventId", event._id))
          .order("desc")
          .first();
        samples.qualifiedNoSummary.push({
          eventId: event._id,
          title: event.title,
          factualArticleCount: factualArticles.length,
          factualSourceCount,
          latestSummaryJobStatus: latestJob?.status,
          latestSummaryJobReason: latestJob?.reason,
          latestSummaryJobError: latestJob?.lastError,
        });
      }

      if (
        claimEligible &&
        !event.lastClaimAnalysisAt &&
        samples.eligibleNoClaimAnalysis.length < 10
      ) {
        samples.eligibleNoClaimAnalysis.push({
          eventId: event._id,
          title: event.title,
          factualArticleCount: factualArticles.length,
          factualSourceCount,
        });
      }

      if (
        claimEligible &&
        event.lastClaimAnalysisAt &&
        !hasClaimRows &&
        samples.claimAnalyzedNoClaimRows.length < 10
      ) {
        samples.claimAnalyzedNoClaimRows.push({
          eventId: event._id,
          title: event.title,
          lastClaimAnalysisAt: event.lastClaimAnalysisAt,
          factualArticleCount: factualArticles.length,
          factualSourceCount,
        });
      }

      if (
        hasPerspectiveSummary(event) &&
        claimEligible &&
        !hasClaimRows &&
        samples.summarizedNoClaims.length < 10
      ) {
        samples.summarizedNoClaims.push({
          eventId: event._id,
          title: event.title,
          lastClaimAnalysisAt: event.lastClaimAnalysisAt,
          factualArticleCount: factualArticles.length,
          factualSourceCount,
        });
      }
    }

    const stages = {
      published: stageEventIds.published.size,
      articleCountAtLeast3: stageEventIds.article3.size,
      sourceCountAtLeast2: stageEventIds.source2.size,
      factualArticleCountAtLeast3: stageEventIds.factualArticle3.size,
      factualSourceCountAtLeast2: stageEventIds.factualSource2.size,
      summarized: stageEventIds.summarized.size,
      claimAnalyzed: stageEventIds.claimAnalyzed.size,
      hasClaimRows: stageEventIds.hasClaims.size,
    };

    return {
      windowDays: days,
      scannedEvents: events.length,
      cutoff,
      stages,
      drops: {
        publishedToArticle3: summarizeDrop(
          stages.published,
          stages.articleCountAtLeast3,
        ),
        article3ToSource2: summarizeDrop(
          stages.articleCountAtLeast3,
          stages.sourceCountAtLeast2,
        ),
        source2ToFactualArticle3: summarizeDrop(
          stages.sourceCountAtLeast2,
          stages.factualArticleCountAtLeast3,
        ),
        factualArticle3ToFactualSource2: summarizeDrop(
          stages.factualArticleCountAtLeast3,
          stages.factualSourceCountAtLeast2,
        ),
        factualSource2ToSummarized: summarizeDrop(
          stages.factualSourceCountAtLeast2,
          stages.summarized,
        ),
        factualSource2ToClaimAnalyzed: summarizeDrop(
          stages.factualSourceCountAtLeast2,
          stages.claimAnalyzed,
        ),
        claimAnalyzedToClaimRows: summarizeDrop(
          stages.claimAnalyzed,
          stages.hasClaimRows,
        ),
      },
      samples,
    };
  },
});

export const articleFactExtractionFunnel = internalQuery({
  args: {
    days: v.optional(v.number()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const days = Math.max(1, Math.min(60, Math.floor(args.days ?? 14)));
    const limit = Math.max(1, Math.min(5000, Math.floor(args.limit ?? 2000)));
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
    const articles = (
      await ctx.db.query("articles").withIndex("by_published").order("desc").take(limit)
    ).filter((article) => article.publishedAt > cutoff);

    const byStatus = new Map<string, number>();
    const byFactStatus = new Map<string, number>();
    const byExtractionQuality = new Map<string, number>();
    for (const article of articles) {
      byStatus.set(article.status, (byStatus.get(article.status) ?? 0) + 1);
      byFactStatus.set(
        article.factExtractionStatus ?? "unset",
        (byFactStatus.get(article.factExtractionStatus ?? "unset") ?? 0) + 1,
      );
      byExtractionQuality.set(
        article.extractionQuality ?? "unset",
        (byExtractionQuality.get(article.extractionQuality ?? "unset") ?? 0) +
          1,
      );
    }

    return {
      windowDays: days,
      scannedArticles: articles.length,
      cutoff,
      total: articles.length,
      withSummary: articles.filter((article) => hasText(article.summary, 80))
        .length,
      withUsefulSummary: articles.filter((article) =>
        hasText(article.summary, 200),
      ).length,
      withUsefulRssSnippet: articles.filter((article) =>
        hasText(article.rssSnippet, 200),
      ).length,
      withEntities: articles.filter((article) => (article.entities ?? []).length > 0)
        .length,
      withAtomicFacts: articles.filter(hasAtomicFacts).length,
      withBiasScore: articles.filter(
        (article) => typeof article.aiBiasScore === "number",
      ).length,
      factExtractionSucceeded: articles.filter(
        (article) => article.factExtractionStatus === "succeeded",
      ).length,
      factExtractionSucceededEmpty: articles.filter(
        (article) => article.factExtractionStatus === "succeeded_empty",
      ).length,
      factExtractionDeferred: articles.filter(
        (article) => article.factExtractionStatus === "deferred",
      ).length,
      factExtractionFailed: articles.filter(
        (article) => article.factExtractionStatus === "failed",
      ).length,
      factExtractionSkipped: articles.filter(
        (article) => article.factExtractionStatus === "skipped",
      ).length,
      neverFactAttempted: articles.filter(
        (article) => article.factExtractionStatus === undefined,
      ).length,
      needsFactExtraction: articles.filter(
        (article) =>
          article.status !== "processing" &&
          article.status !== "discarded" &&
          !hasAtomicFacts(article) &&
          article.factExtractionStatus !== "skipped" &&
          article.factExtractionStatus !== "succeeded_empty",
      ).length,
      byStatus: Object.fromEntries(byStatus.entries()),
      byFactStatus: Object.fromEntries(byFactStatus.entries()),
      byExtractionQuality: Object.fromEntries(byExtractionQuality.entries()),
      samplesNeedingFacts: articles
        .filter(
          (article) =>
            article.status !== "processing" &&
            article.status !== "discarded" &&
            !hasAtomicFacts(article) &&
            article.factExtractionStatus !== "skipped" &&
            article.factExtractionStatus !== "succeeded_empty",
        )
        .slice(0, 10)
        .map((article) => ({
          articleId: article._id,
          eventId: article.eventId,
          title: article.title,
          status: article.status,
          factExtractionStatus: article.factExtractionStatus,
          factExtractionError: article.factExtractionError,
          summaryLength: (article.summary ?? "").length,
          rssSnippetLength: (article.rssSnippet ?? "").length,
          extractionQuality: article.extractionQuality,
        })),
    };
  },
});
