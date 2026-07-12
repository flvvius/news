# MIEZ-11 — QA sweep (neutrality + rebrand regression)

Branch `rebrand/miez-ui`. Sign-off for the Biviant → Miez UI rebrand (MIEZ-1..10).

## Automated results

| Check | Method | Result |
|---|---|---|
| Web typecheck | `tsc` | ✅ no errors |
| Web unit tests | `vitest` | ✅ 84 pass |
| Web production build | `vite build` (client + SSR + server) | ✅ all bundles built (only harmless `"use client"` directive warnings) |
| Backend tests | `vitest` | ✅ 272 pass (4 skipped) |
| Native tests | `vitest` | ✅ 39 pass |
| Design-system enforcement | `design-system.test.ts` | ✅ no hardcoded color utilities; every `:root` token has a `.dark` twin; camp tokens exist and stay perceptually symmetric |

## Checklist

### (a) Leftover Biviant strings/assets
- `grep -ri biviant apps/web/src apps/web/public` → **clean except the
  `BiviantBot` crawler identity** (`bot.tsx`, `publishers.tsx`). That token is
  a legally-pinned crawler product token (compliance L6) and is an intentional,
  documented exception — see `MIEZ_REBRAND.md`. Not a rebrand miss.
- Brand name is a single source (`packages/i18n/brand.ts` = "Miez"); old
  `logo-biviant*.png` removed; new mark shipped (`logo-mark.png`,
  `apple-touch-icon.png`, `favicon.svg`).

### (b) Camp asymmetries (neutrality)
- Camp tokens `--camp-a`/`--camp-b` tuned to near-equal lightness & chroma,
  enforced by a symmetry unit test. Brand `--primary` is a neutral graphite
  (not party-blue), so no camp owns the brand colour.
- Two crusts render at equal width / identical type scale / fixed order
  (reformist left — documented arbitrary axis order); mobile default crust is
  per-session random so neither is the standing default.
- Axis (`BiasIndicator`) is symmetric: camp-a left, camp-b right, core centre,
  equal-type end labels — flipping it horizontally mirrors it.
- No crust defaults open over the other; global impact is collapsed for both.

### (c) Diacritics (ș/ț with comma-below)
- Web self-hosts Inter with a `latin-ext` subset (`index.css` `@font-face`
  unicode-range covers U+0218–021B etc.), used across all weights. Test string
  "Știri: război, miezul nopții, țară" renders in Inter.
- ⚠️ Final human eyeball on the running app still recommended (font rendering
  can't be asserted in jsdom).

### (d) Dark mode consistency
- Every color token defined for light mode has a `.dark` counterpart (enforced
  by test), so camp surfaces, core, axis and crusts all have dark variants.
  theme-color + manifest updated to the dark base `#17181c`.

## Known follow-ups (not rebrand regressions)
1. **BiviantBot crawler rename** — coordinated backend + robots + publisher-
   allowlist + compliance-test change; separate ticket.
2. **Email/auth infra domains** (`hello@biviant.com`, unsubscribe base, auth
   origins) — infra cutover with DNS + email verification; deferred (MIEZ-9).
3. **Raster TODOs** — verify/regenerate `og-image.jpg`; native app icons +
   splash; PWA `screenshots`.
4. **Per-crust source attribution** (MIEZ-3) + **dedicated common summary
   field** for the Miezul block — both need backend support (TODO markers in
   `event-detail-tabs.tsx`).

## Sign-off
Automated gates green across web/backend/native + production build. Remaining
item before merge: one human visual pass on the running app for (c) diacritics
and (d) dark-mode camp intensity, per the notes above.
