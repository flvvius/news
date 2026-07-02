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
