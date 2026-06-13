import { computeStreakUpdate } from "@news-app/backend/convex/lib/streaks";
import {
  deleteAsync,
  documentDirectory,
  getInfoAsync,
  readAsStringAsync,
  writeAsStringAsync,
} from "expo-file-system/legacy";

/**
 * Local guest interaction queue: event reads accrued while signed out, stored
 * as a JSON file (not SecureStore — that caps values at ~2KB, too small for a
 * growing log). At signup the merge mutation replays these into Convex; on
 * logout they're cleared. The only thing guests send to the server is funnel
 * analytics — reads stay local until merge.
 *
 * Topic follows live in their own store ([[followed-topics]]); this queue is
 * the append-only read log, which also yields the guest reading streak.
 */
export type GuestRead = {
  eventId: string;
  slug?: string;
  timestamp: number;
  timeSpentSeconds?: number;
  scrollDepthPercentage?: number;
  /** Bias snapshot at read time, so merge can replay the interaction context. */
  biasRating?: number;
  sourceReliability?: number;
};

/**
 * A read counts toward the streak (and the notification primer trigger) once
 * it shows real engagement, not a bounce. Decision 6 / decision 10.
 */
export const QUALIFIED_READ_MIN_SECONDS = 30;
export const QUALIFIED_READ_MIN_SCROLL = 0.6;

export function isQualifiedRead(read: GuestRead): boolean {
  return (
    (read.timeSpentSeconds ?? 0) >= QUALIFIED_READ_MIN_SECONDS ||
    (read.scrollDepthPercentage ?? 0) >= QUALIFIED_READ_MIN_SCROLL
  );
}

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_QUEUED_READS = 1000;
const QUEUE_FILE_URI = documentDirectory
  ? `${documentDirectory}guest-activity.json`
  : null;

function isGuestRead(value: unknown): value is GuestRead {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as GuestRead).eventId === "string" &&
    typeof (value as GuestRead).timestamp === "number"
  );
}

async function readQueueFile(): Promise<GuestRead[]> {
  if (!QUEUE_FILE_URI) return [];
  try {
    const info = await getInfoAsync(QUEUE_FILE_URI);
    if (!info.exists) return [];
    const raw = await readAsStringAsync(QUEUE_FILE_URI);
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isGuestRead);
  } catch {
    // Missing/corrupt file — treat as an empty queue.
    return [];
  }
}

async function writeQueueFile(reads: GuestRead[]): Promise<void> {
  if (!QUEUE_FILE_URI) return;
  try {
    await writeAsStringAsync(QUEUE_FILE_URI, JSON.stringify(reads));
  } catch {
    // Persistence is best-effort; reads must never break opening a story.
  }
}

// Serialize file mutations so two quick reads can't clobber each other's
// load→append→write cycle.
let writeChain: Promise<unknown> = Promise.resolve();
function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const run = writeChain.then(task, task);
  writeChain = run.catch(() => undefined);
  return run;
}

export function loadGuestReads(): Promise<GuestRead[]> {
  return enqueue(readQueueFile);
}

export function appendGuestRead(read: GuestRead): Promise<GuestRead[]> {
  return enqueue(async () => {
    const reads = await readQueueFile();
    reads.push(read);
    // Bound the file; keep the most recent reads.
    const trimmed =
      reads.length > MAX_QUEUED_READS
        ? reads.slice(reads.length - MAX_QUEUED_READS)
        : reads;
    await writeQueueFile(trimmed);
    return trimmed;
  });
}

export function clearGuestReads(): Promise<void> {
  return enqueue(async () => {
    if (!QUEUE_FILE_URI) return;
    try {
      const info = await getInfoAsync(QUEUE_FILE_URI);
      if (info.exists) {
        await deleteAsync(QUEUE_FILE_URI, { idempotent: true });
      }
    } catch {
      // Best-effort.
    }
  });
}

function startOfUtcDay(timestamp: number): number {
  return Math.floor(timestamp / DAY_MS) * DAY_MS;
}

export type GuestStreak = { currentStreak: number; longestStreak: number };

/**
 * Guest reading streak, from qualified reads only (decision 10), replayed
 * through the same pure `computeStreakUpdate` the server uses so a guest's
 * streak and the account streak agree. `now` decides whether the run is still
 * live: a streak only counts as current if the last qualified day is today or
 * yesterday (otherwise the teaser would over-claim a broken streak).
 */
export function computeGuestStreak(
  reads: GuestRead[],
  now: number,
): GuestStreak {
  const qualifiedDays = Array.from(
    new Set(
      reads
        .filter(isQualifiedRead)
        .map((read) => startOfUtcDay(read.timestamp)),
    ),
  ).sort((a, b) => a - b);

  let state: {
    currentStreak: number;
    longestStreak: number;
    lastActiveAt?: number;
  } = { currentStreak: 0, longestStreak: 0, lastActiveAt: undefined };

  for (const day of qualifiedDays) {
    const next = computeStreakUpdate(state, day);
    state = {
      currentStreak: next.currentStreak,
      longestStreak: next.longestStreak,
      lastActiveAt: next.lastActiveAt,
    };
  }

  const lastDay = qualifiedDays.at(-1);
  const isAlive =
    lastDay !== undefined && startOfUtcDay(now) - lastDay <= DAY_MS;

  return {
    currentStreak: isAlive ? state.currentStreak : 0,
    longestStreak: state.longestStreak,
  };
}
