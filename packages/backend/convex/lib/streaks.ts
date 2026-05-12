const DAY_MS = 24 * 60 * 60 * 1000;

type StreakStats = {
  currentStreak: number;
  longestStreak: number;
  lastActiveAt?: number;
};

function startOfUtcDay(timestamp: number): number {
  return Math.floor(timestamp / DAY_MS) * DAY_MS;
}

export function computeStreakUpdate(stats: StreakStats, timestamp: number) {
  const previousActiveAt = stats.lastActiveAt;
  const previousDay =
    previousActiveAt === undefined
      ? undefined
      : startOfUtcDay(previousActiveAt);
  const currentDay = startOfUtcDay(timestamp);

  let currentStreak = stats.currentStreak;
  if (previousDay === undefined) {
    currentStreak = 1;
  } else if (currentDay === previousDay) {
    currentStreak = stats.currentStreak;
  } else if (currentDay === previousDay + DAY_MS) {
    currentStreak = stats.currentStreak + 1;
  } else if (currentDay > previousDay) {
    currentStreak = 1;
  }

  return {
    currentStreak,
    longestStreak: Math.max(stats.longestStreak, currentStreak),
    lastActiveAt:
      previousActiveAt === undefined
        ? timestamp
        : Math.max(previousActiveAt, timestamp),
  };
}
