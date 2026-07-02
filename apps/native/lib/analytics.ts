/**
 * Typed funnel event catalog for the guest-first onboarding analytics.
 *
 * Every event the product spec requires lives here as a discriminated union so
 * callers cannot emit an unknown name or forget a required payload. The
 * transport (PostHog) is wired in `contexts/analytics-context.tsx`; this module
 * is transport-agnostic on purpose.
 */

/**
 * Contextual gates that prompt sign-in. These are the gates that emit
 * `gate_shown` / `gate_accepted` / `gate_dismissed`. The notification
 * pre-permission primer is tracked separately (`primer_*`).
 */
export type GateReason = "bookmark" | "streak_teaser" | "activity" | "saved";

/**
 * Where a completed signup originated. Mirrors `GateReason` plus the
 * non-gate entry points (the onboarding flow, the profile tab, or a direct
 * visit to the auth screen).
 */
export type SignupSource = GateReason | "onboarding" | "profile" | "direct";

export type AnalyticsEvent =
  // --- Onboarding (Screens A/B/C) ---
  | { name: "onboarding_started" }
  | { name: "promise_continue" }
  | { name: "topics_selected"; properties: { count: number } }
  | { name: "topics_skipped" }
  | { name: "first_feed_render" }
  // --- Engagement ---
  | { name: "first_article_read" }
  // --- Contextual gates ---
  | { name: "gate_shown"; properties: { reason: GateReason } }
  | { name: "gate_accepted"; properties: { reason: GateReason } }
  | { name: "gate_dismissed"; properties: { reason: GateReason } }
  | { name: "signup_completed"; properties: { source: SignupSource } }
  // --- Notification pre-permission primer ---
  | { name: "primer_shown" }
  | { name: "primer_accepted" }
  | { name: "os_push_prompt_result"; properties: { granted: boolean } }
  // --- Guest → account merge ---
  | {
      name: "guest_merge_completed";
      properties: {
        readsReplayed: number;
        topicsReplayed: number;
        streakDays: number;
      };
    };

export type AnalyticsEventName = AnalyticsEvent["name"];

/**
 * Narrowing helper: extracts the properties payload type for a given event,
 * or `undefined` for payload-less events. Used by the transport layer.
 */
export type AnalyticsEventProperties<Name extends AnalyticsEventName> = Extract<
  AnalyticsEvent,
  { name: Name }
> extends { properties: infer P }
  ? P
  : undefined;
