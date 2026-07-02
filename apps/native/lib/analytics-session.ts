/**
 * Per-session "once" guard (Ticket 16). Impression/funnel events like
 * `gate_shown` and `first_feed_render` must fire once per app session, not once
 * per component mount — remounting (sort/topic switches, banner re-render) was
 * double-firing them. A module-level set lives for the JS session and resets on
 * app restart.
 */
const firedThisSession = new Set<string>();

/** Returns true the first time `key` is seen this session, false after. */
export function markFiredOncePerSession(key: string): boolean {
  if (firedThisSession.has(key)) return false;
  firedThisSession.add(key);
  return true;
}

/** Test-only: clear the session guard. */
export function __resetSessionGuardForTests(): void {
  firedThisSession.clear();
}
