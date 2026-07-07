import { internalQuery, internalMutation, query } from "./_generated/server";
import { v } from "convex/values";
import { TOPIC_CATALOG, TOPIC_CATALOG_SLUGS } from "./topicCatalog";
import type { MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { syncPublicEventPreview } from "./lib/publicEventPreviews";

type TopicSyncResult = {
  created: number;
  updated: number;
  deleted: number;
  removedEventTopicLinks: number;
  removedFollowedTopicRefs: number;
  totalCatalogTopics: number;
};

type TopicSyncOptions = {
  pruneStale?: boolean;
};

function isCatalogTopic(topic: { slug: string }) {
  return TOPIC_CATALOG_SLUGS.has(topic.slug);
}

export const getTopics = query({
  args: {},
  handler: async (ctx) => {
    const topics = await ctx.db.query("topics").collect();
    return topics
      .filter(isCatalogTopic)
      .sort((a, b) => a.displayName.localeCompare(b.displayName));
  },
});

export const getTopicsForInference = internalQuery({
  args: {},
  handler: async (ctx) => {
    const topics = await ctx.db.query("topics").collect();
    return topics
      .filter(isCatalogTopic)
      .sort((a, b) => a.displayName.localeCompare(b.displayName));
  },
});

export const syncTopicCatalog = internalMutation({
  args: {
    pruneStale: v.optional(v.boolean()),
  },
  handler: async (ctx, { pruneStale }) => {
    return await syncTopicCatalogRows(ctx, { pruneStale });
  },
});

export async function syncTopicCatalogRows(
  ctx: MutationCtx,
  options: TopicSyncOptions = {},
): Promise<TopicSyncResult> {
  const sameStringArray = (
    a: string[] | undefined,
    b: string[] | undefined,
  ): boolean =>
    (a ?? []).length === (b ?? []).length &&
    (a ?? []).every((value, index) => value === (b ?? [])[index]);

  let created = 0;
  let updated = 0;
  let deleted = 0;
  let removedEventTopicLinks = 0;
  let removedFollowedTopicRefs = 0;
  const catalogSlugs = new Set(TOPIC_CATALOG.map((topic) => topic.slug));
  const affectedEventIds = new Set<Id<"events">>();

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

  const staleTopics = options.pruneStale
    ? (await ctx.db.query("topics").collect()).filter(
        (topic) => !catalogSlugs.has(topic.slug),
      )
    : [];
  const staleTopicIds = new Set(staleTopics.map((topic) => String(topic._id)));

  for (const staleTopic of staleTopics) {
    const eventTopicRows = await ctx.db
      .query("eventTopics")
      .withIndex("by_topic", (q) => q.eq("topicId", staleTopic._id))
      .collect();
    for (const row of eventTopicRows) {
      affectedEventIds.add(row.eventId);
      await ctx.db.delete(row._id);
      removedEventTopicLinks++;
    }
  }

  if (staleTopicIds.size > 0) {
    const users = await ctx.db.query("users").collect();
    for (const user of users) {
      const followedTopicIds = user.followedTopicIds ?? [];
      const nextFollowedTopicIds = followedTopicIds.filter(
        (topicId: Id<"topics">) => !staleTopicIds.has(String(topicId)),
      );
      if (nextFollowedTopicIds.length !== followedTopicIds.length) {
        await ctx.db.patch(user._id, {
          followedTopicIds: nextFollowedTopicIds,
        });
        removedFollowedTopicRefs +=
          followedTopicIds.length - nextFollowedTopicIds.length;
      }
    }
  }

  for (const staleTopic of staleTopics) {
    await ctx.db.delete(staleTopic._id);
    deleted++;
  }

  for (const eventId of affectedEventIds) {
    await syncPublicEventPreview(ctx, eventId);
  }

  return {
    created,
    updated,
    deleted,
    removedEventTopicLinks,
    removedFollowedTopicRefs,
    totalCatalogTopics: TOPIC_CATALOG.length,
  };
}
