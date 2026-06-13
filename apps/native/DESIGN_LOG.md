# DESIGN_LOG — Biviant native redesign

Aesthetic direction: **editorial calm**. The app reads like a serious
broadsheet: typography and whitespace carry the design; the bias
distribution bar is the only place color encodes meaning.

## Constants

- Spacing: 8pt grid, screen gutter `px-5` (20px)
- Radius: `rounded-lg` (10px) for every surface, `rounded-md` (8px) for
  inputs/chips, full radius only on circular avatars
- Type: screen titles `text-3xl` (31) semibold tight · zone labels
  `text-sm` uppercase tracked muted · body `text-base` (17) relaxed,
  `max-w-[455px]` (~65ch) · meta `text-xs` (13) muted · feed kickers 11px
  uppercase tracked
- Motion: press scale 0.97 @ 120–160ms (`PressableScale`) · content swap
  150ms opacity · sheets/toasts 200–250ms, `Easing.bezier(0.23, 1, 0.32, 1)` ·
  springs only on gestures (toast/swipe-row) with velocity passthrough ·
  nothing over 300ms

## Font decision

Inter is **not** runtime-loaded. The design system's own stack is
`Inter → ui-sans-serif → system-ui`; the native binary doesn't bundle
Inter, so the declared fallback applies. Runtime-loading Google-font
weights on RN registers each weight as a separate font family, which
breaks `font-medium/semibold` utilities across every Text. If Inter
becomes a hard requirement, do it properly via the expo-font config
plugin (static embedding + Android XML font family) and a prebuild.

## Tab bar (system chrome)

- **Rejected:** floating blurred pill (BlurView + shadow). Glassmorphism
  and elevation theater are banned; a dock that floats over content also
  steals reading width at the feed's bottom edge.
- **Now:** flat, full-width, `bg-background` + top hairline. Active state =
  filled icon + foreground text; idle = muted. No animation on tab switch
  (frequency law), haptic selection kept on iOS.

## Feed

- **Rejected:** card pile (image-on-top cards with overlay topic chips,
  shadows, per-card "Citește analiza" CTA pill). Every card shouted; the
  accent color appeared 6+ times per viewport.
- **Rejected:** hide-on-scroll toolbar. Scroll-linked chrome motion on the
  most-visited screen contradicts the frequency law; the masthead now
  holds still.
- **Now:** editorial list. Row = kicker (topic, small caps) → title (max 3
  lines) → 4px distribution bar (tap toggles count labels) → meta
  ("n surse · acum X"), with an optional 80px right thumbnail. Hairline
  separators, no card chrome. First item is a *lead* row (25px headline,
  full-width 3:2 image) — a deliberate front-page move, not a "featured
  card".
- Topic chips: single horizontal row, active = `bg-primary`, instant
  switch. Replaces the filter-pill + bottom-sheet picker (one tap instead
  of three, and the sheet hid the available topics).
- Trending/Recente: plain-text segmented control (weight + color), not pills.
- Skeletons mirror exact row geometry (zero layout shift). Per-row
  bookmark/share buttons removed — actions live on the event screen;
  the feed is for reading.

## Event detail

- Photo: 3:2 (was 16:9), content-width, `rounded-lg`, hairline border,
  `bg-muted` placeholder behind a fixed aspect ratio (zero shift). No
  credit line: the data model has no `imageCredit` field — layout is
  designed to be complete without it. Shared-element transition from the
  feed thumbnail was skipped: expo-router's shared transitions are still
  experimental; a broken transition is worse than none.
- Zone titles ("Ce înseamnă", "Perspective", "Unde diferă sursele",
  "Surse", "So what?") demoted from 25px semibold to the uppercase
  tracked label — hierarchy now runs label → content instead of five
  competing headlines. Claim status groups dropped to 15 medium sentence
  case so they read one level below the zone label.
- Body unified at 17px relaxed (was 19px) — the 28→17 title-to-body ratio
  reads more editorial than 31/19.
- Section rhythm: `mt-8` + hairline + `pt-6` everywhere (was 28px ad-hoc).
- Header bookmark/share: plain icon buttons (circle-border chrome removed).
- Kept: scroll-linked header title fade (single transition), perspective
  tabs with bias-token underline + 150ms opacity swap, claims grouped
  divergence-first with collapsed variants, sources collapsed to 5.

## Bookmarks

- Same row anatomy as the feed (recognition over novelty).
- Swipe-to-remove: custom Pan gesture — flick velocity (>800) dismisses
  regardless of distance, 40% width otherwise; spring return with
  velocity passthrough; rightward drag meets 1/12 friction. Revealed
  layer is flat `bg-destructive/10` + text label, no alarm-red panel.
  Rows expose a screen-reader action as the non-gesture path, and the
  drag offset resets on recycle (FlashList reuses instances).
- Undo toast: `bg-card` + hairline, bottom, 250ms ease-out entrance,
  auto-hide 4s, swipe-down dismissal in the direction it entered (with
  upward friction). Removal is optimistic; undo round-trips.

## Settings / Profile

- Rows are plain label + chevron (leading icon set deleted — seven
  decorative icons added noise, not scent).
- Guest account card: typographic, left-aligned, sign-in as an offer.
  Rejected the centered icon-in-circle "join us" composition (marketing
  layout inside the app).
- Delete account: confirmation bottom sheet (grabber, top-only radius,
  destructive button + quiet cancel) instead of a system Alert. Added
  `--color-destructive-foreground` token (light+dark) for text on the
  destructive surface — extended the token system rather than hardcoding.

## Auth

- Form-level errors are plain `text-destructive` text (boxed error
  banners removed); field errors were already inline.
- "Continuă fără cont" added under the mode switch — guest browsing is a
  first-class exit, not just an X button.
- Verify-email notice: typographic (card + mail-icon mascot removed).

## Empty/error states (global)

- `EmptyState`/`ErrorState`: one typographic line + one action.
  Dashed-border boxes and icon circles deleted. Icon prop kept for API
  compatibility but ignored.

## Activity & Source (light pass)

- Radius drift normalized to `rounded-lg`; `font-bold` titles → semibold;
  dashed empty notes → plain text; source metadata pills → one meta line;
  outlier pill → plain `text-warning` text.
