import { cn } from "@/lib/utils";

/**
 * The biviant lockup (mark + wordmark). The wordmark is a dark slate baked
 * into the PNG, so it needs a lightened variant on dark surfaces; the mark's
 * light-blue tones read on both. We ship both and swap with the `dark` class
 * on <html> — no JS, no hydration flip. Decorative by default: the enclosing
 * link/title carries the accessible name.
 *
 * Size it with a height utility (e.g. `h-7`); width stays auto to preserve
 * the ~4.24:1 aspect ratio.
 */
export function BrandLogo({ className }: { className?: string }) {
  return (
    <>
      <img
        src="/logo-biviant.png"
        alt=""
        aria-hidden="true"
        className={cn("w-auto dark:hidden", className)}
      />
      <img
        src="/logo-biviant-dark.png"
        alt=""
        aria-hidden="true"
        className={cn("hidden w-auto dark:block", className)}
      />
    </>
  );
}
