import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";

const DEFAULT_WINDOW_DAYS = 30;
const DEFAULT_MIN_SAMPLES = 10;
const DEFAULT_STDDEV_MULTIPLIER = 2;
const DEFAULT_STDDEV_FLOOR = 0.5;

async function getConfigNumber(
  ctx: MutationCtx,
  key: string,
  fallback: number,
  min: number,
  max: number,
): Promise<number> {
  const row = await ctx.db
    .query("config")
    .withIndex("by_key", (q) => q.eq("key", key))
    .unique();
  if (!row) return fallback;

  try {
    const parsed = JSON.parse(row.value);
    const value = typeof parsed === "number" ? parsed : Number(parsed);
    if (!Number.isFinite(value)) return fallback;
    return Math.min(max, Math.max(min, value));
  } catch {
    return fallback;
  }
}

function mean(values: number[]): number {
  if (values.length === 0) {
    throw new Error("mean requires non-empty array");
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function standardDeviation(values: number[], average: number): number {
  if (values.length === 0) {
    throw new Error("standardDeviation requires non-empty array");
  }
  const variance =
    values.reduce((sum, value) => sum + (value - average) ** 2, 0) /
    values.length;
  return Math.sqrt(variance);
}

export const flagBiasOutliers = internalMutation({
  args: {
    sourceId: v.optional(v.id("sources")),
  },
  handler: async (ctx, args) => {
    const [windowDays, minSamples, multiplier, stddevFloor] =
      await Promise.all([
        getConfigNumber(
          ctx,
          "article_bias_outlier_window_days",
          DEFAULT_WINDOW_DAYS,
          1,
          365,
        ),
        getConfigNumber(
          ctx,
          "article_bias_outlier_min_samples",
          DEFAULT_MIN_SAMPLES,
          2,
          500,
        ),
        getConfigNumber(
          ctx,
          "article_bias_outlier_stddev_multiplier",
          DEFAULT_STDDEV_MULTIPLIER,
          0.5,
          5,
        ),
        getConfigNumber(
          ctx,
          "article_bias_outlier_stddev_floor",
          DEFAULT_STDDEV_FLOOR,
          0.1,
          3,
        ),
      ]);

    const cutoff = Date.now() - windowDays * 24 * 60 * 60 * 1000;
    const sources = args.sourceId
      ? [await ctx.db.get(args.sourceId)].filter((source) => source !== null)
      : await ctx.db.query("sources").collect();

    let sourcesUpdated = 0;
    let articlesChecked = 0;
    let articlesFlagged = 0;

    for (const source of sources) {
      const recent = await ctx.db
        .query("articles")
        .withIndex("by_source_analyzed", (q) =>
          q.eq("sourceId", source._id).gt("biasAnalyzedAt", cutoff),
        )
        .collect();

      const scored = recent.filter(
        (article) => typeof article.aiBiasScore === "number",
      );
      if (scored.length < minSamples) {
        await ctx.db.patch(source._id, {
          rollingBiasSampleSize: scored.length,
          rollingBiasUpdatedAt: Date.now(),
        });
        continue;
      }

      const scores = scored.map((article) => article.aiBiasScore!);
      let rollingBiasMean: number;
      let rollingBiasStddev: number;
      try {
        rollingBiasMean = mean(scores);
        rollingBiasStddev = Math.max(
          standardDeviation(scores, rollingBiasMean),
          stddevFloor,
        );
      } catch (error) {
        console.error(
          `[bias] Failed to compute rolling stats for source ${source._id}: ${
            error instanceof Error ? error.message : "unknown error"
          }`,
        );
        await ctx.db.patch(source._id, {
          rollingBiasSampleSize: scored.length,
          rollingBiasUpdatedAt: Date.now(),
        });
        continue;
      }
      const threshold = multiplier * rollingBiasStddev;

      for (const article of scored) {
        const isOutlier =
          Math.abs(article.aiBiasScore! - rollingBiasMean) > threshold;
        articlesChecked++;
        if (isOutlier) articlesFlagged++;
        if (article.biasOutlierFlag !== isOutlier) {
          await ctx.db.patch(article._id, { biasOutlierFlag: isOutlier });
        }
      }

      await ctx.db.patch(source._id, {
        rollingBiasMean,
        rollingBiasStddev,
        rollingBiasSampleSize: scored.length,
        rollingBiasUpdatedAt: Date.now(),
      });
      sourcesUpdated++;
    }

    return {
      sourcesChecked: sources.length,
      sourcesUpdated,
      articlesChecked,
      articlesFlagged,
    };
  },
});
