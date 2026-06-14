import { beforeEach, describe, expect, test, vi } from "vitest";

// In-memory file system shared with the mock below. `control` injects failures
// at the exact points a real crash/transient error would hit.
const fsState = vi.hoisted(() => {
  const files = new Map<string, string>();
  const control = { failNextWrite: false, failNextMove: false };
  return { files, control };
});

vi.mock("expo-file-system/legacy", () => ({
  documentDirectory: "file:///doc/",
  getInfoAsync: async (uri: string) => ({ exists: fsState.files.has(uri), uri }),
  readAsStringAsync: async (uri: string) => {
    const value = fsState.files.get(uri);
    if (value === undefined) throw new Error(`ENOENT: ${uri}`);
    return value;
  },
  writeAsStringAsync: async (uri: string, contents: string) => {
    if (fsState.control.failNextWrite) {
      fsState.control.failNextWrite = false;
      throw new Error("simulated write interruption");
    }
    fsState.files.set(uri, contents);
  },
  deleteAsync: async (uri: string) => {
    fsState.files.delete(uri);
  },
  moveAsync: async ({ from, to }: { from: string; to: string }) => {
    if (fsState.control.failNextMove) {
      fsState.control.failNextMove = false;
      throw new Error("simulated move interruption");
    }
    const value = fsState.files.get(from);
    if (value === undefined) throw new Error(`ENOENT move: ${from}`);
    fsState.files.set(to, value);
    fsState.files.delete(from);
  },
}));

import {
  appendGuestRead,
  clearGuestReads,
  loadGuestReads,
  type GuestRead,
} from "./guest-activity-queue";

const PRIMARY = "file:///doc/guest-activity.json";
const TEMP = `${PRIMARY}.tmp`;
const CORRUPT = `${PRIMARY}.corrupt`;

function read(eventId: string, timestamp: number): GuestRead {
  return { eventId, timestamp, timeSpentSeconds: 45 };
}

const readA = read("eventA", 1000);
const readB = read("eventB", 2000);

beforeEach(() => {
  fsState.files.clear();
  fsState.control.failNextWrite = false;
  fsState.control.failNextMove = false;
});

describe("guest-activity-queue (Ticket 2: atomic write + corrupt recovery)", () => {
  test("append round-trips and leaves no stale temp behind", async () => {
    await appendGuestRead(readA);

    expect(await loadGuestReads()).toEqual([readA]);
    // The atomic swap renames temp into primary, so no temp lingers.
    expect(fsState.files.has(TEMP)).toBe(false);
    expect(fsState.files.has(PRIMARY)).toBe(true);
  });

  test("a crash mid-write keeps the old-valid primary (never corrupt)", async () => {
    fsState.files.set(PRIMARY, JSON.stringify([readA]));

    // The write to the *temp* file throws — the live primary is never touched.
    fsState.control.failNextWrite = true;
    await expect(appendGuestRead(readB)).resolves.toBeDefined();

    // Primary still holds the old, valid content; load recovers it, no throw.
    expect(fsState.files.get(PRIMARY)).toBe(JSON.stringify([readA]));
    expect(await loadGuestReads()).toEqual([readA]);
  });

  test("a crash in the delete→move window recovers the new-valid temp", async () => {
    fsState.files.set(PRIMARY, JSON.stringify([readA]));

    // temp written OK, primary deleted, then the rename is interrupted.
    fsState.control.failNextMove = true;
    await appendGuestRead(readB);

    // Primary is gone but the temp holds the new-valid content.
    expect(fsState.files.has(PRIMARY)).toBe(false);
    expect(fsState.files.has(TEMP)).toBe(true);

    // Load recovers from the temp and promotes it back to a clean primary.
    expect(await loadGuestReads()).toEqual([readA, readB]);
    expect(fsState.files.has(PRIMARY)).toBe(true);
    expect(fsState.files.has(TEMP)).toBe(false);
  });

  test("a corrupt primary with no temp is quarantined, load returns empty", async () => {
    fsState.files.set(PRIMARY, "{ this is not valid json");

    // Must never throw to the caller.
    const reads = await loadGuestReads();

    expect(reads).toEqual([]);
    expect(fsState.files.has(PRIMARY)).toBe(false);
    // Corrupt content preserved for diagnostics, not silently dropped.
    expect(fsState.files.get(CORRUPT)).toBe("{ this is not valid json");
  });

  test("a corrupt primary recovers from a valid temp instead of dropping data", async () => {
    fsState.files.set(PRIMARY, "%%% corrupt %%%");
    fsState.files.set(TEMP, JSON.stringify([readA, readB]));

    expect(await loadGuestReads()).toEqual([readA, readB]);
    // Temp promoted to a clean primary; corrupt content replaced.
    expect(fsState.files.get(PRIMARY)).toBe(JSON.stringify([readA, readB]));
    expect(fsState.files.has(TEMP)).toBe(false);
  });

  test("non-array JSON is treated as corrupt, not loaded", async () => {
    fsState.files.set(PRIMARY, JSON.stringify({ not: "an array" }));

    expect(await loadGuestReads()).toEqual([]);
    expect(fsState.files.has(PRIMARY)).toBe(false);
  });

  test("clear removes the primary and both sidecars (no resurrection)", async () => {
    fsState.files.set(PRIMARY, JSON.stringify([readA]));
    fsState.files.set(TEMP, JSON.stringify([readB]));
    fsState.files.set(CORRUPT, "old corrupt");

    await clearGuestReads();

    expect(fsState.files.has(PRIMARY)).toBe(false);
    expect(fsState.files.has(TEMP)).toBe(false);
    expect(fsState.files.has(CORRUPT)).toBe(false);
    expect(await loadGuestReads()).toEqual([]);
  });
});
