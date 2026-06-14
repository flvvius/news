import * as SecureStore from "expo-secure-store";

/**
 * Analytics consent (Ticket 5a). Biviant's lawful basis for product analytics
 * is legitimate interest, so analytics is ON by default and the user can OPT
 * OUT at any time (Profile → Privacy). The choice persists on-device; opting
 * out gates PostHog from ever initializing (see analytics-context).
 *
 * Stored as the string "1" when the user has opted out; absent/anything else
 * means opted in (the default).
 */
const ANALYTICS_OPT_OUT_KEY = "biviant.analytics-opt-out";

export async function loadAnalyticsOptOut(): Promise<boolean> {
  try {
    return (await SecureStore.getItemAsync(ANALYTICS_OPT_OUT_KEY)) === "1";
  } catch {
    // Default to opted-in (legitimate interest) if the store is unreadable.
    return false;
  }
}

export async function saveAnalyticsOptOut(optedOut: boolean): Promise<void> {
  try {
    if (optedOut) {
      await SecureStore.setItemAsync(ANALYTICS_OPT_OUT_KEY, "1");
    } else {
      await SecureStore.deleteItemAsync(ANALYTICS_OPT_OUT_KEY);
    }
  } catch {
    // Best-effort; the in-memory state still reflects the choice this session.
  }
}

/**
 * Whether the PostHog client should be constructed. Pure so the gate can be
 * unit-tested without React. Analytics runs only when: a key is configured, the
 * persisted consent has loaded (so we never emit before knowing an opt-out),
 * and the user has not opted out.
 */
export function shouldEnableAnalytics(params: {
  hasApiKey: boolean;
  consentLoaded: boolean;
  optedOut: boolean;
}): boolean {
  return params.hasApiKey && params.consentLoaded && !params.optedOut;
}
