# App Store review readiness (Ticket 20)

Checklist for the iOS submission. Items marked **(ops)** are done in App Store
Connect / Xcode, not in code.

## Privacy nutrition labels (ops)

Declare in App Store Connect → App Privacy, matching
`docs/gdpr-data-inventory.md`:

- **Identifiers** — device id (rotating UUID), linked to analytics; used for
  Analytics + App Functionality. Not used for tracking across other companies'
  apps (no IDFA, no ad SDKs).
- **Usage Data** — product interactions (onboarding/gate funnel) → Analytics.
- **Contact Info** — email (account), linked to identity, App Functionality.
- **User Content / History** — reading history, bookmarks, followed topics →
  App Functionality, linked to identity.

Because analytics is opt-out (Profile → Privacy) and not cross-app tracking,
**App Tracking Transparency (ATT) is not required**. Do not add the IDFA / ATT
prompt unless an ad/attribution SDK is introduced.

## Sign in with Apple (Guideline 4.8 / HIG)

- Native `AppleSignInButton` uses the system widget styling and is offered
  alongside Google + email (`components/auth/apple-sign-in-button.tsx`).
- Sign in with Apple is offered wherever third-party sign-in is offered, as
  required when Google is present. ✅ in code.
- First-consent name/email is preserved across retries (Ticket 21) so accounts
  aren't created nameless.

## Account deletion (Guideline 5.1.1(v))

- In-app deletion is surfaced: Profile → Delete account → `authClient.deleteUser()`.
- Deletion purges server rows, the PostHog person, push tokens, and local stores
  (Tickets 5b). ✅

## Guest access (Guideline 5.1.1)

- The app is fully usable signed-out: browse feed, read events, follow topics,
  bookmark (gated only at the save step with a sign-in offer, never a wall).
- Guests can clear their data (Profile → Privacy → Clear my data, Ticket 5c). ✅

## Notifications

- The notification primer stays **off** until the briefing cron can deliver
  (Ticket 6, `EXPO_PUBLIC_NOTIFICATIONS_ENABLED`). Do **not** ship with
  notifications enabled until T19's cron is live, so the OS permission grant is
  never burned on a promise the app can't keep.

## Pre-submission ops gates (from C1/C2)

- Apple Developer enrollment + Sign in with Apple capability (dev + prod App IDs).
- Convex Apple env (`APPLE_CLIENT_ID`, `APPLE_APP_BUNDLE_IDENTIFIER` array).
- EAS `projectId` + `expo prebuild --clean` native build.
