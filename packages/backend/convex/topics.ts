import { internalQuery, internalMutation, query } from "./_generated/server";
import { TOPIC_CATALOG } from "./topicCatalog";

export const getTopics = query({
  args: {},
  handler: async (ctx) => {
    const topics = await ctx.db.query("topics").collect();
    return topics.sort((a, b) => a.displayName.localeCompare(b.displayName));
  },
});

export const getTopicsForInference = internalQuery({
  args: {},
  handler: async (ctx) => {
    const topics = await ctx.db.query("topics").collect();
    return topics.sort((a, b) => a.displayName.localeCompare(b.displayName));
  },
});

export const syncTopicCatalog = internalMutation({
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
