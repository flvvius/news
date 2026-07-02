import { computeStreakUpdate } from "@news-app/backend/convex/lib/streaks";
import type { Id } from "@news-app/backend/convex/_generated/dataModel";
import {
  deleteAsync,
  documentDirectory,
  getInfoAsync,
  moveAsync,
  readAsStringAsync,
  writeAsStringAsync,
} from "expo-file-system/legacy";

import { reportError } from "./error-monitoring";

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
  eventId: Id<"events">;
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
// Sidecars: the temp file is the staging target for an atomic write; the
// quarantine file holds a corrupt primary for diagnostics instead of silently
// dropping it. Both must be cleared on logout (see clearGuestReads) so stale
// data can never resurrect into the next guest session.
const QUEUE_TEMP_URI = QUEUE_FILE_URI ? `${QUEUE_FILE_URI}.tmp` : null;
const QUEUE_CORRUPT_URI = QUEUE_FILE_URI ? `${QUEUE_FILE_URI}.corrupt` : null;

function isGuestRead(value: unknown): value is GuestRead {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as GuestRead).eventId === "string" &&
    typeof (value as GuestRead).timestamp === "number"
  );
}

/**
 * Parse queue file contents. Returns the (filtered) reads on success, or `null`
 * when the content is corrupt (unparseable JSON or not an array) — the caller
 * distinguishes "corrupt" from "valid but empty" to drive recovery. A valid
 * array with some junk entries is *not* corrupt; the bad entries are dropped.
 */
function parseQueue(raw: string): GuestRead[] | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    return parsed.filter(isGuestRead);
  } catch {
    return null;
  }
}

async function readFileIfExists(uri: string): Promise<string | null> {
  const info = await getInfoAsync(uri);
  if (!info.exists) return null;
  return await readAsStringAsync(uri);
}

async function deleteIfExists(uri: string | null): Promise<void> {
  if (!uri) return;
  try {
    const info = await getInfoAsync(uri);
    if (info.exists) await deleteAsync(uri, { idempotent: true });
  } catch {
    // Best-effort.
  }
}

/**
 * Hook for error monitoring (T17). Corruption is always recovered and never
 * surfaced to the user, but we want a breadcrumb when it happens.
 */
function reportQueueCorruption(): void {
  console.warn("[guest-activity-queue] recovered from a corrupt queue file");
  // Ticket 17: surface to error monitoring (no-ops until Sentry is configured).
  reportError(new Error("guest-activity queue file was corrupt"), {
    scope: "guest-activity-queue",
  });
}

/**
 * A crash between deleting the primary and renaming the temp into place leaves
 * the new-valid content only in the temp file. On load, if the primary is
 * missing or corrupt, recover from the temp and promote it back to primary.
 */
async function tryRecoverFromTemp(): Promise<GuestRead[] | null> {
  if (!QUEUE_TEMP_URI) return null;
  try {
    const raw = await readFileIfExists(QUEUE_TEMP_URI);
    if (raw === null) return null;
    const reads = parseQueue(raw);
    if (reads === null) return null;
    // Promote so subsequent loads read a clean primary.
    await writeQueueFile(reads);
    return reads;
  } catch {
    return null;
  }
}

/** Move a confirmed-corrupt primary aside for diagnostics, then move on. */
async function quarantineCorruptPrimary(): Promise<void> {
  if (!QUEUE_FILE_URI || !QUEUE_CORRUPT_URI) return;
  try {
    await deleteIfExists(QUEUE_CORRUPT_URI);
    await moveAsync({ from: QUEUE_FILE_URI, to: QUEUE_CORRUPT_URI });
  } catch {
    // If quarantine fails, drop the corrupt primary so it can't wedge loads.
    await deleteIfExists(QUEUE_FILE_URI);
  }
  reportQueueCorruption();
}

async function readQueueFile(): Promise<GuestRead[]> {
  if (!QUEUE_FILE_URI) return [];

  let primaryRaw: string | null;
  try {
    primaryRaw = await readFileIfExists(QUEUE_FILE_URI);
  } catch {
    // Transient read failure — do NOT touch the primary (it may be fine next
    // launch). Recover from temp if one exists, otherwise act as empty. Never
    // throw to the caller, and never destroy data on a transient error.
    return (await tryRecoverFromTemp()) ?? [];
  }

  if (primaryRaw !== null) {
    const reads = parseQueue(primaryRaw);
    if (reads !== null) return reads;
    // Primary is genuinely corrupt: prefer an interrupted-write temp (recovery
    // promotes it back over the corrupt primary), else quarantine and start
    // fresh.
    const recovered = await tryRecoverFromTemp();
    if (recovered !== null) return recovered;
    await quarantineCorruptPrimary();
    return [];
  }

  // Primary missing — an interrupted write may have left a valid temp.
  return (await tryRecoverFromTemp()) ?? [];
}

async function writeQueueFile(reads: GuestRead[]): Promise<void> {
  if (!QUEUE_FILE_URI || !QUEUE_TEMP_URI) return;
  try {
    // 1. Write the full new content to a temp file — never the live primary, so
    //    a crash mid-write can't corrupt the file the merge depends on.
    await writeAsStringAsync(QUEUE_TEMP_URI, JSON.stringify(reads));
    // 2. Swap it into place. moveAsync within documentDirectory is a rename
    //    (atomic on-device); it fails if the destination exists, so clear it
    //    first. The delete→move window is covered by readQueueFile's temp
    //    recovery, since the temp still holds the new-valid content.
    await deleteIfExists(QUEUE_FILE_URI);
    await moveAsync({ from: QUEUE_TEMP_URI, to: QUEUE_FILE_URI });
  } catch {
    // Persistence is best-effort; reads must never break opening a story. The
    // primary keeps its previous valid content (or the temp does, recoverable
    // on next load).
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
    // Clear the primary AND both sidecars; a lingering temp/quarantine file
    // could otherwise resurrect a prior guest's reads into the next session.
    await deleteIfExists(QUEUE_FILE_URI);
    await deleteIfExists(QUEUE_TEMP_URI);
    await deleteIfExists(QUEUE_CORRUPT_URI);
  });
}

/**
 * Clear the guest queue only when its merge into an account is confirmed.
 *
 * Ticket 3: logout must never delete an *unmerged* queue, or the guest's
 * reading history is silently lost. `deviceMerged` comes from the server
 * `guestMerges` ledger (see `hasDeviceMerged`); pass `false` on any uncertainty
 * (e.g. the check failed / offline) so the queue is retained and the next login
 * retries the merge. Returns whether the queue was actually cleared.
 */
export async function clearGuestReadsIfMerged(
  deviceMerged: boolean,
): Promise<boolean> {
  if (!deviceMerged) return false;
  await clearGuestReads();
  return true;
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
