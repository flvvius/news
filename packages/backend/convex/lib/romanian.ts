/**
 * Romanian text normalization (BIV-102).
 *
 * Romanian web content mixes the correct comma-below diacritics (ș/ț) with
 * legacy cedilla forms (ş/ţ) left over from pre-Unicode-3.0 encodings, and
 * sometimes decomposed combining sequences. Inconsistent forms degrade
 * embeddings, clustering, and LLM output, so every piece of article text is
 * funneled through this before storage.
 *
 * Deliberately NOT attempted here: restoring missing diacritics (e.g.
 * "si" → "și"). We only normalize what is present.
 */

// Legacy cedilla → comma-below mappings. NFC is applied first so decomposed
// sequences (s + U+0327 COMBINING CEDILLA) compose into the legacy codepoints
// below before being mapped.
const CEDILLA_TO_COMMA_BELOW: Record<string, string> = {
  "ş": "ș", // ş → ș
  "Ş": "Ș", // Ş → Ș
  "ţ": "ț", // ţ → ț
  "Ţ": "Ț", // Ţ → Ț
};

const CEDILLA_PATTERN = /[şŞţŢ]/g;

/**
 * Normalize Romanian diacritics: Unicode NFC + legacy cedilla ş/ţ → comma-below
 * ș/ț (both cases). Pure and idempotent; safe on non-Romanian text.
 */
export function normalizeRomanianDiacritics(text: string): string {
  if (!text) return text;
  return text
    .normalize("NFC")
    .replace(CEDILLA_PATTERN, (char) => CEDILLA_TO_COMMA_BELOW[char] ?? char);
}

/**
 * Fold diacritics to plain ASCII letters ("ședință" → "sedinta").
 *
 * For matching contexts only — token overlap, fingerprints, slugs — where
 * Romanian web text written with and without diacritics must compare equal.
 * Never use this on text shown to users or sent to models; use
 * {@link normalizeRomanianDiacritics} there.
 */
export function foldDiacriticsToAscii(text: string): string {
  if (!text) return text;
  return text.normalize("NFD").replace(/\p{M}+/gu, "");
}

/**
 * Format a count with a Romanian noun: singular at 1, plural otherwise, and
 * the partitive "de" required before the noun when the number's last two
 * digits fall outside 1-19 ("19 articole" but "20 de articole").
 */
export function romanianCount(
  count: number,
  singular: string,
  plural: string,
): string {
  if (count === 1) return `1 ${singular}`;
  const lastTwo = Math.abs(count) % 100;
  const needsDe = lastTwo === 0 || lastTwo >= 20;
  return `${count} ${needsDe ? "de " : ""}${plural}`;
}

// Frequent Romanian function words that rarely appear in English text.
const ROMANIAN_MARKER_WORDS = new Set([
  "și",
  "si",
  "să",
  "sa",
  "în",
  "cu",
  "de",
  "la",
  "pe",
  "un",
  "o",
  "că",
  "ca",
  "din",
  "pentru",
  "este",
  "sunt",
  "care",
  "mai",
  "dar",
  "după",
  "dupa",
  "între",
  "intre",
  "către",
  "fost",
  "avea",
  "acest",
  "această",
  "prin",
  "despre",
  "unde",
  "când",
  "cand",
  "fără",
  "fara",
  "nu",
]);

const ENGLISH_MARKER_WORDS = new Set([
  "the",
  "and",
  "of",
  "to",
  "in",
  "that",
  "is",
  "was",
  "for",
  "with",
  "are",
  "has",
  "have",
  "this",
  "from",
  "were",
  "been",
  "would",
  "could",
  "their",
  "about",
]);

/**
 * Heuristic Romanian-language detector for eval gating (BIV-701).
 * True when Romanian function words dominate English ones or Romanian
 * diacritics are present alongside at least one Romanian marker.
 * Deterministic, no network — good enough to catch language reversion
 * (whole fields coming back in English), not a general language ID.
 */
export function looksRomanian(text: string): boolean {
  const words = text
    .toLowerCase()
    .split(/[^\p{L}]+/u)
    .filter(Boolean);
  if (words.length === 0) return false;

  let romanian = 0;
  let english = 0;
  for (const word of words) {
    if (ROMANIAN_MARKER_WORDS.has(word)) romanian++;
    if (ENGLISH_MARKER_WORDS.has(word)) english++;
  }

  // Diacritics alone are not sufficient — an English sentence quoting a
  // Romanian proper name ("Călin Georgescu announced…") must not pass. At
  // least one Romanian function word is required; diacritics only support
  // the diacritic-less-Romanian case indirectly via the marker list.
  if (romanian === 0) return false;
  return english <= romanian;
}
