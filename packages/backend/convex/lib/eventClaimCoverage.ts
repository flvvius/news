import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

function hasAtomicFacts(article: {
  atomicFacts?: string[];
  status?: string;
}): boolean {
  if (article.status === "discarded") return false;
  return (article.atomicFacts ?? []).some((fact) => fact.trim().length > 0);
}

export async function refreshEventClaimCoverage(
  ctx: MutationCtx,
  eventId: Id<"events">,
) {
  const event = await ctx.db.get(eventId);
  if (!event) return;

  const articles = await ctx.db
    .query("articles")
    .withIndex("by_event", (q) => q.eq("eventId", eventId))
    .collect();
  const factualArticles = articles.filter(hasAtomicFacts);
  const factualSourceCount = new Set(
    factualArticles.map((article) => article.sourceId),
  ).size;
  const lastFactualUpdateAt = factualArticles.reduce(
    (latest, article) => Math.max(latest, article.publishedAt),
    0,
  );

  await ctx.db.patch(eventId, {
    factualArticleCount: factualArticles.length,
    factualSourceCount,
    lastFactualUpdateAt:
      lastFactualUpdateAt > 0 ? lastFactualUpdateAt : undefined,
  });
}
