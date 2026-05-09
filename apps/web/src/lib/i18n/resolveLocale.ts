import type { Locale } from "./strings";

const SUPPORTED: readonly Locale[] = ["ro", "en"] as const;
const DEFAULT_LOCALE: Locale = "en";

export interface LocaleResolutionInput {
  searchParam?: string | null;
  cookieValue?: string | null;
  userPreference?: string | null;
  countryCode?: string | null;
  acceptLanguage?: string | null;
}

export function resolveLocale(input: LocaleResolutionInput): Locale {
  if (isSupported(input.searchParam)) return input.searchParam;
  if (isSupported(input.cookieValue)) return input.cookieValue;
  if (isSupported(input.userPreference)) return input.userPreference;
  if (input.countryCode?.toUpperCase() === "RO") return "ro";
  const fromAccept = parseAcceptLanguage(input.acceptLanguage);
  if (fromAccept) return fromAccept;
  return DEFAULT_LOCALE;
}

function isSupported(value: string | null | undefined): value is Locale {
  return value === "ro" || value === "en";
}

function parseAcceptLanguage(header: string | null | undefined): Locale | null {
  if (!header) return null;

  const codes = header
    .split(",")
    .map((part) => part.split(";")[0]?.trim().toLowerCase().split("-")[0])
    .filter(Boolean);

  for (const code of codes) {
    if (code && SUPPORTED.includes(code as Locale)) {
      return code as Locale;
    }
  }

  return null;
}
