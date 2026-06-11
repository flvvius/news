import type { Locale } from "./strings";

function isFiniteTimestamp(timestamp: number): boolean {
  return Number.isFinite(timestamp);
}

function getIntlLocale(locale?: Locale): string | undefined {
  if (locale === "ro") return "ro-RO";
  if (locale === "en") return "en-US";
  return undefined;
}

export function formatRelativeTimestamp(
  timestamp: number,
  locale?: Locale,
): string {
  if (!isFiniteTimestamp(timestamp)) {
    return locale === "ro" ? "recent" : "recently";
  }

  const relativeTimeFormatter = new Intl.RelativeTimeFormat(
    getIntlLocale(locale),
    {
      numeric: "auto",
    },
  );
  const now = Date.now();
  const diffMs = timestamp - now;
  const diffMinutes = Math.round(diffMs / (60 * 1000));

  if (Math.abs(diffMinutes) < 60) {
    return relativeTimeFormatter.format(diffMinutes, "minute");
  }

  const diffHours = Math.round(diffMs / (60 * 60 * 1000));
  if (Math.abs(diffHours) < 24) {
    return relativeTimeFormatter.format(diffHours, "hour");
  }

  const diffDays = Math.round(diffMs / (24 * 60 * 60 * 1000));
  if (Math.abs(diffDays) < 7) {
    return relativeTimeFormatter.format(diffDays, "day");
  }

  const diffWeeks = Math.round(diffMs / (7 * 24 * 60 * 60 * 1000));
  if (Math.abs(diffWeeks) < 5) {
    return relativeTimeFormatter.format(diffWeeks, "week");
  }

  const diffMonths = Math.round(diffMs / (30 * 24 * 60 * 60 * 1000));
  if (Math.abs(diffMonths) < 12) {
    return relativeTimeFormatter.format(diffMonths, "month");
  }

  const diffYears = Math.round(diffMs / (365 * 24 * 60 * 60 * 1000));
  return relativeTimeFormatter.format(diffYears, "year");
}

export function formatAbsoluteTimestamp(
  timestamp: number,
  locale?: Locale,
): string {
  if (!isFiniteTimestamp(timestamp)) {
    return locale === "ro" ? "Oră necunoscută" : "Unknown time";
  }

  return new Intl.DateTimeFormat(getIntlLocale(locale), {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(timestamp));
}

export function formatDate(timestamp: number, locale?: Locale): string {
  if (!isFiniteTimestamp(timestamp)) {
    return locale === "ro" ? "Dată necunoscută" : "Unknown date";
  }

  return new Intl.DateTimeFormat(getIntlLocale(locale), {
    dateStyle: "medium",
  }).format(new Date(timestamp));
}
