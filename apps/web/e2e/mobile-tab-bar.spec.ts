import { expect, test, type Page } from "@playwright/test";
import { gotoHydrated } from "./helpers";

/**
 * BIV-810 regression: the bottom tab bar drifted / was obscured on real
 * mobile devices. Root cause: the viewport meta lacked viewport-fit=cover,
 * so env(safe-area-inset-bottom) resolved to 0 on iOS and the bar's bottom
 * row sat inside the home-indicator area while Safari's toolbar collapsed
 * during scroll. Chromium emulation reports all safe-area insets as 0, so
 * these tests pin the fix at its two testable surfaces — the meta tag and
 * the compiled clearance calcs — plus the structural invariants that keep
 * position:fixed working at all.
 */

test.skip(({ isMobile }) => !isMobile, "the tab bar is md:hidden");

const TAB_BAR = '[data-slot="mobile-tab-bar"]';

async function openPage(page: Page, path: string) {
  await gotoHydrated(page, path);
  await page.locator(TAB_BAR).waitFor();
}

/** Asserts the tab bar's bottom edge sits on the viewport bottom. */
async function expectPinned(page: Page) {
  const gap = await page.evaluate(() => {
    const nav = document.querySelector('[data-slot="mobile-tab-bar"]');
    if (!nav) return null;
    return window.innerHeight - nav.getBoundingClientRect().bottom;
  });
  expect(gap).not.toBeNull();
  expect(Math.abs(gap!)).toBeLessThanOrEqual(1);
}

/** Instant programmatic scroll — no inertia, so no settling wait needed. */
function scrollTo(page: Page, top: number) {
  return page.evaluate(
    (y) => window.scrollTo({ top: y, behavior: "instant" }),
    top,
  );
}

test("viewport meta opts into safe-area insets (viewport-fit=cover)", async ({
  page,
}) => {
  await openPage(page, "/feed");
  const content = await page
    .locator('meta[name="viewport"]')
    .getAttribute("content");
  expect(content).toContain("viewport-fit=cover");
});

test("safe-area clearance calcs compile to their base values", async ({
  page,
}) => {
  await openPage(page, "/despre");
  const padding = await page.evaluate(() => ({
    main: getComputedStyle(document.querySelector("main")!).paddingBottom,
    footer: getComputedStyle(document.querySelector("footer")!).paddingBottom,
    nav: getComputedStyle(
      document.querySelector('[data-slot="mobile-tab-bar"]')!,
    ).paddingBottom,
  }));
  // Insets are 0 in this harness, so each calc must resolve to exactly its
  // base clearance. If Tailwind ever drops or mangles the arbitrary-value
  // calc, the declaration disappears and these compute to 0px.
  expect(padding.main).toBe("64px");
  expect(padding.footer).toBe("80px");
  expect(padding.nav).toBe("0px");
});

for (const path of ["/feed", "/despre"]) {
  test(`tab bar stays pinned to the viewport bottom while scrolling ${path}`, async ({
    page,
  }) => {
    await openPage(page, path);
    if (path === "/feed") {
      // Wait for feed content so the page is actually tall enough to scroll.
      await page.locator('a[href^="/event/"]').first().waitFor();
    }
    await expectPinned(page);
    for (const top of [800, 2800]) {
      await scrollTo(page, top);
      await expectPinned(page);
    }
  });
}

test("tab bar stays pinned on an event detail page", async ({ page }) => {
  await openPage(page, "/feed");
  await page.locator('a[href^="/event/"]').first().click();
  await page.waitForURL(/\/event\//);
  await scrollTo(page, 1200);
  await expectPinned(page);
});

test("no ancestor of the tab bar creates a containing block for position:fixed", async ({
  page,
}) => {
  await openPage(page, "/feed");
  const offenders = await page.evaluate(() => {
    const nav = document.querySelector('[data-slot="mobile-tab-bar"]');
    const found: string[] = [];
    let el = nav?.parentElement ?? null;
    while (el) {
      const s = getComputedStyle(el);
      // Any of these turn the ancestor into the containing block for
      // fixed-position descendants, unpinning the bar from the viewport.
      if (
        s.transform !== "none" ||
        s.filter !== "none" ||
        s.backdropFilter !== "none" ||
        s.perspective !== "none" ||
        /transform|filter|perspective/.test(s.willChange) ||
        /paint|layout|strict|content/.test(s.contain)
      ) {
        found.push(
          `${el.tagName}.${el.className} transform=${s.transform} filter=${s.filter} backdrop=${s.backdropFilter} perspective=${s.perspective} will-change=${s.willChange} contain=${s.contain}`,
        );
      }
      el = el.parentElement;
    }
    return found;
  });
  expect(offenders).toEqual([]);
});

test("opening and closing the topic drawer preserves the scroll position", async ({
  page,
}) => {
  await openPage(page, "/feed");
  // Wait for feed content — before it streams in the page is too short to
  // scroll meaningfully.
  await page.locator('a[href^="/event/"]').first().waitFor();
  // Scroll a small, deterministic amount that keeps the trigger in view. A
  // real user can only tap a visible trigger; clicking an off-screen one
  // makes Playwright scroll the page itself, which is what we'd then
  // (falsely) blame on the drawer.
  const before = 48;
  await scrollTo(page, before);
  await expect
    .poll(() => page.evaluate(() => window.scrollY), { timeout: 5_000 })
    .toBe(before);

  await page.locator('[data-slot="drawer-trigger"]').first().click();
  await page.locator('[data-slot="drawer-content"]').waitFor();
  // The bar must stay pinned even while vaul holds <body> position:fixed.
  await expectPinned(page);

  await page.keyboard.press("Escape");
  await page
    .locator('[data-slot="drawer-content"]')
    .waitFor({ state: "hidden" });
  // The bug this guards against loses the offset entirely (restores to ~0),
  // so a couple of px of sub-pixel drift is fine.
  await expect
    .poll(
      () => page.evaluate(() => window.scrollY).then((y) => Math.abs(y - before)),
      { timeout: 5_000 },
    )
    .toBeLessThanOrEqual(2);
});

test("footer content clears the tab bar at the end of the page", async ({
  page,
}) => {
  // A static page: the feed's infinite scroll would keep pushing the footer
  // below the viewport while we measure.
  await openPage(page, "/despre");
  await page.evaluate(() =>
    window.scrollTo({
      top: document.documentElement.scrollHeight,
      behavior: "instant",
    }),
  );
  const copyright = page.locator("footer").getByText(/©/);
  await expect(copyright).toBeVisible();
  const copyrightBox = await copyright.boundingBox();
  const navBox = await page.locator(TAB_BAR).boundingBox();
  expect(copyrightBox).not.toBeNull();
  expect(navBox).not.toBeNull();
  expect(copyrightBox!.y + copyrightBox!.height).toBeLessThanOrEqual(
    navBox!.y + 1,
  );
});
