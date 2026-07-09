export type SelectableSummaryArticle = {
  _id: string;
  publishedAt: number;
  extractionQuality?: "strong" | "weak";
  source?: {
    _id: string;
    biasLabel?: string;
  } | null;
};

export type SummaryLean = "reformist" | "suveranist" | "center";

/**
 * Same label→pole mapping as framingLabelFor in prompts.ts (negative axis =
 * reformist, positive = suveranist; docs/bias-axis-spec.md). Center and
 * unknown labels share a bucket: neither informs a perspective field.
 */
export function leanForBiasLabel(biasLabel: string | undefined): SummaryLean {
  const label = (biasLabel ?? "").toLowerCase();
  if (label === "left" || label === "left-center") return "reformist";
  if (label === "right" || label === "right-center") return "suveranist";
  return "center";
}

const BUCKET_ORDER: SummaryLean[] = ["reformist", "suveranist", "center"];

/**
 * Pick the articles that go into one event-summary prompt. A pure recency
 * slice let one prolific side crowd the other out of the cap entirely,
 * forcing the prompt's CASE-A "Acoperire limitată" fallback even when
 * cross-lean coverage existed on the event. Round-robin across the lean
 * buckets keeps every represented side in the prompt; within a bucket,
 * strong-extraction articles rank first (their transient body fetch is far
 * likelier to succeed), unseen sources are preferred, newest first.
 * Deterministic for a given article set — the result feeds the summary
 * signature.
 */
export function selectSummaryArticles<T extends SelectableSummaryArticle>(
  articles: T[],
  maxArticles: number,
): T[] {
  const limit = Math.min(Math.max(Math.floor(maxArticles), 3), 20);
  const byRecency = (a: T, b: T) =>
    b.publishedAt - a.publishedAt || a._id.localeCompare(b._id);

  if (articles.length <= limit) {
    return [...articles].sort(byRecency);
  }

  const buckets = new Map<SummaryLean, T[]>();
  for (const article of articles) {
    const lean = leanForBiasLabel(article.source?.biasLabel);
    const bucket = buckets.get(lean) ?? [];
    bucket.push(article);
    buckets.set(lean, bucket);
  }
  for (const bucket of buckets.values()) {
    bucket.sort((a, b) => {
      const strongA = a.extractionQuality === "strong" ? 1 : 0;
      const strongB = b.extractionQuality === "strong" ? 1 : 0;
      if (strongA !== strongB) return strongB - strongA;
      return byRecency(a, b);
    });
  }

  const selected: T[] = [];
  const seenSourceIds = new Set<string>();

  while (selected.length < limit) {
    let pickedAny = false;
    for (const lean of BUCKET_ORDER) {
      if (selected.length >= limit) break;
      const bucket = buckets.get(lean);
      if (!bucket || bucket.length === 0) continue;

      let pickIndex = bucket.findIndex(
        (article) =>
          !article.source || !seenSourceIds.has(article.source._id),
      );
      if (pickIndex === -1) pickIndex = 0;
      const article = bucket.splice(pickIndex, 1)[0]!;

      selected.push(article);
      if (article.source) seenSourceIds.add(article.source._id);
      pickedAny = true;
    }
    if (!pickedAny) break;
  }

  return selected.sort(byRecency);
}
