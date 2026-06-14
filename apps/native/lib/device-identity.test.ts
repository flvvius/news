import { beforeEach, describe, expect, test, vi } from "vitest";

const store = vi.hoisted(() => {
  const items = new Map<string, string>();
  // Number of upcoming getItemAsync calls that should throw.
  const control = { throwReadsRemaining: 0 };
  return { items, control };
});

vi.mock("expo-secure-store", () => ({
  getItemAsync: vi.fn(async (key: string) => {
    if (store.control.throwReadsRemaining > 0) {
      store.control.throwReadsRemaining--;
      throw new Error("keychain read failed");
    }
    return store.items.has(key) ? store.items.get(key)! : null;
  }),
  setItemAsync: vi.fn(async (key: string, value: string) => {
    store.items.set(key, value);
  }),
  deleteItemAsync: vi.fn(async (key: string) => {
    store.items.delete(key);
  }),
}));

vi.mock("expo-crypto", () => {
  let n = 0;
  return { randomUUID: () => `uuid-${++n}` };
});

import * as SecureStore from "expo-secure-store";
import { loadOrCreateDeviceId } from "./device-identity";

const setItemSpy = SecureStore.setItemAsync as unknown as ReturnType<
  typeof vi.fn
>;

beforeEach(() => {
  store.items.clear();
  store.control.throwReadsRemaining = 0;
  setItemSpy.mockClear();
});

describe("loadOrCreateDeviceId (Ticket 9: keychain-failure resilience)", () => {
  test("returns the existing id without minting", async () => {
    store.items.set("biviant.device-id", "existing-id");
    expect(await loadOrCreateDeviceId()).toBe("existing-id");
    expect(setItemSpy).not.toHaveBeenCalled();
  });

  test("first launch (read succeeds empty) mints and persists once", async () => {
    const id = await loadOrCreateDeviceId();
    expect(id).toMatch(/^uuid-/);
    expect(setItemSpy).toHaveBeenCalledTimes(1);
    expect(store.items.get("biviant.device-id")).toBe(id);
  });

  test("a transient read throw does NOT mint a new persisted id", async () => {
    // Every read attempt throws → must not overwrite a possibly-existing id.
    store.control.throwReadsRemaining = 99;
    const id = await loadOrCreateDeviceId();
    expect(id).toMatch(/^uuid-/); // ephemeral, usable this session
    expect(setItemSpy).not.toHaveBeenCalled(); // nothing persisted
    expect(store.items.has("biviant.device-id")).toBe(false);
  });

  test("a stored id survives a transient read failure (no duplicate next launch)", async () => {
    store.items.set("biviant.device-id", "real-id");
    store.control.throwReadsRemaining = 99; // all reads throw this launch
    const ephemeral = await loadOrCreateDeviceId();
    expect(ephemeral).not.toBe("real-id"); // transient ephemeral id
    expect(setItemSpy).not.toHaveBeenCalled();
    // Next launch: reads succeed → the original id is intact, only one identity.
    store.control.throwReadsRemaining = 0;
    expect(await loadOrCreateDeviceId()).toBe("real-id");
  });

  test("a single transient throw then success-empty still mints once", async () => {
    store.control.throwReadsRemaining = 1; // first read throws, retry succeeds
    const id = await loadOrCreateDeviceId();
    expect(id).toMatch(/^uuid-/);
    expect(setItemSpy).toHaveBeenCalledTimes(1);
    expect(store.items.get("biviant.device-id")).toBe(id);
  });
});
