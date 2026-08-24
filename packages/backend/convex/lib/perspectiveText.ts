/**
 * Perspective-side text helpers.
 *
 * A reformist/suveranist tab only exists in the UI when its field is
 * non-empty, so any stored string is a promise to the reader that the tab
 * says something. Prompt v8 retired the "Acoperire limitată…" placeholder for
 * exactly that reason: it filled a side field with a statement about how much
 * coverage exists instead of what that side actually reported, which rendered
 * as a tab with nothing in it (BIV-812).
 *
 * The strings stay exported because they are still stored on events summarized
 * under v7 and earlier: `isPlaceholderPerspective` recognizes them (and the
 * near-miss variants the model produced) so those legacy rows stop rendering a
 * dead tab immediately, without waiting for the whole corpus to be
 * resummarized. `lib/grounding.ts` also uses them to skip grounding checks on
 * our own boilerplate.
 */

/**
 * RETIRED (prompt v8) — was written into a side field whenever that side had
 * 0 or 1 articles. Kept only so stored copies can be detected and dropped.
 */
export const LIMITED_COVERAGE_FALLBACK: Record<
  "reformist" | "suveranist",
  string
> = {
  // BIV-805: user-visible fallback (stored as the perspective summary) — uses
  // "orientare", not the "cadrare" calque; the LLM-internal prompt vocabulary
  // is unchanged on purpose (model-facing, covered by the eval harness).
  reformist: "Acoperire limitată din partea surselor cu orientare reformistă.",
  suveranist: "Acoperire limitată din partea surselor cu orientare suveranistă.",
};

/**
 * RETIRED (prompt v7) — was stored when the model omitted a perspective
 * field. Same treatment as above: detected, never written.
 */
export const SIDE_COVERAGE_FALLBACK =
  "Acoperirea disponibilă nu oferă încă o perspectivă distinctă din această parte.";

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

const EXACT_PLACEHOLDERS = new Set(
  [
    LIMITED_COVERAGE_FALLBACK.reformist,
    LIMITED_COVERAGE_FALLBACK.suveranist,
    SIDE_COVERAGE_FALLBACK,
  ].map(normalizeForMatch),
);

/**
 * Openings of a text that describes the *volume* of a side's coverage rather
 * than its content. Matched against the normalized (diacritic-free) form.
 */
const PLACEHOLDER_PATTERNS: RegExp[] = [
  /^acoperire[a]? (?:este |a fost |ramane )?(?:limitat|redus|slab|minim|insuficient)/,
  /^acoperirea disponibila nu (?:ofera|prezinta|contine)/,
  /^(?:nu exista|lipseste|lipsesc|nu (?:au fost|a fost)) (?:o )?(?:acoperire|surse|articole|perspectiv)/,
  /^(?:nicio|niciun) (?:sursa|articol)/,
  /^(?:fara|nu s-au identificat) (?:o )?(?:acoperire|surse|articole|perspectiv)/,
];

/**
 * True when a side summary is boilerplate about missing coverage rather than
 * a perspective. Only short one-liners qualify: a genuine 50-100 word
 * perspective that happens to open by noting thin coverage still has content
 * after that clause, so the word cap keeps it.
 */
export function isPlaceholderPerspective(
  value: string | null | undefined,
): boolean {
  if (!value) return false;
  const normalized = normalizeForMatch(value);
  if (!normalized) return false;
  if (EXACT_PLACEHOLDERS.has(normalized)) return true;
  const wordCount = normalized.split(" ").length;
  if (wordCount > 25) return false;
  return PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(normalized));
}

/** Placeholder side text collapses to empty, which is how the UI hides a tab. */
export function stripPlaceholderPerspective(value: string): string {
  return isPlaceholderPerspective(value) ? "" : value;
}
