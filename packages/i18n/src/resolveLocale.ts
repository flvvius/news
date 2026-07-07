import type { Locale } from "./strings";

// Romanian-first product: everyone lands in Romanian on first open. English is
// opt-in only, via an explicit choice (URL ?lang, the bv_locale cookie, or a
// saved account preference). We deliberately do NOT auto-detect from
// accept-language or geo-IP — those would drop English-browser visitors into
// English before they ever made a choice.
const DEFAULT_LOCALE: Locale = "ro";

export interface LocaleResolutionInput {
  searchParam?: string | null;
  cookieValue?: string | null;
  userPreference?: string | null;
}

export function resolveLocale(input: LocaleResolutionInput): Locale {
  if (isSupported(input.searchParam)) return input.searchParam;
  if (isSupported(input.cookieValue)) return input.cookieValue;
  if (isSupported(input.userPreference)) return input.userPreference;
  return DEFAULT_LOCALE;
}

function isSupported(value: string | null | undefined): value is Locale {
  return value === "ro" || value === "en";
}
