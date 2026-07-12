import { cn } from "@/lib/utils";

/**
 * The Miez brand lockup: the sliced-disc core mark + the "miez" wordmark.
 *
 * The mark is `public/logo-mark.png` — the teal/coral disc split around the
 * yellow *miez* (the core), on a transparent background so it reads on both
 * light and dark chrome. The same disc, baked onto its cream ground, is the
 * favicon / apple-touch-icon.
 *
 * Sizing: `className` sizes and spaces the whole lockup (e.g. `h-7`); the mark
 * fills that height and the wordmark scales alongside it. The wordmark can be
 * hidden — pass `wordmarkClassName="hidden md:inline"` to show text only on
 * desktop, or `showWordmark={false}` to render the mark alone. Decorative by
 * default (the whole lockup is `aria-hidden`): the enclosing link/title carries
 * the accessible name.
 */
export function BrandLogo({
  className,
  wordmarkClassName,
  showWordmark = true,
}: {
  className?: string;
  wordmarkClassName?: string;
  showWordmark?: boolean;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex items-center gap-2 text-foreground",
        className,
      )}
    >
      <img src="/logo-mark.png" alt="" className="h-full w-auto" />
      {showWordmark && (
        <span
          className={cn(
            "text-xl font-semibold lowercase leading-none tracking-tight",
            wordmarkClassName,
          )}
        >
          miez
        </span>
      )}
    </span>
  );
}
