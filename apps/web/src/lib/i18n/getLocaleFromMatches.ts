import type { Locale } from "./strings";

const SUPPORTED_LOCALES = ["ro", "en"] as const satisfies readonly Locale[];

export function getLocaleFromMatches(
  matches: ReadonlyArray<{ context?: unknown }>,
): Locale {
  const rootContext = matches[0]?.context;
  if (!rootContext || typeof rootContext !== "object") {
    return "en";
  }

  const locale =
    "locale" in rootContext ? (rootContext.locale as string | undefined) : null;

  return SUPPORTED_LOCALES.includes(locale as Locale) ? (locale as Locale) : "en";
}
