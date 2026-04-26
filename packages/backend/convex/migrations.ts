/**
 * One-time migrations. Run manually:
 *   npx convex run migrations:<functionName>
 *
 * Safe to run multiple times (idempotent — patches existing rows).
 * Can be deleted after running.
 *
 * All legacy migrations were removed after the dev DB wipe on 2026-03-05.
 */

import { mutation } from "./_generated/server";
import { TOPIC_CATALOG } from "./topicCatalog";
import { normalizeArticleSnippet, normalizeArticleTitle } from "./ingestion";

export const syncTopicCatalogMigration = mutation({
  args: {},
  handler: async (ctx) => {
    const sameStringArray = (
      a: string[] | undefined,
      b: string[] | undefined,
    ): boolean =>
      (a ?? []).length === (b ?? []).length &&
      (a ?? []).every((value, index) => value === (b ?? [])[index]);

    let created = 0;
    let updated = 0;

    for (const topic of TOPIC_CATALOG) {
      const existing = await ctx.db
        .query("topics")
        .withIndex("by_slug", (q) => q.eq("slug", topic.slug))
        .unique();

      const nextValues = {
        slug: topic.slug,
        displayName: topic.displayName,
        description: topic.description,
        aliases: topic.aliases,
        keywords: topic.keywords,
        keyPhrases: topic.keyPhrases,
        excludePhrases: topic.excludePhrases,
      };

      if (!existing) {
        await ctx.db.insert("topics", nextValues);
        created++;
        continue;
      }

      const hasChanges =
        existing.displayName !== nextValues.displayName ||
        existing.description !== nextValues.description ||
        !sameStringArray(existing.aliases, nextValues.aliases) ||
        !sameStringArray(existing.keywords, nextValues.keywords) ||
        !sameStringArray(existing.keyPhrases, nextValues.keyPhrases) ||
        !sameStringArray(existing.excludePhrases, nextValues.excludePhrases);

      if (hasChanges) {
        await ctx.db.patch(existing._id, nextValues);
        updated++;
      }
    }

    return {
      created,
      updated,
      totalCatalogTopics: TOPIC_CATALOG.length,
    };
  },
});

export const normalizeStoredArticleText = mutation({
  args: {},
  handler: async (ctx) => {
    const articles = await ctx.db.query("articles").collect();
    const events = await ctx.db.query("events").collect();

    let updatedArticles = 0;
    let updatedEvents = 0;

    for (const article of articles) {
      const nextTitle = normalizeArticleTitle(article.title);
      const nextSnippet = article.rssSnippet
        ? normalizeArticleSnippet(article.rssSnippet)
        : undefined;
      const nextSummary = article.summary
        ? normalizeArticleSnippet(article.summary)
        : undefined;
      const nextAtomicFacts = article.atomicFacts?.map((fact) =>
        normalizeArticleSnippet(fact),
      );

      const atomicFactsChanged =
        (article.atomicFacts ?? []).length !== (nextAtomicFacts ?? []).length ||
        (article.atomicFacts ?? []).some(
          (fact, index) => fact !== nextAtomicFacts?.[index],
        );

      if (
        nextTitle !== article.title ||
        nextSnippet !== article.rssSnippet ||
        nextSummary !== article.summary ||
        atomicFactsChanged
      ) {
        await ctx.db.patch(article._id, {
          title: nextTitle,
          rssSnippet: nextSnippet,
          summary: nextSummary,
          atomicFacts: nextAtomicFacts,
        });
        updatedArticles++;
      }
    }

    for (const event of events) {
      const nextTitle = normalizeArticleTitle(event.title);
      const nextCenter = event.perspectiveSummaries?.center
        ? normalizeArticleSnippet(event.perspectiveSummaries.center)
        : undefined;
      const nextLeft = event.perspectiveSummaries?.left
        ? normalizeArticleSnippet(event.perspectiveSummaries.left)
        : undefined;
      const nextRight = event.perspectiveSummaries?.right
        ? normalizeArticleSnippet(event.perspectiveSummaries.right)
        : undefined;
      const nextGlobalImpact = event.globalImpact
        ? normalizeArticleSnippet(event.globalImpact)
        : undefined;

      if (
        nextTitle !== event.title ||
        nextCenter !== event.perspectiveSummaries?.center ||
        nextLeft !== event.perspectiveSummaries?.left ||
        nextRight !== event.perspectiveSummaries?.right ||
        nextGlobalImpact !== event.globalImpact
      ) {
        await ctx.db.patch(event._id, {
          title: nextTitle,
          perspectiveSummaries: event.perspectiveSummaries
            ? {
                center: nextCenter,
                left: nextLeft,
                right: nextRight,
              }
            : undefined,
          globalImpact: nextGlobalImpact,
        });
        updatedEvents++;
      }
    }

    return {
      updatedArticles,
      updatedEvents,
    };
  },
});


export const backfillLogoUrls = mutation({
  args: {},
  handler: async (ctx) => {
    const sources = await ctx.db.query("sources").collect();
    let updated = 0;

    for (const source of sources) {
      // Skip sources that already have a curated SVG/PNG (anything not pointing at clearbit/duckduckgo/google)
      const isAutoLogo =
        !source.logoUrl ||
        source.logoUrl.includes("logo.clearbit.com") ||
        source.logoUrl.includes("icons.duckduckgo.com") ||
        source.logoUrl.includes("google.com/s2/favicons");

      if (!isAutoLogo) continue;
      if (!source.domain) continue;

      const newUrl = `https://icons.duckduckgo.com/ip3/${source.domain}.ico`;
      await ctx.db.patch(source._id, { logoUrl: newUrl });
      updated++;
    }

    return { totalSources: sources.length, updated };
  },
});

export const dedupeWaitlistByEmail = mutation({
  args: {},
  handler: async (ctx) => {
    const entries = await ctx.db.query("waitlist").collect();
    const grouped = new Map<string, typeof entries>();

    for (const entry of entries) {
      const existing = grouped.get(entry.email) ?? [];
      existing.push(entry);
      grouped.set(entry.email, existing);
    }

    const statusRank: Record<
      "pending" | "invited" | "converted" | "bounced" | "unsubscribed",
      number
    > = {
      converted: 5,
      invited: 4,
      pending: 3,
      bounced: 2,
      unsubscribed: 1,
    };

    let groupsDeduped = 0;
    let rowsDeleted = 0;

    for (const duplicates of grouped.values()) {
      if (duplicates.length < 2) continue;

      const sorted = [...duplicates].sort((a, b) => {
        const rankDiff = statusRank[b.status] - statusRank[a.status];
        if (rankDiff !== 0) return rankDiff;
        return a.createdAt - b.createdAt;
      });

      const keeper = sorted[0]!;
      const rest = sorted.slice(1);

      const merged = {
        name: keeper.name ?? rest.find((row) => row.name)?.name,
        referralSource:
          keeper.referralSource ?? rest.find((row) => row.referralSource)?.referralSource,
        invitedAt:
          keeper.invitedAt ?? rest.map((row) => row.invitedAt).find((value) => value !== undefined),
        convertedAt:
          keeper.convertedAt ??
          rest.map((row) => row.convertedAt).find((value) => value !== undefined),
        lastEmailSentAt:
          keeper.lastEmailSentAt ??
          rest
            .map((row) => row.lastEmailSentAt)
            .find((value) => value !== undefined),
        inviteCode:
          keeper.inviteCode ?? rest.map((row) => row.inviteCode).find((value) => value !== undefined),
      };

      await ctx.db.patch(keeper._id, merged);

      for (const duplicate of rest) {
        await ctx.db.delete(duplicate._id);
        rowsDeleted++;
      }

      groupsDeduped++;
    }

    return {
      totalEntries: entries.length,
      groupsDeduped,
      rowsDeleted,
    };
  },
});
