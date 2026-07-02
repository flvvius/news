# Native App Plan — core reading experience parity

## Screen inventory (Expo Router)

| Route | Screen | Web reference (390px) |
| --- | --- | --- |
| `(tabs)/index` | Feed: trending/recent toggle, topic filter (bottom sheet), infinite pagination, pull-to-refresh, skeletons | `/feed` |
| `event/[slug]` | Event detail: hero, perspective tabs, claims, source coverage, articles, share/bookmark | `/event/$slug` |
| `(tabs)/saved` | Bookmarks (auth-gated, optimistic toggle) | `/salvate` |
| `auth` (modal) | Sign in / sign up | `/dashboard?mode=signin` forms |
| `(tabs)/profile` | Settings/Profile + About Biviant group | `/profil` + footer pages |
| `about/[page]` | Former web-footer pages via in-app browser | `/despre`, `/cum-functioneaza`, `/sursele-noastre`, `/contact`, `/parteneri`, `/politica-confidentialitate`, `/termeni` |

No footer anywhere; footer pages live only under Profile → About Biviant. Privacy & Terms
are reachable while signed out (Profile tab is not auth-gated).

## Shared components

- `components/ui/` — `skeleton`, `pill`, `section-card`, `segmented-control`, `error-state`, `empty-state`
- `components/bias-indicator.tsx` — port of web BiasIndicator (track + dot + label, bias tokens)
- `components/bias-distribution-bar.tsx` — left/center/right bar (event card + coverage)
- `components/source-avatar.tsx` + overlapping stack (expo-image, recyclingKey)
- `components/event-card.tsx` — feed/featured variants, used by Feed + Bookmarks
- `components/bookmark-button.tsx` — optimistic Convex mutation
- `lib/` — `dates.ts` (ported), `bias.ts` (bucket logic), `interactions.ts` (context snapshot, deviceType "mobile"), `strings.ts` (copy)

## Backend gaps

None. Everything needed exists: `events.getPublishedEvents` (paginated, topic+sort),
`topics.getTopics`, `events.getEventBySlug`, `claimDivergence.getEventClaims`,
`interactions.toggleBookmark` / `isEventBookmarked` / `getBookmarkedEvents` /
`logInteraction`, `user.getCurrentUser`, `config.getPublicRuntimeConfig`.
No backend changes required (server already has the Better Auth expo plugin and
`news-app://` in trusted origins via NATIVE_APP_URL).

## Stack changes

- Expo SDK 56 (latest), RN 0.85.x, React 19.2, New Architecture (mandatory in SDK 55+), Hermes, React Compiler.
- uniwind ^1.8 (tokens in `@theme`, dark overrides in `@variant dark`), drop heroui-native
  (its `bg-danger`/`bg-surface` theme conflicts with our token system).
- Add `expo-image`, `@shopify/flash-list`, `expo-web-browser`.
- Auth client: keep better-auth + expoClient(SecureStore) + convexClient; drop unused
  `anonymousClient` (server has no anonymous plugin). `ConvexReactClient` with `expectAuth: true`.

## Pull-to-refresh semantics

Convex queries are live subscriptions; "refresh" resets pagination to the first page
(remount of `usePaginatedQuery` via key bump). No polling, no manual refetch loops.

## Risk list

1. SDK 54 → 56 upgrade (reanimated v4 / gesture-handler / uniwind metro transformer compat) — mitigated by `expo install --fix` + typecheck + expo-doctor.
2. `expectAuth: true` with anonymous feed browsing — queries run unauthenticated after auth resolution; verify feed loads signed out.
3. Email verification is required server-side — sign-up flow must surface "check your inbox" instead of assuming an instant session.
4. eventClaims variants reference `sourceLean` strings — render defensively.
5. Simulator/profiler evidence may not be obtainable in this environment; PARITY.md will record exactly what was and wasn't verified.
