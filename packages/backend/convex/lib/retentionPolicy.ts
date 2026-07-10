/**
 * L11/L14 — central retention policy (pure module so the web privacy policy
 * renders from the same object the purge crons enforce; GDPR Art. 30 input).
 */
export const RETENTION_POLICY = {
  /** Waitlist signups that never engaged (still pending, never invited). */
  waitlistUnengagedDays: 90,
  /** Reading history / interaction log. */
  readingHistoryDays: 548, // 18 months
  /** Unverified accounts (enforced by authMaintenance). */
  unverifiedAccountDays: 7,
  /** Personalized insights (already enforced via userInsights.expiresAt). */
  userInsightsDays: 30,
  /** Transient article body text: never stored (retention zero). */
  articleBodyTextDays: 0,
} as const;
