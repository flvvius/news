# Miez rebrand (Biviant → Miez) — UI-only pass

Tracks the epic MIEZ-1..11. Scope agreed: **web full + native branding**
(display name/assets only, no Xcode/bundle-ID rename), delivered on one branch
`rebrand/miez-ui`, one commit per ticket.

## Brand raster assets

Provided (new Miez mark — teal/coral disc around the core):
- `apps/web/public/logo-mark.png` (512×512), `apple-touch-icon.png` (180×180),
  `favicon.svg`. Wired into `<head>` and `manifest.webmanifest`.

Still to produce / verify:
- `apps/web/public/og-image.jpg` (1200×630) — the default share card. Verify it
  shows the new mark; regenerate if it's still old-brand. (Per-event share
  cards are generated live and already rebranded — `shareAssetsNode.ts`.)
- PWA `screenshots` for the richer install UI (phone + wide). Not referenced
  yet — add real captures then a `screenshots` array to the manifest.
- `apps/native/assets/images/` — `icon.png`, `android-icon-*` (adaptive),
  `splash-icon.png` still old-brand — MIEZ-10.

## MIEZ-10 — store listing (managed outside the repo)

No fastlane/EAS store-metadata files exist in-repo, so the App Store / Play
listings are edited in App Store Connect / Play Console. Values to set:
- Title: **Miez – știri din ambele tabere**
- Short description: **Fiecare știre, din ambele tabere. Gratuit, fără cont.**
- 4 screenshots: story view with the two crusts, the reformist–suveranist axis,
  the "fără cont" onboarding, the digest. Prod ships no dev chrome (devtools are
  DEV-only), so capture straight from the live app at listing viewport — no
  dedicated `/screenshot-mode` route needed.
- Adaptive icon from the new mark.
The PWA install prompt already uses `manifest.webmanifest` (name/short_name/
description/theme/icons) — the web-equivalent of the listing.

## Intentionally-retained "biviant" identifiers (NOT cosmetic — do not rename here)

- **`BiviantBot` crawler token** — `packages/backend/convex/lib/botIdentity.ts`
  (`BOT_USER_AGENT` / `BOT_UA_TOKEN`), used in polite-fetch UA, robots/TDM
  matching, article extraction; pinned by compliance tests (legal L6). Renaming
  is a coordinated backend + robots + publisher-allowlist change → separate
  ticket. Surfaces on `/bot` and `publishers.tsx`.
- **Native `biviant.*` SecureStore keys** (device-id, consent, push token,
  onboarding version, followed-topics, …) — renaming wipes returning-user state
  on upgrade. Keep the convention.
- **Bundle IDs** `com.biviant.app` (iOS + Android) — store identity; out of
  scope (full native rename was declined).
- **SEO/share domains** — migrated to `miez.news` in MIEZ-9: web `seo.ts`
  (canonical/og:url/JSON-LD, now `NewsMediaOrganization`), backend
  `sitemap.ts` default, the generated event share card (`shareAssetsNode.ts`),
  and native `lib/site.ts` (+ test).
- **Email / auth infra domains** (NOT changed here — needs DNS + email-provider
  verification + auth-origin coordination, a companion infra cutover that must
  land with the domain switch): `hello@biviant.com` / reply-to / unsubscribe
  base in `convex/emails.ts`, `convex/auth.ts`, `convex/config.ts`; allowed
  origins in `auth.test.ts`. Prod overrides most via env (`SITE_URL`,
  `EMAIL_FROM_ADDRESS`, …), so set those at cutover.
- **Story `<title>`** now uses the `«story» | Miez` pattern.
