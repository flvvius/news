/**
 * L2 — Romanian Art. 94¹ "very short extract" ceiling. No displayed or
 * stored third-party text (RSS snippets, extracted meta descriptions) may
 * exceed this many characters. Single source of truth for every write path;
 * the web app mirrors the value in apps/web/src/lib/snippet.ts with a
 * cross-check in the compliance test suite (L15).
 */
export const MAX_SNIPPET_CHARS = 120;

const ELLIPSIS = "…";

/**
 * Truncate third-party text to MAX_SNIPPET_CHARS at a sentence boundary when
 * one lands late enough, otherwise at a word boundary. Always returns a
 * string of length ≤ MAX_SNIPPET_CHARS (or undefined for empty input).
 */
export function truncateThirdPartySnippet(
  text: string | undefined | null,
): string | undefined {
  const cleaned = (text ?? "").replace(/\s+/g, " ").trim();
  if (!cleaned) return undefined;
  if (cleaned.length <= MAX_SNIPPET_CHARS) return cleaned;

  const budget = MAX_SNIPPET_CHARS - ELLIPSIS.length;
  const slice = cleaned.slice(0, budget);

  // Prefer ending on a full sentence if one closes in the back half.
  const sentenceEnd = Math.max(
    slice.lastIndexOf(". "),
    slice.lastIndexOf("! "),
    slice.lastIndexOf("? "),
  );
  if (sentenceEnd > budget * 0.5) {
    return slice.slice(0, sentenceEnd + 1);
  }

  const wordEnd = slice.lastIndexOf(" ");
  const cut = wordEnd > budget * 0.5 ? slice.slice(0, wordEnd) : slice;
  return `${cut.replace(/[,:;.\s]+$/g, "")}${ELLIPSIS}`;
}
