import { cn } from "@/lib/utils";

/**
 * The Miez wordmark (placeholder lockup until the final logo lands).
 *
 * Rendered as inline SVG in `currentColor`, so it adapts to light/dark from
 * the surrounding text colour with no image swap and no hydration flip — size
 * it with a height utility (e.g. `h-7`); width stays auto to preserve the
 * aspect ratio. Decorative by default: the enclosing link/title carries the
 * accessible name.
 *
 * The "e" is drawn as the sliced-disc core motif — a ring with a filled centre
 * dot (the *miez*, the core). The same mark, standalone, is the favicon
 * (public/favicon.svg) and the onboarding disc (MIEZ-8).
 */
export function BrandLogo({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 96 32"
      role="img"
      aria-hidden="true"
      className={cn("w-auto", className)}
      fill="currentColor"
    >
      {/* wordmark: "mi" · core-e · "z" — Inter, tight, lowercase */}
      <text
        x="0"
        y="24"
        fontFamily="Inter, ui-sans-serif, system-ui, sans-serif"
        fontSize="27"
        fontWeight="680"
        letterSpacing="-0.5"
      >
        mi
      </text>
      {/* the "e" as the core motif: ring + filled centre dot */}
      <g transform="translate(52 16)">
        <circle r="9.5" fill="none" stroke="currentColor" strokeWidth="3.4" />
        <circle r="3.4" fill="currentColor" />
      </g>
      <text
        x="66"
        y="24"
        fontFamily="Inter, ui-sans-serif, system-ui, sans-serif"
        fontSize="27"
        fontWeight="680"
        letterSpacing="-0.5"
      >
        z
      </text>
    </svg>
  );
}
