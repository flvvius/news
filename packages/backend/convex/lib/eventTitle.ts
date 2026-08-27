/**
 * Event title selection — shared by clustering, summarization and migrations.
 *
 * An event's title is the title of the article that *created* it. That is fine
 * while a cluster stays on one story, and wrong the moment it does not: a
 * cluster seeded by one article and then joined by a dozen about a different
 * story keeps the seed's title, while the summary — regenerated from every
 * article — describes the majority story. Production showed an 18-article
 * event titled "Adjuncta șefului cabinetului lui Zelenski a fost arestată"
 * whose other 17 articles, and therefore its summary, were about the CIA
 * director's visit to Moscow.
 *
 * The fix is to pick the title that best represents the cluster instead of the
 * one that happened to arrive first: the medoid of the article titles under
 * token overlap. In the example above the seventeen Moscow titles share
 * "moscova"/"cia"/"ratcliffe" and score high against each other; the lone
 * arrest headline shares almost nothing and loses.
 *
 * Pure string logic on purpose — no embeddings, no model call, and cheap
 * enough to run wherever the article set is already loaded.
 */

/** Romanian + generic stopwords, plus the connective scaffolding headlines are built from. */
const TITLE_STOPWORDS = new Set([
  "acest", "acesta", "aceasta", "aceste", "acestea", "acestia", "acestui",
  "acolo", "acum", "aici", "alte", "altele", "are", "asupra", "atat",
  "care", "catre", "ceea", "cele", "celor", "chiar", "cine", "cand", "cum",
  "cumva", "despre", "dintr", "dintre", "doar", "doua", "dupa", "este",
  "fac", "face", "fara", "fost", "insa", "intre", "mai", "mult", "multe",
  "nici", "pana", "pentru", "peste", "poate", "prin", "printre", "sale",
  "sau", "spre", "sub", "sunt", "toate", "tot", "trei", "unde", "unei",
  "unui", "vor",
]);

/** Lowercase, strip diacritics, keep words of 4+ chars that are not stopwords. */
export function titleTokens(title: string): Set<string> {
  const folded = title
    .normalize("NFD")
    .replace(/\p{Mn}/gu, "")
    .toLowerCase();
  const words = folded.match(/[a-z0-9]+/g) ?? [];
  return new Set(
    words.filter((word) => word.length > 3 && !TITLE_STOPWORDS.has(word)),
  );
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const token of a) if (b.has(token)) shared += 1;
  const union = a.size + b.size - shared;
  return union === 0 ? 0 : shared / union;
}

/**
 * Mean overlap of each title against every other title in the cluster. A title
 * describing the majority story scores high; an outlier scores near zero.
 * Single-title clusters score 0 for everyone — there is nothing to compare.
 */
export function titleCentralityScores(titles: string[]): number[] {
  const tokenSets = titles.map(titleTokens);
  return tokenSets.map((tokens, index) => {
    if (tokenSets.length < 2) return 0;
    let total = 0;
    for (let other = 0; other < tokenSets.length; other++) {
      if (other === index) continue;
      total += jaccard(tokens, tokenSets[other]!);
    }
    return total / (tokenSets.length - 1);
  });
}

/**
 * A title is treated as the cluster's outlier only when its overlap with the
 * rest is essentially nil. Calibrated against 26 production clusters: the two
 * genuinely divergent events both scored **0.014**, while same-story titles
 * that merely lost to a slightly more central phrasing scored 0.078-0.163.
 *
 * The discriminator is the incumbent's absolute centrality, not its gap to the
 * winner. An earlier margin-based rule renamed 26% of events — mostly swapping
 * "Două explozii la Damasc, lângă hotelul unde a fost cazat Macron" for
 * "Explozii la Damasc, lângă hotelul în care este cazat Macron", which is
 * churn on a published headline, not a repair.
 */
const OUTLIER_CEILING = 0.05;

/** The replacement must itself represent the cluster, not be another outlier. */
const MIN_REPLACEMENT_SCORE = 0.05;

/** And it must dominate clearly, not edge ahead of a near-tie. */
const DOMINANCE_RATIO = 3;

/**
 * Choose the title an event should carry, given its current title and every
 * article title in the cluster.
 *
 * Returns `null` when the current title should stand — the common case. Only
 * returns a string when the incumbent is a genuine outlier against its own
 * cluster and a clearly representative replacement exists.
 */
export function chooseEventTitle(
  currentTitle: string,
  articleTitles: string[],
): string | null {
  const candidates = articleTitles
    .map((title) => title.trim())
    .filter((title) => title.length > 0);
  if (candidates.length < 3) return null;

  const scores = titleCentralityScores(candidates);

  let bestIndex = 0;
  for (let i = 1; i < candidates.length; i++) {
    if (scores[i]! > scores[bestIndex]!) bestIndex = i;
  }
  const best = candidates[bestIndex]!;
  const bestScore = scores[bestIndex]!;
  if (best === currentTitle) return null;

  // Score the incumbent inside the same cluster so the comparison is like for
  // like. The current title is usually one of the article titles; when it is
  // not (it was edited, or its article was removed) it is scored on its own
  // tokens against the cluster.
  const incumbentIndex = candidates.indexOf(currentTitle);
  const incumbentScore =
    incumbentIndex >= 0
      ? scores[incumbentIndex]!
      : titleCentralityScores([currentTitle, ...candidates])[0]!;

  if (incumbentScore >= OUTLIER_CEILING) return null;
  if (bestScore < MIN_REPLACEMENT_SCORE) return null;
  if (bestScore < incumbentScore * DOMINANCE_RATIO) return null;
  return best;
}
