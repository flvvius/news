# Biviant prod-readiness tickets

Synthesized from the step 1-9 onboarding reviews + production gaps not covered by the onboarding work. Ordered by dependency and severity. Each ticket is self-contained: title, severity, origin step, problem, fix, acceptance criteria.

Legend: P0 = blocks launch (data loss / broken auth / legal). P1 = burns real users. P2 = analytics + conversion integrity. P3 = production table stakes not in onboarding scope.

***

## PHASE 0 — Config gates (unblock everything; no code)

### TICKET C1 — Apple Developer + Convex auth env

* Severity: P0 (gate)
* Enroll in Apple Developer Program. Enable "Sign In with Apple" capability on both dev and prod App IDs.
* Set on dev AND prod Convex deployments: `APPLE_CLIENT_ID`, `APPLE_APP_BUNDLE_IDENTIFIER` (array covering com.biviant.dev + prod bundle id), `APPLE_CLIENT_SECRET` only if web auth later.
* Done when: Apple sign-in succeeds on a real device against both deployments.

### TICKET C2 — Build/runtime config

* Severity: P0 (gate)
* PostHog key in build env, EU region host.
* EAS `projectId` in `app.json` (`extra.eas.projectId`) for push tokens.
* `expo prebuild --clean && expo run:ios` (native modules from Apple auth, expo-crypto, expo-notifications, file-system).
* Done when: app boots on device, PostHog receives events, push-token fetch returns a real token.

***

## PHASE 1 — P0 blockers (data loss / auth / legal)

### TICKET 1 — Merge replay must not blow the Convex transaction

* Severity: P0 | Origin: step 7
* Problem: `mergeGuestActivity` replays up to 1000 guest reads as N live `recordInteraction` calls in one mutation. Hits Convex read/write/time limits -> rollback -> guest loses entire history at signup.
* Fix: fold guest reads into a final computed stats object (streak, articlesRead, biasBalance, lastViewDays, per-topic counts) IN MEMORY, then write once. If per-read rows must persist, batch-insert with bounded counts and/or paginate across scheduled mutations. Keep idempotency via the guestMerges ledger.
* Acceptance: merge of a 1000-read guest completes in one call without limit errors; resulting stats equal a day-by-day replay; re-running returns already\_merged and writes nothing.

### TICKET 2 — Atomic guest-queue write + corrupt-file recovery

* Severity: P0 | Origin: step 5
* Problem: `guest-activity.json` written non-atomically; crash mid-write corrupts the file the merge depends on. No parse-error handling.
* Fix: write temp file then rename. On load, catch JSON parse errors and recover (quarantine the bad file, start fresh, log to error monitoring once T17 lands).
* Acceptance: kill the app mid-write repeatedly -> file is always either old-valid or new-valid, never corrupt; a corrupt file never throws to the user.

### TICKET 3 — Logout must not delete an unmerged queue

* Severity: P0 | Origin: step 7
* Problem: logout clears local stores even when a merge never succeeded -> silent guest-history loss.
* Fix: on logout, only clear the queue if the guestMerges ledger confirms a successful merge for the current deviceId; otherwise retain for retry.
* Acceptance: simulate failed merge -> logout -> next login replays and merges the retained queue.

### TICKET 4 — Apple bundle-id aud verification

* Severity: P0 | Origin: step 2
* Problem: backend verifies idToken `aud` against com.biviant.app; dev builds run com.biviant.dev -> every dev sign-in rejected.
* Fix: `APPLE_APP_BUNDLE_IDENTIFIER` accepts an array; include both bundle ids. Confirm parsing format (comma vs JSON) matches what's set in Convex env.
* Acceptance: Apple sign-in works in both dev and prod builds.

### TICKET 5 — GDPR / EU privacy compliance (workstream, not a checkbox)

* Severity: P0 | Origin: cross-cutting (never in onboarding scope)
* Problem: EU operator collecting device IDs, reading behavior, and political-bias reading patterns with no consent flow, no privacy policy, no documented lawful basis. `deleteUser` likely doesn't purge PostHog person or the local guest queue.
* Fix:

  * Privacy policy + in-app analytics consent (or documented legitimate-interest basis with opt-out). Gate PostHog init on consent state.
  * PostHog on EU region.
  * Extend account deletion to delete the PostHog person (server-side API), clear local guest queue, and remove push tokens.
  * Add a guest-facing "clear my data" path (local queue + device id rotation).
  * Document lawful basis + data inventory for the privacy policy.
* Acceptance: a user can withhold analytics consent and the app still works; account deletion provably removes server rows + PostHog person + local stores; privacy policy is reachable from onboarding and profile.

***

## PHASE 2 — P1 trust / correctness

### TICKET 6 — Notification primer stays dormant until briefing cron sends real pushes

* Severity: P1 | Origin: step 9
* Problem: primer asks for OS permission promising a "morning briefing" nothing sends; burns the one-shot iOS grant.
* Fix: feature-flag the primer off until T19 (briefing cron) ships and delivers a real notification. Also gate the primer to authenticated users (a guest grant cannot be messaged).
* Acceptance: primer never appears in a build where the cron can't send; once enabled, accepting it leads to a real notification within the promised window.

### TICKET 7 — Streak never decreases across signup

* Severity: P1 | Origin: steps 5-7
* Problem: guest teaser count vs merged count must reconcile; a drop looks broken on the feature's first impression.
* Fix: ensure merge produces streak >= teaser value always (holds by set-theory if replay is correct; assert it explicitly).
* Acceptance: device test: teaser shows N, post-signup activity screen shows >= N.

### TICKET 8 — recordRead fires once per visit

* Severity: P1 | Origin: step 5
* Problem: capturing on scroll/time changes can append partial duplicates.
* Fix: one append per event visit on blur/unmount with final time + scroll.
* Acceptance: one queue entry per article visit regardless of scroll activity.

### TICKET 9 — Device UUID resilient to SecureStore transient failure

* Severity: P1 | Origin: step 3
* Problem: a transient iOS keychain read failure on first launch mints a duplicate UUID -> one guest splits into two persons/histories.
* Fix: distinguish "read succeeded, empty" (mint new) from "read threw" (retry, do not mint).
* Acceptance: forced read-throw on first launch does not create a second UUID on next launch.

### TICKET 10 — Logout rotation resets PostHog identity too

* Severity: P1 | Origin: steps 3, 7
* Problem: rotating the stored UUID without resetting PostHog leaves the old distinct\_id + device\_uuid super property -> next guest stitches to previous account.
* Fix: rotateDeviceId contract = new UUID + posthog.reset() + re-register device\_uuid super property.
* Acceptance: after logout, a fresh guest's events are a new PostHog person with no link to the prior account.

### TICKET 11 — Apple/Google duplicate-account handling

* Severity: P1 | Origin: steps 2, 7
* Problem: same human via Apple relay email vs Google real email = two accounts, two histories, two persons.
* Fix: implement account linking (verified-email match or explicit link flow). At minimum, decide + document the chosen behavior.
* Acceptance: signing in with both providers resolves to one account, or the documented behavior is enforced and tested.

### TICKET 12 — Stable feed boost (no scroll reorder)

* Severity: P1 | Origin: step 4
* Problem: topic boost re-partitions the whole accumulated list as pages load -> rows shift under the thumb.
* Fix: freeze the initial page's boosted order; append later pages in natural order below. Layer-1 lead story still always first.
* Acceptance: scrolling and loading more pages never reorders already-rendered rows; the lead story stays position 1.

### TICKET 13 — Onboarding paint gate + Screen A asset integrity

* Severity: P1 | Origin: steps 3, 4
* Problem: must confirm isReady hard-gates paint (splash, not post-mount redirect), waits on BOTH promises, and Screen A fixture image is a bundled local asset.
* Fix: verify/repair all three.
* Acceptance: fresh install shows splash -> Screen A with no feed flash; Screen A image renders offline.

***

## PHASE 3 — P2 analytics / conversion integrity

### TICKET 14 — Unconditional signup event

* Severity: P2 | Origin: step 7
* Problem: signup\_completed only fires with a gate intent -> total signups unmeasurable.
* Fix: emit account\_created server-side in Better Auth onCreate. Keep signup\_completed for the gate funnel.
* Acceptance: every new account produces exactly one account\_created.

### TICKET 15 — Widen streak-teaser trigger

* Severity: P2 | Origin: step 8
* Problem:  hard window means engaged guests who ignore days 2-3 are never re-asked.
* Fix: trigger at streak >= 2 with impression-count-based suppression (e.g. max 2 impressions then 30-day cooldown) instead of a hard upper bound.
* Acceptance: an engaged guest still gets re-surfaced after the cooldown; no endless per-launch nagging.

### TICKET 16 — Analytics hygiene

* Severity: P2 | Origin: steps 1, 4, 7, 8
* Sub-items:

  * Exclude internal/dev devices from funnels (property or cohort).
  * Make gate\_shown / first\_feed\_render "once" guards per-session or state-tied, not per-mount.
  * Swipe-to-dismiss the gate sheet emits gate\_dismissed.
  * Verify all 14 events serialize with correct payloads on device.
  * Fix 22-vs-23 localized topics (one slug renders English in RO).
* Acceptance: funnels exclude dev traffic; impression events don't double-fire on remount; every gate dismissal is counted; all topics localized.

***

## PHASE 4 — P3 production table stakes (net-new, not onboarding fixes)

### TICKET 17 — Error monitoring

* Severity: P3 | Add Sentry (or equivalent) for crash/exception tracking across native + Convex. PostHog is product analytics, not error tracking. Needed before/during the device pass.

### TICKET 18 — Rate limiting

* Severity: P3 | Rate-limit guest-reachable + auth mutations: mergeGuestActivity, registerPushToken, setFollowedTopics, and the analytics ingestion path if first-party.

### TICKET 19 — Morning-briefing cron (feature, unblocks T6)

* Severity: P3 | Build on sendPushToUser: select followed-topic stories per user, fan out, respect send-time + quiet hours, dedupe so a story isn't sent twice, handle token send-failure pruning.

### TICKET 20 — App Store review readiness

* Severity: P3 | Privacy nutrition labels; Sign in with Apple button meets Apple design rules (keep native widget as fallback); in-app account deletion surfaced per Apple requirement; confirm guideline 5.1.1 guest access intact.

### TICKET 21 — Notification lifecycle polish

* Severity: P3 | setNotificationHandler for foreground display; call removePushToken from profile before signOut (server-side token cleanup); Apple first-consent failure guard (name/email consumed only after account persists).

***

## Definition of done — device-pass protocol (run on real hardware, in order)

1. Fresh install -> Screen A renders from fixture, no flash, local image.
2. Pick topics -> feed; the day's top story leads, boost does not filter.
3. Read 2-3 articles across two days (fake the clock) -> streak teaser shows real N.
4. Bookmark as guest -> sheet -> Apple sign-in -> bookmark auto-completes; in PostHog the pre- and post-signup events collapse into ONE person.
5. Merged streak >= teaser; topics preserved (union); queue cleared only after confirmed merge.
6. Force-quit mid-merge and mid-write -> no corruption, no double person, no lost history.
7. Logout -> fresh guest, new UUID, PostHog reset, no data bleed.
8. Withhold analytics consent -> app still works; delete account -> server rows + PostHog person + local stores all gone.

***

## Recommended order

C1, C2 (config, parallel) -> Phase 1 P0 (1-5; T5 GDPR runs as its own workstream in parallel) -> device pass -> Phase 2 P1 (6-13) -> Phase 3 P2 (14-16) -> Phase 4 P3 (17-21, with T19 before enabling T6). Do not ship to App Store with notifications enabled until T19 exists.

​