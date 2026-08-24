/**
 * Summary presentation helpers — shared by the backend (grounding, prompts)
 * and by both clients (web, native).
 *
 * Everything here is pure string logic with no Convex or prompt imports, so
 * the apps can import it directly through the package exports map without
 * pulling the model-facing prompt text into a browser bundle.
 *
 * The readability work (BIV-820) is deliberately split in two:
 *  - the prompt (v9) makes the model write short, one-fact sentences;
 *  - `toSummaryPoints` turns those sentences into the bullet list the UI
 *    renders, so nothing about the stored string changes. The stored value
 *    stays plain prose — that is what SEO descriptions, share images, quiz
 *    inputs and the grounding record all consume.
 */

/**
 * Written into `globalImpact` when the coverage carries no stated stake.
 * It is stored (never empty) because `shouldResummarize` treats a blank
 * globalImpact as an incomplete run and would re-enqueue the event forever.
 * The clients hide it at render time instead — see `isFallbackGlobalImpact`.
 */
export const GLOBAL_IMPACT_FALLBACK =
  "Impactul concret nu este precizat în articolele furnizate.";

const ABBREVIATIONS =
  /\b(dl|dna|dr|prof|ing|nr|art|lit|alin|pct|etc|ex|approx|cca|str|jud|mun)\.$/i;

/** Split Romanian prose into sentences, robust to common abbreviations. */
export function splitIntoSentences(text: string): string[] {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (!cleaned) return [];

  const sentences: string[] = [];
  let current = "";
  for (let i = 0; i < cleaned.length; i++) {
    current += cleaned[i];
    const char = cleaned[i];
    if (char === "." || char === "!" || char === "?") {
      const next = cleaned[i + 1];
      const isEnd =
        (next === undefined || next === " ") &&
        !ABBREVIATIONS.test(current.trim()) &&
        // Enumeration markers ("1. ..."). Decimals need no guard here: the
        // digit after the point already fails the "next is a space" test.
        // Guarding on any trailing digit (the original rule) silently glued
        // together every sentence ending in a year or a numeric outlet name
        // — "…până în 2028." and "…arată Digi24." both stopped splitting.
        !/^\d{1,2}\.$/.test(current.trim());
      if (isEnd) {
        const trimmed = current.trim();
        if (trimmed) sentences.push(trimmed);
        current = "";
      }
    }
  }
  const rest = current.trim();
  if (rest) sentences.push(rest);
  return sentences;
}

/** Lowercase, diacritic- and quote-insensitive form for matching. */
function normalizeForMatch(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[„”"'`]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/**
 * Openings of a globalImpact that says "no impact was stated" rather than
 * stating one. Matched against the normalized (diacritic-free) form; the
 * model also writes trailing qualifications onto the canonical fallback
 * ("...furnizate în ceea ce privește eventuale restricții"), so this matches
 * by prefix rather than by equality.
 */
const FALLBACK_PATTERNS: RegExp[] = [
  /^impactul (?:concret |global |direct )?nu (?:este|a fost|apare) (?:precizat|mentionat|specificat|detaliat)/,
  /^(?:un )?impact(?:ul)? (?:concret )?(?:nu (?:reiese|rezulta|poate fi))/,
  /^articolele furnizate nu (?:precizeaza|mentioneaza|indica|contin)/,
  /^nu (?:este|a fost) (?:precizat|mentionat|specificat) (?:un )?impact/,
  /^sursele (?:furnizate )?nu (?:precizeaza|mentioneaza|indica) (?:un )?impact/,
];

/**
 * True when a stored globalImpact is our own "nothing to report" text rather
 * than an actual consequence. 35% of the impact sections rendered in
 * production were this string under a "Ce înseamnă asta" heading — a section
 * whose whole content is a non-answer. The clients drop the section instead.
 *
 * Only short one-liners qualify: a genuine impact that happens to open with a
 * caveat still has content after it, and the word cap keeps that.
 */
export function isFallbackGlobalImpact(
  value: string | null | undefined,
): boolean {
  if (!value) return false;
  const normalized = normalizeForMatch(value);
  if (!normalized) return false;
  if (normalized.split(" ").length > 35) return false;
  return FALLBACK_PATTERNS.some((pattern) => pattern.test(normalized));
}

/** The fallback collapses to empty, which is how a client hides the section. */
export function stripFallbackGlobalImpact(
  value: string | null | undefined,
): string {
  if (!value) return "";
  return isFallbackGlobalImpact(value) ? "" : value;
}

export type SummaryPoints = {
  /**
   * The opening sentence — what happened, in one line. Empty only when the
   * text itself is empty.
   */
  lead: string;
  /** The remaining sentences, one scannable fact each. */
  points: string[];
};

/**
 * Minimum sentences before a text is worth breaking into bullets.
 *
 * With a lead line, two sentences read better as a sentence pair than as a
 * lead plus a lone bullet. With no lead (`leadCount: 0`, the impact section)
 * two sentences are two consequences, and listing them is the whole point —
 * prompt v9 asks for exactly 2-3 there.
 */
const MIN_SENTENCES_FOR_POINTS = 3;
const MIN_SENTENCES_FOR_POINTS_NO_LEAD = 2;

/**
 * Split a summary into a lead line plus bullet points.
 *
 * `leadCount` controls how many opening sentences stay in the lead paragraph
 * (the core summary keeps one; the impact section uses 0 so every line is a
 * bullet). When the text is too short to be worth a list, everything stays in
 * the lead and `points` is empty — the caller then renders a plain paragraph.
 */
export function toSummaryPoints(
  text: string | null | undefined,
  options: { leadCount?: number } = {},
): SummaryPoints {
  const leadCount = options.leadCount ?? 1;
  const trimmed = (text ?? "").trim();
  if (!trimmed) return { lead: "", points: [] };

  const sentences = splitIntoSentences(trimmed);
  const minSentences =
    leadCount === 0
      ? MIN_SENTENCES_FOR_POINTS_NO_LEAD
      : MIN_SENTENCES_FOR_POINTS;
  if (sentences.length < minSentences) {
    return { lead: trimmed, points: [] };
  }

  return {
    lead: sentences.slice(0, leadCount).join(" "),
    points: sentences.slice(leadCount),
  };
}

/** First sentence of a summary — the takeaway used for feed previews. */
export function leadSentence(text: string | null | undefined): string {
  const trimmed = (text ?? "").trim();
  if (!trimmed) return "";
  return splitIntoSentences(trimmed)[0] ?? trimmed;
}
