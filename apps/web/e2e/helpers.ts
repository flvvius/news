import type { Page } from "@playwright/test";

/**
 * Navigates and waits for client hydration. TanStack Router's scroll
 * handling flips history.scrollRestoration to "manual" when it initializes
 * on the client; waiting for it avoids racing hydration and fails fast if
 * the router's scrollRestoration option is ever removed.
 */
export async function gotoHydrated(page: Page, path: string) {
  await page.goto(path);
  await page.waitForFunction(
    () => window.history.scrollRestoration === "manual",
  );
}
