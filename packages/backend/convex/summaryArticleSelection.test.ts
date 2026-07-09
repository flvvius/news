import { describe, expect, test } from "vitest";

import {
  leanForBiasLabel,
  selectSummaryArticles,
  type SelectableSummaryArticle,
} from "./lib/summaryArticleSelection";

let nextId = 0;
function article(overrides: {
  publishedAt: number;
  biasLabel?: string;
  sourceId?: string;
  extractionQuality?: "strong" | "weak";
}): SelectableSummaryArticle {
  nextId += 1;
  return {
    _id: `article_${String(nextId).padStart(4, "0")}`,
    publishedAt: overrides.publishedAt,
    extractionQuality: overrides.extractionQuality,
    source:
      overrides.biasLabel === undefined && overrides.sourceId === undefined
        ? null
        : {
            _id: overrides.sourceId ?? `source_${nextId}`,
            biasLabel: overrides.biasLabel,
          },
  };
}

describe("leanForBiasLabel", () => {
  test("maps the five labels + unknown to the three buckets", () => {
    expect(leanForBiasLabel("left")).toBe("reformist");
    expect(leanForBiasLabel("left-center")).toBe("reformist");
    expect(leanForBiasLabel("right")).toBe("suveranist");
    expect(leanForBiasLabel("right-center")).toBe("suveranist");
    expect(leanForBiasLabel("center")).toBe("center");
    expect(leanForBiasLabel(undefined)).toBe("center");
    expect(leanForBiasLabel("weird")).toBe("center");
  });
});

describe("selectSummaryArticles", () => {
  test("returns everything (newest first) when under the cap", () => {
    const articles = [
      article({ publishedAt: 100, biasLabel: "left" }),
      article({ publishedAt: 300, biasLabel: "center" }),
      article({ publishedAt: 200, biasLabel: "right" }),
    ];
    const selected = selectSummaryArticles(articles, 12);
    expect(selected.map((a) => a.publishedAt)).toEqual([300, 200, 100]);
  });

  test("keeps the minority side in the prompt instead of letting recency crowd it out", () => {
    // 15 recent reformist articles + 2 older suveranist ones. The old
    // recency slice at cap 12 dropped both suveranist articles → forced
    // CASE-A fallback despite genuine cross-lean coverage.
    const reformist = Array.from({ length: 15 }, (_, i) =>
      article({ publishedAt: 1000 + i, biasLabel: "left" }),
    );
    const suveranist = [
      article({ publishedAt: 10, biasLabel: "right" }),
      article({ publishedAt: 20, biasLabel: "right-center" }),
    ];
    const selected = selectSummaryArticles(
      [...reformist, ...suveranist],
      12,
    );
    const suveranistSelected = selected.filter(
      (a) => leanForBiasLabel(a.source?.biasLabel) === "suveranist",
    );
    expect(selected).toHaveLength(12);
    expect(suveranistSelected).toHaveLength(2);
  });

  test("prefers unseen sources within a bucket", () => {
    // Source A floods the reformist bucket with the newest articles; the
    // round-robin should still pull in source B's older reformist article.
    const floodA = Array.from({ length: 20 }, (_, i) =>
      article({ publishedAt: 2000 + i, biasLabel: "left", sourceId: "A" }),
    );
    const oldB = article({
      publishedAt: 1,
      biasLabel: "left",
      sourceId: "B",
    });
    const selected = selectSummaryArticles([...floodA, oldB], 12);
    expect(selected.some((a) => a.source?._id === "B")).toBe(true);
  });

  test("ranks strong-extraction articles above newer weak ones in a bucket", () => {
    const weakNew = Array.from({ length: 20 }, (_, i) =>
      article({
        publishedAt: 5000 + i,
        biasLabel: "center",
        sourceId: "W",
        extractionQuality: "weak",
      }),
    );
    const strongOld = article({
      publishedAt: 1,
      biasLabel: "center",
      sourceId: "S",
      extractionQuality: "strong",
    });
    const selected = selectSummaryArticles([...weakNew, strongOld], 3);
    expect(selected.some((a) => a.source?._id === "S")).toBe(true);
  });

  test("is deterministic regardless of input order", () => {
    const articles = [
      ...Array.from({ length: 10 }, (_, i) =>
        article({ publishedAt: 100 + i, biasLabel: "left", sourceId: `L${i}` }),
      ),
      ...Array.from({ length: 10 }, (_, i) =>
        article({ publishedAt: 200 + i, biasLabel: "right", sourceId: `R${i}` }),
      ),
      ...Array.from({ length: 10 }, (_, i) =>
        article({ publishedAt: 300 + i, biasLabel: "center", sourceId: `C${i}` }),
      ),
    ];
    const forward = selectSummaryArticles(articles, 12);
    const reversed = selectSummaryArticles([...articles].reverse(), 12);
    expect(reversed.map((a) => a._id)).toEqual(forward.map((a) => a._id));
  });

  test("handles sourceless articles without throwing", () => {
    const articles = Array.from({ length: 25 }, (_, i) =>
      article({ publishedAt: i } as { publishedAt: number }),
    );
    const selected = selectSummaryArticles(articles, 12);
    expect(selected).toHaveLength(12);
  });
});
