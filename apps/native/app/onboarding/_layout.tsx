import { Stack } from "expo-router";

/**
 * Onboarding stack: Screen A (promise) → Screen B (topic picker). Gated only
 * by the `hasOnboarded` flag in the root layout — never by auth. The flow is
 * headerless and full-bleed; completion navigates to the feed.
 */
export default function OnboardingLayout() {
  return <Stack screenOptions={{ headerShown: false, gestureEnabled: false }} />;
}
