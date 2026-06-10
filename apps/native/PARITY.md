# PARITY.md — native vs. web mobile (390px)

Per-screen log: what matches the web mobile rendering, what was translated to a
native idiom and why, and what was verified in this environment.

## Global

**Matches web**
- Full oklch token set ported 1:1 into `global.css` (light + dark), including the
  bias spectrum (indigo/gray/amber) and `--bias-track`. Components use only
  semantic token classes; the raw-palette grep audit passes with zero hits.
- Typography scale, weights, `leading-relaxed` body text, `tracking-tight`
  headings, muted helper text — same classes as web.
- Spacing rhythm: cards `rounded-[1.2rem]`/`[1.4rem]`/`[1.15rem]` matching the
  web's per-surface radii; `border-border/70`–`/80` hairlines; `bg-muted/30`
  section headers.

**Native idiom translations**
- Font: web loads self-hosted Inter; native uses the platform system font
  (SF Pro / Roboto), which is inside the design system's declared fallback
  stack (`Inter → ui-sans-serif → system-ui`). Avoids Android per-weight font
  registration issues and removes font loading from the cold-start path.
- Image-overlay topic chips: web uses raw `bg-black/45 text-white border-white/20`;
  those raw classes are banned here, so they became semantic tokens
  (`--color-overlay`, `--color-overlay-foreground`, `--color-overlay-border`)
  with identical values, theme-stable by design.
- Web footer: **not replicated anywhere** (explicit exception). Its pages live
  only under Profile → About Biviant.
- Copy is English; the web app's ro/en i18n layer was not ported (out of scope
  for the core reading experience; strings are centralized enough to wire a
  locale layer later).
- BiasIndicator's gradient track: CSS `linear-gradient` → three token-colored
  segments at the same 40% opacity (no extra gradient dependency).

## Feed (`(tabs)/index` ↔ `/feed`)

**Matches web**: trending/recent segmented pill toggle (clock / trending icons),
topic filter pill with active-state `border-primary/50 bg-primary/5` and clear
button, "Trending story"/"Lead story" feature card + "More events" section
headings, EventCard layout (16/10 image, overlay topic chips, uppercase
"Updated …" eyebrow, share/bookmark icon buttons, title, 3-line summary clamp,
source avatar stack with counts, bias distribution bar with left/center/right
captions), page size + max sources from `config.getPublicRuntimeConfig`.

**Native idioms**: topic Drawer+Command list → bottom sheet with search input;
IntersectionObserver infinite scroll → FlashList `onEndReached`; pull-to-refresh
resets pagination by remounting the `usePaginatedQuery` subtree (Convex data is
live; there is nothing to refetch); the floating auto-hiding control card is a
pinned header bar (calmer, standard native pattern). Feed search and the quiz
CTA banner are web-only features not in the native scope list.

**States**: skeleton cards (first load), empty (global + per-topic), error
boundary with retry, footer loading row.

## Event detail (`event/[slug]` ↔ `/event/$slug`)

**Matches web**: back-to-feed text button, hero card (16/9 image with
border-b, OVERVIEW eyebrow + bookmark/share, bold title, "Updated …" chip,
avatar stack + article/source counts row), Perspectives | Claim breakdown
rounded segmented tabs, perspective summaries card with Left/Center/Right tabs,
"Why this matters" (globalImpact) card, source coverage summary (distribution
bar, three stat boxes, per-source rows with BiasIndicator, reliability n/10 and
MBFC factual/credibility), claim breakdown (filterable stat cards, status
sections with primary-border headings, claim cards with lean/value chips,
2-visible variants + expand), original reporting list (article image, source
row with bias indicator, date, title, summary, "Read original"). Single
`bias_thresholds` config subscription shared across all indicators (no N+1).

**Native idioms**: perspective tabs carry bias-token dots (the brief requires
bias tokens on these tabs; web uses plain tabs); article/source links open in
the in-app browser (`expo-web-browser`); view interaction logged on screen
leave with time-spent + max scroll depth from `onScroll` (web uses window
scroll); per-source pages (`/source/$sourceId`) are web-only, so source rows
are not links.

**States**: full skeleton, not-found with back CTA, error boundary, claims
loading/empty states.

## Saved (`(tabs)/saved` ↔ `/salvate`)

**Matches web**: header card with SAVED eyebrow + title + count, same EventCard
list. **Native idioms**: sign-in prompt is an inline empty-state CTA into the
auth modal. Optimistic updates: `isEventBookmarked` flips instantly everywhere;
unbookmarking removes the row from this list before the server confirms.

**States**: auth-loading skeletons, signed-out prompt, empty with feed CTA,
error boundary.

## Auth (`auth` modal ↔ web auth forms)

**Matches web**: label + input + inline `text-destructive` errors, primary
submit button with busy state, error banner, sign-in/sign-up toggle copy,
verify-email flow with resend (server requires verification before sign-in).
**Native idioms**: presented as a modal screen; keyboard-aware scroll.
**Not ported** (web-only, out of native scope): Google OAuth button, forgot-
password flow (reset emails link to the web app).

## Profile (`(tabs)/profile` ↔ `/profil` + former footer)

Account card (initial avatar, name, email, unverified-email warning), guest
sign-in prompt, theme picker (System/Light/Dark — persisted separately from
auth storage so sign-out can't touch it), **About Biviant** group hosting all
seven former footer pages via in-app browser (About us, How it works, Our
sources, Contact, Partners, Privacy, Terms — reachable signed out, satisfying
the pre-signup legal-pages requirement), sign out, delete account
(confirmation alert → `authClient.deleteUser()`, with a contact-page fallback
because server-side deletion is not enabled and the server auth config is
off-limits beyond trustedOrigins).

## Verification record (honest accounting)

Verified in this environment:
- `tsc --noEmit` clean (strict, no `any`, no `ts-ignore`).
- `npx expo-doctor`: 21/21 checks passed.
- Release iOS Hermes bundle exports successfully (validates the uniwind metro
  pipeline + React Compiler config end-to-end); bundle `strings` scan shows no
  API keys/secrets — only the two `EXPO_PUBLIC_CONVEX_*` URLs.
- Raw-palette class grep: zero hits.
- Tokens/session storage: SecureStore only (no AsyncStorage anywhere); the one
  `console.*` call is `__DEV__`-guarded.

NOT verified here (requires a device/simulator — must be done before declaring
the performance budget met):
- Cold-start < 2.5s and scroll frame timing on a mid-range Android profile.
- Side-by-side screenshots against the web app at 390px.
- End-to-end auth round trip on device (sign up → restart → still signed in →
  sign out → SecureStore purged).
