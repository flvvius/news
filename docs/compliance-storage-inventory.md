# L13 — Cookie & storage inventory (web)

Goal: **zero non-essential cookies/storage before any user interaction** —
no consent banner needed (ePrivacy strictly-necessary exemption; avoids the
ANSPDCP pre-consent tracker fine category entirely). Enforced by
`apps/web/e2e/consent-free-storage.spec.ts` (fresh load must set nothing
outside the allowlist below).

## Analytics

PostHog (EU-hosted: `eu.i.posthog.com`) runs **cookieless**:
`persistence: "memory"` — no `ph_*` cookie, no localStorage device id, no
session recording, no surveys. Anonymous visitors get a per-visit random id
(`person_profiles: "identified_only"`); logged-in users are identified via
their account id (contract-based processing, documented in the privacy
policy). Events still arrive; cross-visit anonymous stitching is deliberately
sacrificed.

## Set on fresh load (no interaction)

| Entry | Type | Purpose | Classification |
|---|---|---|---|
| `tsr-scroll-restoration-v1_3` | sessionStorage | Back/forward scroll position (TanStack Router) | Strictly functional, session-scoped, no identifier |

Nothing else. No cookies, no localStorage.

## Set only after explicit user action

| Entry | Type | Trigger | Purpose |
|---|---|---|---|
| Better Auth session cookies | cookie (HttpOnly) | Login | Authentication — strictly necessary |
| `bv_locale` | cookie | Language picker | UI language preference |
| `biviant-theme-preference` | localStorage | Theme picker (removed when back on "system") | UI theme preference |
| `biviant-recent-event-searches` | localStorage | Performing a search | Recent-searches convenience list |

All post-action entries are first-party, functional, and user-initiated —
within the strictly-necessary/functional exemption; documented in the
privacy policy (L14).

## Third parties

No GA4, no pixels, no ad/tracking scripts, no CDN scripts. Publisher
thumbnails are hotlinked `<img>` requests (L9) — no script execution.

If any non-essential storage is ever introduced, it must be consent-gated
(default denied, equal accept/reject) **before** it loads, and this
inventory + the e2e allowlist updated.
