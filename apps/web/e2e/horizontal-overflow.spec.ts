import { expect, test, type Page } from "@playwright/test";
import { gotoHydrated } from "./helpers";

/**
 * BIV-811 regression: pages were horizontally scrollable on narrow mobile
 * viewports. Verified culprit: the perspective tab row on event detail —
 * the old two-word labels ("Formulare reformistă"/"Formulare suveranistă")
 * measured 382px against a 328px container at 360px viewport and widened
 * the whole document by 38px. Labels are now single words and the tab row
 * scrolls internally; source-derived text (titles, summaries) breaks long
 * tokens instead of widening the page.
 */

test.skip(({ isMobile }) => !isMobile, "mobile-viewport regression");

const STATIC_PAGES = [
  "/despre",
  "/termeni",
  "/cum-functioneaza",
  "/sursele-noastre",
];

function horizontalOverflow(page: Page) {
  return page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
  );
}

for (const width of [360, 390]) {
  test(`no horizontal overflow at ${width}px across core pages`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 780 });

    await gotoHydrated(page, "/feed");
    await page.locator('a[href^="/event/"]').first().waitFor();
    expect
      .soft(await horizontalOverflow(page), "/feed is horizontally scrollable")
      .toBeLessThanOrEqual(0);

    for (const path of STATIC_PAGES) {
      await gotoHydrated(page, path);
      expect
        .soft(
          await horizontalOverflow(page),
          `${path} is horizontally scrollable`,
        )
        .toBeLessThanOrEqual(0);
    }

    // Event detail — includes the perspective tab row that caused the
    // original overflow (when the event has multiple perspectives).
    await gotoHydrated(page, "/feed");
    const eventLink = page.locator('a[href^="/event/"]').first();
    await eventLink.waitFor();
    const eventHref = (await eventLink.getAttribute("href"))!;
    await gotoHydrated(page, eventHref);
    await page.locator("h1").first().waitFor();
    expect
      .soft(
        await horizontalOverflow(page),
        "event detail is horizontally scrollable",
      )
      .toBeLessThanOrEqual(0);

    // Source page, reached from the event's article list.
    const sourceLink = page.locator('a[href^="/source/"]').first();
    await sourceLink.waitFor();
    const sourceHref = (await sourceLink.getAttribute("href"))!;
    await gotoHydrated(page, sourceHref);
    await page.locator("h1").first().waitFor();
    expect
      .soft(
        await horizontalOverflow(page),
        "source page is horizontally scrollable",
      )
      .toBeLessThanOrEqual(0);
  });
}
