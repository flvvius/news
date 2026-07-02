import { beforeEach, describe, expect, test, vi } from "vitest";

const store = vi.hoisted(() => {
  const items = new Map<string, string>();
  const control = { failReads: false };
  return { items, control };
});

vi.mock("expo-secure-store", () => ({
  getItemAsync: async (key: string) => {
    if (store.control.failReads) throw new Error("keychain unavailable");
    return store.items.has(key) ? store.items.get(key)! : null;
  },
  setItemAsync: async (key: string, value: string) => {
    store.items.set(key, value);
  },
  deleteItemAsync: async (key: string) => {
    store.items.delete(key);
  },
}));

import {
  loadAnalyticsOptOut,
  saveAnalyticsOptOut,
  shouldEnableAnalytics,
} from "./analytics-consent";

beforeEach(() => {
  store.items.clear();
  store.control.failReads = false;
});

describe("shouldEnableAnalytics (Ticket 5a: consent gate)", () => {
  test("enabled only with a key, consent loaded, and not opted out", () => {
    expect(
      shouldEnableAnalytics({
        hasApiKey: true,
        consentLoaded: true,
        optedOut: false,
      }),
    ).toBe(true);
  });

  test("never enabled before the persisted choice has loaded", () => {
    expect(
      shouldEnableAnalytics({
        hasApiKey: true,
        consentLoaded: false,
        optedOut: false,
      }),
    ).toBe(false);
  });

  test("opting out gates the client off", () => {
    expect(
      shouldEnableAnalytics({
        hasApiKey: true,
        consentLoaded: true,
        optedOut: true,
      }),
    ).toBe(false);
  });

  test("no API key means no client regardless of consent", () => {
    expect(
      shouldEnableAnalytics({
        hasApiKey: false,
        consentLoaded: true,
        optedOut: false,
      }),
    ).toBe(false);
  });
});

describe("analytics opt-out persistence (Ticket 5a)", () => {
  test("defaults to opted-in (legitimate interest) when nothing stored", async () => {
    expect(await loadAnalyticsOptOut()).toBe(false);
  });

  test("persists an opt-out and reads it back", async () => {
    await saveAnalyticsOptOut(true);
    expect(await loadAnalyticsOptOut()).toBe(true);
  });

  test("opting back in clears the stored flag", async () => {
    await saveAnalyticsOptOut(true);
    await saveAnalyticsOptOut(false);
    expect(await loadAnalyticsOptOut()).toBe(false);
  });

  test("defaults to opted-in if the keychain read throws", async () => {
    await saveAnalyticsOptOut(true);
    store.control.failReads = true;
    expect(await loadAnalyticsOptOut()).toBe(false);
  });
});
