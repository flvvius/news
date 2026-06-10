const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const WEEK_MS = 7 * DAY_MS;
const MONTH_MS = 30 * DAY_MS;
const YEAR_MS = 365 * DAY_MS;

function isFiniteTimestamp(timestamp: number): boolean {
  return Number.isFinite(timestamp);
}

export function formatRelativeTimestamp(timestamp: number): string {
  if (!isFiniteTimestamp(timestamp)) {
    return "recently";
  }

  const formatter = new Intl.RelativeTimeFormat("en-US", { numeric: "auto" });
  const diffMs = timestamp - Date.now();

  const diffMinutes = Math.round(diffMs / MINUTE_MS);
  if (Math.abs(diffMinutes) < 60) return formatter.format(diffMinutes, "minute");

  const diffHours = Math.round(diffMs / HOUR_MS);
  if (Math.abs(diffHours) < 24) return formatter.format(diffHours, "hour");

  const diffDays = Math.round(diffMs / DAY_MS);
  if (Math.abs(diffDays) < 7) return formatter.format(diffDays, "day");

  const diffWeeks = Math.round(diffMs / WEEK_MS);
  if (Math.abs(diffWeeks) < 5) return formatter.format(diffWeeks, "week");

  const diffMonths = Math.round(diffMs / MONTH_MS);
  if (Math.abs(diffMonths) < 12) return formatter.format(diffMonths, "month");

  return formatter.format(Math.round(diffMs / YEAR_MS), "year");
}

export function formatAbsoluteTimestamp(timestamp: number): string {
  if (!isFiniteTimestamp(timestamp)) {
    return "Unknown time";
  }

  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(timestamp));
}

export function formatDate(timestamp: number): string {
  if (!isFiniteTimestamp(timestamp)) {
    return "Unknown date";
  }

  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(
    new Date(timestamp),
  );
}
