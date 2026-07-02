/**
 * Clustering threshold tuning for Romanian data (BIV-501).
 *
 * The clustering thresholds are config-driven (clustering_min_similarity,
 * clustering_strong_similarity, … — see config.ts seedDefaults and the
 * pipelineRuntimeConfig snapshot). This module provides the measurement
 * side: sweep the cosine-similarity threshold over the hand-labeled
 * clusterPairLabels set and report false-merge vs false-split rates so an
 * operator can pick a threshold with evidence.
 *
 * Workflow (docs/clustering-romanian-tuning.md):
 *  1. Let ingestion collect a few days of real Romanian articles.
 *  2. Hand-label candidate pairs via clustering:labelClusterPairForAdmin.
 *  3. npx convex run clusteringTuning:sweepClusteringThresholds
 *  4. Set the chosen threshold via config:set clustering_min_similarity.
 */

import { v } from "convex/values";
import { internalQuery } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { normalizeTitleTokens } from "./clustering";

function cosineSimilarity(a: number[], b: number[]): number {
  const length = Math.min(a.length, b.length);
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < length; i++) {
    const av = a[i] ?? 0;
    const bv = b[i] ?? 0;
    dot += av * bv;
    normA += av * av;
    normB += bv * bv;
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

function latestEmbedding(
  rows: Doc<"articleEmbeddings">[],
): number[] | null {
  const latest = rows.reduce<Doc<"articleEmbeddings"> | null>((best, row) => {
    if (!best) return row;
    if (row.version !== best.version) {
      return row.version > best.version ? row : best;
    }
    return row._creationTime > best._creationTime ? row : best;
  }, null);
  return latest?.embedding ?? null;
}

const DEFAULT_THRESHOLDS = [
  0.6, 0.64, 0.68, 0.7, 0.72, 0.74, 0.76, 0.78, 0.8, 0.82, 0.84, 0.86, 0.88,
  0.9, 0.92,
];

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let overlap = 0;
  for (const token of a) {
    if (b.has(token)) overlap++;
  }
  return overlap / (a.size + b.size - overlap);
}

/**
 * Sweep cosine thresholds against the hand-labeled pair set, modeling the
 * production join rule rather than raw cosine alone: a pair "merges" when
 * cosine ≥ strongThreshold, or cosine ≥ candidate threshold AND the title
 * lexical gate passes (overlap + Jaccard, same defaults as production).
 * The full production path has further gates (same-source, weak-extraction,
 * topic support), so the reported false-merge rate is an upper bound.
 *
 * Run: npx convex run clusteringTuning:sweepClusteringThresholds
 */
export const sweepClusteringThresholds = internalQuery({
  args: {
    thresholds: v.optional(v.array(v.number())),
    strongThreshold: v.optional(v.number()),
    minTitleOverlap: v.optional(v.number()),
    minTitleJaccard: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const strongThreshold = args.strongThreshold ?? 0.84;
    const minTitleOverlap = args.minTitleOverlap ?? 1;
    const minTitleJaccard = args.minTitleJaccard ?? 0.1;

    const labels = await ctx.db.query("clusterPairLabels").collect();

    const scored: Array<{
      similarity: number;
      titleGatePasses: boolean;
      sameEvent: boolean;
    }> = [];
    let missingEmbeddings = 0;

    for (const label of labels) {
      const [leftArticle, rightArticle, leftRows, rightRows] =
        await Promise.all([
          ctx.db.get(label.leftArticleId),
          ctx.db.get(label.rightArticleId),
          ctx.db
            .query("articleEmbeddings")
            .withIndex("by_article", (q) =>
              q.eq("articleId", label.leftArticleId),
            )
            .collect(),
          ctx.db
            .query("articleEmbeddings")
            .withIndex("by_article", (q) =>
              q.eq("articleId", label.rightArticleId),
            )
            .collect(),
        ]);
      const left = latestEmbedding(leftRows);
      const right = latestEmbedding(rightRows);
      if (!left || !right || !leftArticle || !rightArticle) {
        missingEmbeddings++;
        continue;
      }

      const leftTokens = normalizeTitleTokens(leftArticle.title);
      const rightTokens = normalizeTitleTokens(rightArticle.title);
      let overlap = 0;
      for (const token of leftTokens) {
        if (rightTokens.has(token)) overlap++;
      }
      const titleGatePasses =
        overlap >= minTitleOverlap &&
        jaccard(leftTokens, rightTokens) >= minTitleJaccard;

      scored.push({
        similarity: cosineSimilarity(left, right),
        titleGatePasses,
        sameEvent: label.sameEvent,
      });
    }

    const thresholds = (args.thresholds ?? DEFAULT_THRESHOLDS)
      .filter((t) => Number.isFinite(t) && t > 0 && t < 1)
      .sort((a, b) => a - b);

    const sweep = thresholds.map((threshold) => {
      let truePositives = 0; // same event, merged
      let falseMerges = 0; // different events, merged
      let falseSplits = 0; // same event, split
      let trueNegatives = 0; // different events, split

      for (const pair of scored) {
        // Mirrors the production join rule: strong similarity overrides the
        // lexical gate; otherwise both similarity and title gate must pass.
        const merged =
          pair.similarity >= strongThreshold ||
          (pair.similarity >= threshold && pair.titleGatePasses);
        if (pair.sameEvent && merged) truePositives++;
        else if (!pair.sameEvent && merged) falseMerges++;
        else if (pair.sameEvent && !merged) falseSplits++;
        else trueNegatives++;
      }

      const precision =
        truePositives + falseMerges > 0
          ? truePositives / (truePositives + falseMerges)
          : null;
      const recall =
        truePositives + falseSplits > 0
          ? truePositives / (truePositives + falseSplits)
          : null;
      const f1 =
        precision !== null && recall !== null && precision + recall > 0
          ? (2 * precision * recall) / (precision + recall)
          : null;

      return {
        threshold,
        truePositives,
        falseMerges,
        falseSplits,
        trueNegatives,
        precision,
        recall,
        f1,
      };
    });

    return {
      labeledPairs: labels.length,
      scoredPairs: scored.length,
      missingEmbeddings,
      strongThreshold,
      minTitleOverlap,
      minTitleJaccard,
      sweep,
    };
  },
});
