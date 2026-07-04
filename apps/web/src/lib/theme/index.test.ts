import { beforeEach, describe, expect, test } from "vitest";
import {
  THEME_STORAGE_KEY,
  applyResolvedTheme,
  getStoredThemePreference,
  resolveThemePreference,
  setStoredThemePreference,
} from "@/lib/theme";

beforeEach(() => {
  window.localStorage.clear();
  document.documentElement.className = "";
  document.documentElement.removeAttribute("style");
});

describe("theme preference helpers", () => {
  test("defaults to system when no explicit preference is stored", () => {
    expect(getStoredThemePreference()).toBe("system");
  });

  test("resolves the system preference from prefers-color-scheme", () => {
    expect(resolveThemePreference("system", true)).toBe("dark");
    expect(resolveThemePreference("system", false)).toBe("light");
  });

  test("explicit overrides win over the system preference", () => {
    expect(resolveThemePreference("light", true)).toBe("light");
    expect(resolveThemePreference("dark", false)).toBe("dark");
  });

  test("persists explicit overrides and clears storage for system", () => {
    setStoredThemePreference("dark");
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");

    setStoredThemePreference("system");
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
    expect(getStoredThemePreference()).toBe("system");
  });

  test("falls back when localStorage access is blocked", () => {
    const originalDescriptor = Object.getOwnPropertyDescriptor(
      window,
      "localStorage",
    );

    Object.defineProperty(window, "localStorage", {
      configurable: true,
      get() {
        throw new Error("Storage is blocked");
      },
    });

    try {
      expect(getStoredThemePreference()).toBe("system");
      expect(() => setStoredThemePreference("dark")).not.toThrow();
    } finally {
      if (originalDescriptor) {
        Object.defineProperty(window, "localStorage", originalDescriptor);
      }
    }
  });

  test("applies the resolved theme class and browser color scheme", () => {
    applyResolvedTheme("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(document.documentElement.style.colorScheme).toBe("dark");

    applyResolvedTheme("light");
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    expect(document.documentElement.style.colorScheme).toBe("light");
  });
});
