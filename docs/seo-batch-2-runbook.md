# SEO batch 2 (SEO-1..11) — runbook & verification

Branch: `feat/seo-batch-2`. Implements SEO-1, 2, 5, 6, 3, 4, 7, 8, 10, 11.
**SEO-9 (per-event dynamic OG images) was intentionally skipped** — it conflicts
with the standing "custom event share/OG images stay OFF" decision (event OG
keeps falling back to the original event photo).

## What changed (per ticket)

- **SEO-1** — Feed now renders at `/` (moved from `feed.tsx` into `index.tsx`,
  incl. the `?page=N` crawl archive). `/feed` is a **308** redirect to `/` that
  preserves query params (`/feed?page=2 → /?page=2`). Every internal
  `to="/feed"` link, the header/mobile nav, `bookmark-button` default,
  `feature-flags` guard, `llms.txt`, and the sitemap fallback now point to `/`.
- **SEO-2** — Root cause of English meta on a `lang="ro"` site: `getLocaleFromMatches`
  defaulted to `"en"` while the product default is `"ro"`. Fixed the fallback to
  `"ro"` (fixes meta on **every** route at once). Homepage title/description/
  og:image:alt set to the Romanian launch copy.
- **SEO-5** — `deriveShortTitle()` in `lib/seo.ts`: first headline segment before
  the ` / ` join, capped ~65 chars on a word boundary. Used in event
  `<title>`/og:title/twitter:title, RSS items, and the news sitemap. The long
  compound title stays as the on-page `<h1>`.
- **SEO-6** — `truncateAtWordBoundary()` in `lib/seo.ts`: ~155-char word-boundary
  cut, single trailing `…`, trailing whitespace/punctuation stripped. Applied to
  the event meta/og description and the NewsArticle JSON-LD description.
- **SEO-3** — `/rss.xml` (RSS 2.0, latest ~50 summarized events, short titles,
  neutral-summary descriptions, RFC-822 `pubDate`, permalink guid). Declared
  site-wide via `<link rel="alternate" type="application/rss+xml">` in `__root`.
  `content-type: application/rss+xml`, 10-min cache.
- **SEO-4** — `/news-sitemap.xml` (Google News namespace, only `<48h` events,
  `Miez`/`ro` publication, short titles). Added to `robots.txt` alongside the
  main sitemap.
- **SEO-7** — Structured-data logo switched from `favicon.svg` to the existing
  512×512 `logo-mark.png` (raster) in both `organizationEntity` and the event
  NewsArticle `publisher.logo`.
- **SEO-8** — Removed `?returnToFeed=1` from event hrefs. "Came from feed" is now
  carried in `sessionStorage` (set on the feed card click, read+cleared on the
  event page), so crawlers only see the clean canonical `/event/$slug`.
- **SEO-10** — `manifest.webmanifest` already existed, is linked, and ships a
  512×512 PNG icon → installability already satisfied. No change needed.

## Local verification (dev server, `feat/seo-batch-2`)

- `curl -sI /feed` → `308`, `location: /`
- `curl /feed?page=2` → `308 → /?page=2`
- `curl -sI /` → `200`
- Homepage meta: title/description/og/twitter/og:image:alt all Romanian;
  `canonical = https://www.miez.news/`; RSS alternate link present.
- `robots.txt` lists both `sitemap.xml` and `news-sitemap.xml`.
- `llms.txt` "News feed" → `/` (no `/feed`).
- `/rss.xml` → 200 `application/rss+xml`, valid channel; `/news-sitemap.xml` → 200
  `application/xml`, valid news namespace.
- Event page: `<title>` 70 chars (≤75), description ends on a word boundary with
  `…`, `publisher.logo = /logo-mark.png`, NewsArticle JSON-LD intact.
- `logo-mark.png` → `image/png`; `manifest.webmanifest` → `application/manifest+json`.
- Typecheck clean; 83/83 unit tests pass; production build succeeds.

> RSS/news feeds returned **0 items** locally only because the new Convex query
> `events.getSyndicationEvents` is not deployed to the dev deployment yet (the
> routes catch the error and return a valid empty feed). See deploy steps.

## Deploy-time dependencies (do in order)

1. **Deploy `packages/backend` to prod Convex** — adds `events.getSyndicationEvents`
   (consumed by `/rss.xml` + `/news-sitemap.xml`) and removes `/feed` from the
   sitemap `STATIC_PATHS`. ⚠️ Watch the Convex CLI cwd gotcha — deploy from the
   backend package dir; a wrong-cwd push can wipe dev functions.
2. **Rebuild the public sitemap snapshot** (`internal.sitemap.rebuildPublicSitemapSnapshot`)
   so `/feed` drops out of the cached `sitemap.xml`. Until then the snapshot
   still advertises `/feed` (which now 308s — harmless but not ideal).
3. **Deploy web** so `/`, the 308, the two feeds, and the meta fixes go live.

## SEO-11 close-out (manual, in Google Search Console — cannot be automated here)

- [ ] Resubmit `sitemap.xml` and `news-sitemap.xml`.
- [ ] URL Inspection → "Request indexing" on `/`, `/despre`, `/surse`, and 2–3 events.
- [ ] Confirm both sitemaps report "Success" on the next read.
- [ ] Rich Results Test on 3 event URLs → zero errors (logo now PNG).
- [ ] Re-run the prod audit: root `200`, `/feed` `308`, zero English meta,
      RSS valid, `grep -c returnToFeed` on homepage HTML = 0.
