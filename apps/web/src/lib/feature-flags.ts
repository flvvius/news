import { redirect } from "@tanstack/react-router";

/**
 * Launch feature flags (BIV-802). Flags are compile-time constants: flipping
 * one back on is a one-line change, and nothing quiz-related was deleted.
 */
export const FEATURE_FLAGS = {
  /** Quiz screen + every quiz CTA. Off for the Romanian launch (BIV-802). */
  quiz: false,
  /**
   * "Analiza afirmațiilor" claims tab on event detail. The claim-analysis
   * pipeline is paused (BIV-602), so its UI must not ship (BIV-804).
   */
  claimAnalysis: false,
} as const;

/**
 * Route guard for the quiz screen: direct navigation to /quiz bounces to the
 * feed while the flag is off (no dead screen, no 404).
 */
export function guardQuizRoute() {
  if (!FEATURE_FLAGS.quiz) {
    throw redirect({ to: "/feed", replace: true });
  }
}
