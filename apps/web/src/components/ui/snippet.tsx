import type { ReactNode } from "react";
import { truncateSnippetForDisplay } from "@/lib/snippet";

/**
 * L2 — the only sanctioned way to render third-party article text. Hard
 * truncates to the 120-char "very short extract" ceiling regardless of what
 * is stored, and requires the canonical link to be rendered adjacent (pass
 * it as `canonicalLink`, or render your own immediately next to this).
 */
export function Snippet({
  text,
  className,
  canonicalLink,
}: {
  text: string | undefined | null;
  className?: string;
  canonicalLink?: ReactNode;
}) {
  const truncated = truncateSnippetForDisplay(text);
  if (!truncated) return null;

  return (
    <>
      <p data-third-party-snippet className={className}>
        {truncated}
      </p>
      {canonicalLink}
    </>
  );
}
