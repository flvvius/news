import { expect, test } from "@playwright/test";
import { gotoHydrated } from "./helpers";

/**
 * BIV-815 regression: navigating to a new route used to keep the current
 * scroll offset (no router scrollRestoration), so event pages opened ~30%
 * down instead of at the top.
 */

/** Scrolls the feed down and returns the resulting scrollY. */
async function scrollFeedDown(page: import("@playwright/test").Page) {
  await gotoHydrated(page, "/feed");
  await page.locator('a[href^="/event/"]').first().waitFor();
  await page.mouse.wheel(0, 1500);
  await expect
    .poll(() => page.evaluate(() => window.scrollY), { timeout: 5_000 })
    .toBeGreaterThan(300);
  return page.evaluate(() => window.scrollY);
}

/**
 * Clicks an event link currently inside the viewport via a native click, so
 * Playwright's auto-scroll-into-view can't reset the scroll position we are
 * asserting against.
 */
async function clickEventLinkInViewport(
  page: import("@playwright/test").Page,
) {
  const clicked = await page.evaluate(() => {
    const links = Array.from(
      document.querySelectorAll<HTMLAnchorElement>('a[href^="/event/"]'),
    );
    const inViewport = links.find((link) => {
      const rect = link.getBoundingClientRect();
      return rect.top >= 0 && rect.top < window.innerHeight - 40;
    });
    inViewport?.click();
    return Boolean(inViewport);
  });
  expect(clicked).toBe(true);
  await page.waitForURL(/\/event\//);
}

test("navigating from a scrolled feed to an event lands at the top", async ({
  page,
}) => {
  await scrollFeedDown(page);
  // Deliberately click immediately after scrolling: this lands inside
  // router-core's 100ms scroll-writer throttle window, which misattributes
  // the feed offset to the event page — the app-level PUSH corrector in
  // router.tsx must still put us at the top.
  await clickEventLinkInViewport(page);
  await expect
    .poll(() => page.evaluate(() => window.scrollY), { timeout: 5_000 })
    .toBeLessThanOrEqual(2);
});

test("history back restores the previous feed scroll position", async ({
  page,
}) => {
  const feedScrollY = await scrollFeedDown(page);
  // Wait until router-core's throttled scroll writer has persisted the feed
  // position (a real user pauses to read before clicking); without a saved
  // entry there is nothing for goBack to restore.
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const byKey = JSON.parse(
            window.sessionStorage.getItem("tsr-scroll-restoration-v1_3") ||
              "{}",
          );
          return Object.values(byKey).some(
            (entry) =>
              ((entry as { window?: { scrollY: number } }).window?.scrollY ??
                0) > 300,
          );
        }),
      { timeout: 5_000 },
    )
    .toBe(true);
  await clickEventLinkInViewport(page);
  await expect
    .poll(() => page.evaluate(() => window.scrollY), { timeout: 5_000 })
    .toBeLessThanOrEqual(2);

  await page.goBack();
  await page.waitForURL(/\/feed/);
  await expect
    .poll(() => page.evaluate(() => window.scrollY), { timeout: 5_000 })
    .toBeGreaterThan(feedScrollY * 0.5);
});

test("direct load of a static route starts at the top", async ({ page }) => {
  await page.goto("/feed");
  await expect
    .poll(() => page.evaluate(() => window.scrollY))
    .toBeLessThanOrEqual(2);
});
