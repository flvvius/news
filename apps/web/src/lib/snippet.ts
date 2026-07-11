/**
 * L2 — render-time mirror of the backend snippet ceiling
 * (packages/backend/convex/lib/compliance.ts). Second line of defense: even
 * if a stored row predates the write-time enforcement, no render path may
 * output third-party text longer than MAX_SNIPPET_CHARS.
 */
export const MAX_SNIPPET_CHARS = 120;

const ELLIPSIS = "…";

export function truncateSnippetForDisplay(
  text: string | undefined | null,
): string | undefined {
  const cleaned = (text ?? "").replace(/\s+/g, " ").trim();
  if (!cleaned) return undefined;
  if (cleaned.length <= MAX_SNIPPET_CHARS) return cleaned;

  const budget = MAX_SNIPPET_CHARS - ELLIPSIS.length;
  const slice = cleaned.slice(0, budget);
  const wordEnd = slice.lastIndexOf(" ");
  const cut = wordEnd > budget * 0.5 ? slice.slice(0, wordEnd) : slice;
  return `${cut.replace(/[,:;.\s]+$/g, "")}${ELLIPSIS}`;
}
