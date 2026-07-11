// L13 — ANSPDCP cookie-fine guard: a fresh page load with NO interaction
// must set zero non-essential cookies or storage. Analytics (PostHog with
// memory persistence) may fire network events but must not persist a device
// id. Allowlist covers only strictly functional, session-scoped entries.
import { expect, test } from "@playwright/test";

// sessionStorage written by TanStack Router scroll restoration — strictly
// functional (back/forward position), session-scoped, no identifier.
const SESSION_STORAGE_ALLOWLIST = [/^tsr-scroll-restoration/];
// No cookies and no localStorage are acceptable on a fresh load.
const COOKIE_ALLOWLIST: RegExp[] = [];
const LOCAL_STORAGE_ALLOWLIST: RegExp[] = [];

test("fresh load sets zero non-essential cookies or storage", async ({
  page,
  context,
}) => {
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  // Give any late-initializing script (analytics) time to misbehave.
  await page.waitForTimeout(1500);

  const cookies = await context.cookies();
  const offendingCookies = cookies.filter(
    (cookie) => !COOKIE_ALLOWLIST.some((pattern) => pattern.test(cookie.name)),
  );
  expect(
    offendingCookies.map((cookie) => cookie.name),
    "non-essential cookies set on fresh load",
  ).toEqual([]);

  const storage = await page.evaluate(() => ({
    local: Object.keys(window.localStorage),
    session: Object.keys(window.sessionStorage),
  }));

  const offendingLocal = storage.local.filter(
    (key) => !LOCAL_STORAGE_ALLOWLIST.some((pattern) => pattern.test(key)),
  );
  expect(offendingLocal, "localStorage keys set on fresh load").toEqual([]);

  const offendingSession = storage.session.filter(
    (key) => !SESSION_STORAGE_ALLOWLIST.some((pattern) => pattern.test(key)),
  );
  expect(offendingSession, "sessionStorage keys set on fresh load").toEqual(
    [],
  );
});

test("no PostHog device-id persistence (ph_* keys) after navigation", async ({
  page,
}) => {
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  await page.goto("/feed");
  await page.waitForLoadState("networkidle");

  const phKeys = await page.evaluate(() =>
    [
      ...Object.keys(window.localStorage),
      ...document.cookie.split(";").map((entry) => entry.split("=")[0]!.trim()),
    ].filter((key) => key.toLowerCase().startsWith("ph_")),
  );
  expect(phKeys).toEqual([]);
});
