# Miez rebrand (Biviant → Miez) — UI-only pass

Tracks the epic MIEZ-1..11. Scope agreed: **web full + native branding**
(display name/assets only, no Xcode/bundle-ID rename), delivered on one branch
`rebrand/miez-ui`, one commit per ticket.

## Raster assets still to produce (I ship SVG/CSS placeholders; these need real files)

The wordmark is a live inline-SVG placeholder (`BrandLogo.tsx`) and the favicon
is `public/favicon.svg`, so browser tabs already show the new mark. These raster
slots still point at old/placeholder art and need the final logo:

- `apps/web/public/` — `apple-touch-icon.png` (180×180), PWA `icon-192.png` /
  `icon-512.png` (maskable) referenced from `manifest.webmanifest`, and the
  share card `og-image.jpg` (1200×630, dark bg, new mark) — MIEZ-9/10.
  `logo-mark.png` is still the OLD mark (used as favicon PNG fallback +
  apple-touch); regenerate.
- `apps/native/assets/images/` — `icon.png`, `android-icon-*` (adaptive),
  splash — MIEZ-10.

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
