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

  const weightedCodes = header
    .split(",")
    .map((part) => {
      const [languagePart, ...params] = part.split(";");
      const code = languagePart?.trim().toLowerCase().split("-")[0];
      const qParam = params
        .map((param) => param.trim())
        .find((param) => param.startsWith("q="));
      const weight = Number.parseFloat(qParam?.slice(2) ?? "1");

      return {
        code,
        weight: Number.isFinite(weight) ? weight : 1,
      };
    })
    .filter((entry): entry is { code: string; weight: number } => Boolean(entry.code))
    .sort((a, b) => b.weight - a.weight);

  for (const { code } of weightedCodes) {
    if (SUPPORTED.includes(code as Locale)) {
      return code as Locale;
    }
  }

  return null;
}
