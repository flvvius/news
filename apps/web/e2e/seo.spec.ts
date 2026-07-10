import { test, expect } from "@playwright/test";

// SEO regression suite (SEO tickets 1-9): every assertion here runs against
// the RAW server response via the request fixture — no JavaScript execution —
// because that is what crawlers (and non-JS AI bots) actually see. Specs
// assert structural invariants, never specific editorial content.

/** Drop <script> blocks so assertions only see crawler-visible HTML. */
function stripScripts(html: string): string {
  return html.replace(/<script\b[\s\S]*?<\/script>/g, "");
}

function countMatches(text: string, pattern: RegExp): number {
  return [...text.matchAll(pattern)].length;
}

test.describe("robots + sitemap", () => {
  test("robots.txt: 200, allow-all with admin/api disallows, sitemap line", async ({
    request,
  }) => {
    const res = await request.get("/robots.txt");
    expect(res.status()).toBe(200);
    const body = await res.text();
    expect(body).toMatch(/User-agent: \*\s+Allow: \//);
    // AI crawlers must never be explicitly disallowed (Ticket 6).
    expect(body).not.toMatch(/GPTBot|ClaudeBot|Claude-Web|PerplexityBot|CCBot|Google-Extended/i);
    expect(body).toContain("Disallow: /admin");
    expect(body).toContain("Disallow: /api/");
    expect(body).toMatch(/Sitemap: https?:\/\/\S+\/sitemap\.xml/);
  });

  test("sitemap.xml: 200 and parses as a urlset", async ({ request }) => {
    const res = await request.get("/sitemap.xml");
    expect(res.status()).toBe(200);
    const xml = await res.text();
    expect(xml).toContain("<urlset");
    expect(xml).toMatch(/<loc>https?:\/\/[^<]+<\/loc>/);
  });
});

test.describe("feed crawlability", () => {
  test("/feed server HTML contains events, archive anchor, canonical and JSON-LD", async ({
    request,
  }) => {
    const res = await request.get("/feed");
    expect(res.status()).toBe(200);
    const raw = await res.text();
    const html = stripScripts(raw);
    // Ticket 1: the feed must not be a loading shell.
    expect(countMatches(html, /href="\/event\//g)).toBeGreaterThan(0);
    // Ticket 3: a real anchor into the paginated archive.
    expect(html).toContain('href="/feed?page=1"');
    expect(html).toMatch(/rel="canonical" href="[^"]+\/feed"/);
    // Ticket 8: Organization + SoftwareApplication schema on the landing feed.
    expect(raw).toContain("application/ld+json");
    expect(raw).toContain('"@type":"Organization"');
    expect(raw).toContain('"@type":"SoftwareApplication"');
  });

  test("archive pages self-canonicalize and chain via next/prev anchors", async ({
    request,
  }) => {
    const res = await request.get("/feed?page=1");
    expect(res.status()).toBe(200);
    const html = stripScripts(await res.text());
    expect(countMatches(html, /href="\/event\//g)).toBeGreaterThan(0);
    expect(html).toMatch(/rel="canonical" href="[^"]+\/feed\?page=1"/);

    // Follow the next anchor if present — the chain must resolve (Ticket 3).
    if (html.includes('href="/feed?page=2"')) {
      const next = await request.get("/feed?page=2");
      expect(next.status()).toBe(200);
      const nextHtml = stripScripts(await next.text());
      expect(nextHtml).toMatch(/rel="canonical" href="[^"]+\/feed\?page=2"/);
      expect(nextHtml).toContain('href="/feed?page=1"');
    }
  });
});

test.describe("event pages", () => {
  test("event page ships title, canonical, Article JSON-LD and non-empty perspective panels", async ({
    request,
  }) => {
    // Discover a real event through the crawl path itself.
    const archiveHtml = stripScripts(
      await (await request.get("/feed?page=1")).text(),
    );
    const slug = archiveHtml.match(/href="\/event\/([^"?]+)"/)?.[1];
    expect(slug, "archive page must expose at least one event link").toBeTruthy();

    const res = await request.get(`/event/${slug}`);
    expect(res.status()).toBe(200);
    const raw = await res.text();
    const html = stripScripts(raw);

    expect(html).toMatch(/<title>[^<]+<\/title>/);
    expect(html).toContain('rel="canonical"');
    expect(html).toMatch(/name="description" content="[^"]+"/);
    // Ticket 8: Article (never NewsArticle — this is aggregation, not
    // original reporting).
    expect(raw).toContain("application/ld+json");
    expect(raw).toContain('"@type":"Article"');
    expect(raw).not.toContain('"@type":"NewsArticle"');

    // Ticket 2 regression guard: every rendered perspective tab panel must
    // carry visible text in the server HTML (forceMount). Radix leaves
    // empty hidden placeholders when forceMount regresses.
    const panels = [
      ...html.matchAll(/role="tabpanel"[^>]*>([\s\S]*?)<\/div>/g),
    ];
    for (const panel of panels) {
      const text = panel[1].replace(/<[^>]+>/g, "").trim();
      expect(
        text.length,
        "perspective tab panel rendered empty in server HTML",
      ).toBeGreaterThan(40);
    }

    // Ticket 9: an event page with rendered summaries must be indexable.
    if (panels.length > 0) {
      expect(html).not.toContain('content="noindex');
    }
  });

  test("unknown slugs and ids return real 404s, not soft-404 shells", async ({
    request,
  }) => {
    const cases = [
      "/event/definitely-not-a-real-slug-xyz",
      "/source/zzzz",
      "/source/zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz",
      "/feed?page=99999",
      "/no-such-route-xyz",
    ];
    for (const path of cases) {
      const res = await request.get(path);
      expect(res.status(), `${path} must 404`).toBe(404);
    }
  });
});

test.describe("metadata discipline", () => {
  test("public pages have unique titles and self-referencing canonicals", async ({
    request,
  }) => {
    const paths = [
      "/feed",
      "/surse",
      "/cum-functioneaza",
      "/sursele-noastre",
      "/despre",
      "/contact",
      "/parteneri",
      "/termeni",
      "/politica-confidentialitate",
    ];
    const titles = new Map<string, string>();
    for (const path of paths) {
      const res = await request.get(path);
      expect(res.status(), `${path} must serve`).toBe(200);
      const html = stripScripts(await res.text());
      const title = html.match(/<title>([^<]*)<\/title>/)?.[1] ?? "";
      expect(title, `${path} must have a title`).not.toBe("");
      const canonical = html.match(/rel="canonical" href="([^"]*)"/)?.[1];
      expect(canonical, `${path} must have a canonical`).toBeTruthy();
      expect(canonical, `${path} canonical must self-reference`).toContain(
        path,
      );
      titles.set(path, title);
    }
    const unique = new Set(titles.values());
    expect(unique.size, "no two pages may share a title").toBe(titles.size);
  });

  test("private/tooling pages are noindexed", async ({ request }) => {
    for (const path of ["/profil", "/salvate", "/activitate"]) {
      const res = await request.get(path);
      const html = stripScripts(await res.text());
      expect(html, `${path} must be noindexed`).toContain(
        'content="noindex, nofollow"',
      );
    }
  });
});
