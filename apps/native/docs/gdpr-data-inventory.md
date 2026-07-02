# Biviant — GDPR data inventory & lawful basis

_Last updated: 2026-06-14. Source of truth for the privacy policy
(biviant.com/politica-confidentialitate) and for App Store privacy labels._

Biviant is operated from the EU. This document records what personal data the
app processes, why, the lawful basis under the GDPR, where it lives, how long it
is kept, and the mechanisms users have to exercise their rights. It is the
engineering-side companion to the public privacy policy; keep the two in sync.

## Data we process

| Data | Where | Purpose | Lawful basis | Retention |
|------|-------|---------|--------------|-----------|
| Account: email, name, avatar | Convex (`users`, Better Auth) | Provide the account, sign-in, email verification | Art. 6(1)(b) contract | Until account deletion |
| Reading activity: events viewed, time spent, scroll depth, source bias snapshot | Convex (`interactions`); guest copy in local `guest-activity.json` until merge | Reading streak, bias balance, personalized (non-filtering) ranking | Art. 6(1)(b) contract (the core feature) | Until account deletion / guest "clear my data" |
| Derived stats: streak, articles read, bias balance | Convex (`userStats`) | Show the user their own reading habits | Art. 6(1)(b) contract | Until account deletion |
| Bookmarks, followed topics | Convex (`interactions`, `users.followedTopicIds`); guest copy local | Saved items + topic boost | Art. 6(1)(b) contract | Until account deletion / clear |
| Device identifier (rotating UUID) | Local SecureStore; sent to PostHog as `device_uuid` | Stitch the pre/post-signup funnel for one device | Art. 6(1)(f) legitimate interest | Rotated on logout / clear-my-data |
| Product analytics (onboarding funnel, gate/merge events) | PostHog (EU region) | Improve onboarding & conversion | Art. 6(1)(f) legitimate interest, **with opt-out** | Per PostHog retention; deleted on erasure |
| Push token | Convex (`pushTokens`); local until signup | Deliver notifications the user enabled | Art. 6(1)(a) consent (OS permission) | Until logout/deletion/token change |

Note on bias reading patterns: political-leaning *reading behavior* can be
sensitive. We treat it as first-party service data (contract basis) stored in
Convex and **do not** send raw per-article bias to third parties; PostHog
receives only the defined funnel events, not the reading log.

## Lawful basis summary

- **Contract (Art. 6(1)(b))** — account, reading history, stats, bookmarks,
  topics: all necessary to provide the product the user signed up for.
- **Legitimate interest (Art. 6(1)(f))** — product analytics + device-stitching
  via PostHog. Balanced against users with: EU data region, no third-party ad
  tracking, autocapture off (only a named funnel), and a one-tap **opt-out**
  (Profile → Privacy). See Ticket 5a.
- **Consent (Art. 6(1)(a))** — push notifications (the OS permission prompt,
  gated by an in-app primer).

## Processors

- **Convex** — application database & backend (primary store).
- **PostHog (EU Cloud)** — product analytics. EU ingest + API host.
- **Resend** — transactional auth email (verification, password reset).
- **Apple / Google** — Sign in with Apple / Google (auth only).

## User rights mechanisms (implemented)

- **Access / portability** — the in-app activity screens surface the user's own
  data; export on request via support.
- **Erasure** — _signed-in_: Profile → Delete account → purges Convex rows
  (`users`, `userStats`, `userPrivateContext`, `interactions`, `userInsights`,
  `guestMerges`, `pushTokens`), the **PostHog person + events** (server action,
  Ticket 5b), and all local stores (Ticket 5b client wipe).
  _Guest_: Profile → Privacy → "Clear my data" wipes local stores + rotates the
  device id + resets the analytics identity (Ticket 5c).
- **Objection / opt-out** — Profile → Privacy → analytics toggle gates PostHog
  from initializing at all (Ticket 5a). The app remains fully functional when
  opted out.
- **Transparency** — privacy policy linked from onboarding (Screen A) and
  Profile → About; analytics notice shown on first run (Ticket 5d).

## Open items (ops / outside code)

- Set `POSTHOG_PERSONAL_API_KEY` + `POSTHOG_PROJECT_ID` (+ `POSTHOG_API_HOST`)
  on the Convex deployments so the erasure action actually deletes the PostHog
  person (until set it no-ops — see Ticket 5b).
- The linked privacy page path (`/politica-confidentialitate`) is Romanian-only;
  add an English privacy page (or locale routing) so EN users get EN copy.
- Keep this inventory in sync with the public privacy policy and the App Store
  privacy "nutrition labels" (Ticket 20).
