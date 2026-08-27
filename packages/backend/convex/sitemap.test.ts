// The sitemap's static-path list is hand-maintained, and nothing at build time
// notices when a new indexable page is added to the web app without being
// listed here. When that drifts, the page stays canonical and footer-linked
// but is absent from the only complete index we publish — the failure is
// invisible in the UI and shows up weeks later as a page Google never fetched.
// (/metodologie, /finantare, /publishers and /bot had all drifted out.)
import { describe, expect, test } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  ARCHIVE_PAGE_SIZE,
  MAX_ARCHIVE_PAGES,
  STATIC_PATHS,
} from "./sitemap";

const ROUTES_DIR = join(import.meta.dirname, "../../../apps/web/src/routes");

/**
 * A route file is a page the sitemap should list only if it renders something.
 * Redirect-only routes (/feed -> /, /bookmarks -> /salvate) and the layout
 * route declare no `component`, so they are excluded structurally rather than
 * by a hand-maintained allowlist that would drift the same way STATIC_PATHS
 * did. Routes that emit `noindex` are filtered separately.
 */
function isRenderedPage(source: string) {
  return /\bcomponent:/.test(source);
}

/** index.tsx serves the feed at "/", not at "/index". */
function routePath(name: string) {
  return name === "index" ? "/" : `/${name}`;
}

/** Every file-based page route in the web app, as its URL path segment. */
function pageRouteFiles() {
  return readdirSync(ROUTES_DIR).filter(
    (file) =>
      (file.endsWith(".tsx") || file.endsWith(".ts")) &&
      !file.endsWith(".test.tsx") &&
      !file.endsWith(".test.ts") &&
      // Dynamic ($slug, $sourceId) and generated-file routes are enumerated
      // per row elsewhere in the snapshot, not as static paths.
      !file.includes("$") &&
      // robots.txt / sitemap.xml / rss.xml etc. are endpoints, not pages.
      !file.includes("[.]"),
  );
}

describe("sitemap STATIC_PATHS", () => {
  test("lists every indexable static page route", () => {
    const missing: string[] = [];

    for (const file of pageRouteFiles()) {
      const name = file.replace(/\.tsx?$/, "");
      if (name === "__root") continue;
      // Nested/admin routes are dotted (admin.pipeline.tsx) and all noindex.
      if (name.includes(".")) continue;

      const source = readFileSync(join(ROUTES_DIR, file), "utf-8");
      if (!isRenderedPage(source)) continue;
      if (source.includes('content: "noindex')) continue;

      const path = routePath(name);
      if (!STATIC_PATHS.includes(path)) missing.push(path);
    }

    expect(
      missing,
      `indexable pages missing from the sitemap: ${missing.join(", ")}`,
    ).toEqual([]);
  });

  test("lists no path that the web app renders as noindex", () => {
    const wrongly: string[] = [];

    for (const path of STATIC_PATHS) {
      if (path === "/") continue;
      const name = path.slice(1);
      const file = [`${name}.tsx`, `${name}.ts`].find((candidate) =>
        pageRouteFiles().includes(candidate),
      );
      expect(file, `sitemap lists ${path} but no such route file exists`).toBeDefined();
      const source = readFileSync(join(ROUTES_DIR, file!), "utf-8");
      if (source.includes('content: "noindex')) wrongly.push(path);
    }

    expect(
      wrongly,
      `sitemap advertises noindex pages: ${wrongly.join(", ")}`,
    ).toEqual([]);
  });

  test("contains the feed root and no duplicates", () => {
    expect(STATIC_PATHS).toContain("/");
    expect(new Set(STATIC_PATHS).size).toBe(STATIC_PATHS.length);
  });

  test("never advertises /feed, which only redirects", () => {
    expect(STATIC_PATHS).not.toContain("/feed");
  });
});

describe("archive pagination bounds", () => {
  // getPublishedEventsArchivePage refuses any page past ARCHIVE_MAX_SCAN /
  // pageSize and returns an empty page, which the web loader turns into a 404.
  // Advertising past that ceiling would put dead URLs in the sitemap.
  const ARCHIVE_MAX_SCAN = 4000;

  test("stays within the page ceiling the archive query will actually serve", () => {
    expect(MAX_ARCHIVE_PAGES).toBeLessThanOrEqual(
      Math.floor(ARCHIVE_MAX_SCAN / ARCHIVE_PAGE_SIZE),
    );
  });

  test("page size matches the web app's archive page size", () => {
    const indexRoute = readFileSync(join(ROUTES_DIR, "index.tsx"), "utf-8");
    const match = indexRoute.match(/const ARCHIVE_PAGE_SIZE = (\d+);/);
    expect(match, "ARCHIVE_PAGE_SIZE not found in the feed route").toBeTruthy();
    // A mismatch advertises page numbers the archive does not serve.
    expect(Number(match![1])).toBe(ARCHIVE_PAGE_SIZE);
  });
});
