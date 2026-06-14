# Account linking — Apple / Google (Ticket 11)

## Decision

Account linking is **enabled by verified email** (Better Auth
`account.accountLinking`, trusted providers `google` + `apple`, in
`packages/backend/convex/auth.ts`). When the same human signs in with two
providers that both return the **same verified email**, they resolve to one
account, one reading history, one PostHog person.

## Known limitation — Apple "Hide My Email"

Apple's private relay (`…@privaterelay.appleid.com`) is a different address from
the user's Google email, so the verified-email match can't link them. A user who
signs in with **Apple + Hide My Email** and separately with **Google** will have
two accounts **by design**. This is acceptable for launch:

- It never merges two *different* people (the dangerous direction).
- It's rare in practice (most users use the same real email or one provider).

## If we need to close the relay gap later

Options, in order of effort:

1. **Explicit in-app link flow** — a "Connect Google/Apple" action in Profile
   that links providers to the current session regardless of email.
2. **Apple email-relay forwarding** — request the user's real email is not
   possible, but we can prompt the user to add/verify a primary email and link
   on match.

Until then the enforced behavior is: same verified email ⇒ one account;
relay-vs-real ⇒ separate accounts.
