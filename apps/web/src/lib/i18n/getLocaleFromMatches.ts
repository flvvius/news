import type { Locale } from "./strings";

const SUPPORTED_LOCALES = ["ro", "en"] as const satisfies readonly Locale[];

export function getLocaleFromMatches(
  matches: ReadonlyArray<{ context?: unknown }>,
): Locale {
  // Romanian-first product (see resolveLocale): when the root context has not
  // resolved a locale — e.g. a first-hit crawler with no cookie/?lang — meta
  // must default to Romanian to match <html lang="ro"> and the content, not
  // leak English titles/descriptions on indexable pages (SEO-2).
  const rootContext = matches[0]?.context;
  if (!rootContext || typeof rootContext !== "object") {
    return "ro";
  }

  const locale =
    "locale" in rootContext ? (rootContext.locale as string | undefined) : null;

  return SUPPORTED_LOCALES.includes(locale as Locale) ? (locale as Locale) : "ro";
}
