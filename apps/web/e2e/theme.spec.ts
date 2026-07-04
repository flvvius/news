import { expect, test } from "@playwright/test";
import { gotoHydrated } from "./helpers";

const STORAGE_KEY = "biviant-theme-preference";

async function installDarkSystemPreference(page: import("@playwright/test").Page) {
  await page.addInitScript(({ storageKey }) => {
    const setupKey = "__biviant_theme_e2e_ready";
    if (window.sessionStorage.getItem(setupKey) !== "true") {
      window.localStorage.removeItem(storageKey);
      window.sessionStorage.setItem(setupKey, "true");
    }

    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      writable: true,
      value: (query: string) => ({
        matches: query.includes("prefers-color-scheme: dark"),
        media: query,
        onchange: null,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        addListener: () => undefined,
        removeListener: () => undefined,
        dispatchEvent: () => true,
      }),
    });
  }, { storageKey: STORAGE_KEY });
}

test("theme setting follows system by default and persists explicit overrides", async ({
  page,
}) => {
  await installDarkSystemPreference(page);
  await gotoHydrated(page, "/profil");

  await expect(page.locator("html")).toHaveClass(/dark/);

  await page.getByRole("button", { name: /light|luminoasă/i }).click();
  await expect(page.locator("html")).not.toHaveClass(/dark/);
  await expect
    .poll(() => page.evaluate((key) => localStorage.getItem(key), STORAGE_KEY))
    .toBe("light");

  await page.reload();
  await expect(page.locator("html")).not.toHaveClass(/dark/);
  await expect
    .poll(() => page.evaluate((key) => localStorage.getItem(key), STORAGE_KEY))
    .toBe("light");

  await page.getByRole("button", { name: /dark|întunecată/i }).click();
  await expect(page.locator("html")).toHaveClass(/dark/);
  await expect
    .poll(() => page.evaluate((key) => localStorage.getItem(key), STORAGE_KEY))
    .toBe("dark");

  await page.getByRole("button", { name: /system|sistem/i }).click();
  await expect(page.locator("html")).toHaveClass(/dark/);
  await expect
    .poll(() => page.evaluate((key) => localStorage.getItem(key), STORAGE_KEY))
    .toBeNull();
});
