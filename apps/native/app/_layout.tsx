import "@/global.css";
import "@/lib/intl-polyfills";

import { BottomSheetModalProvider } from "@gorhom/bottom-sheet";
import { ConvexBetterAuthProvider } from "@convex-dev/better-auth/react";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { ConvexReactClient } from "convex/react";
import { View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { AnalyticsProvider } from "@/contexts/analytics-context";
import { AppThemeProvider } from "@/contexts/app-theme-context";
import {
  DeviceIdentityProvider,
  useDeviceIdentity,
} from "@/contexts/device-identity-context";
import { FollowedTopicsProvider } from "@/contexts/followed-topics-context";
import { LocaleProvider } from "@/contexts/locale-context";
import { authClient } from "@/lib/auth-client";
import { useTokenColor } from "@/lib/use-token-color";

const convexUrl = process.env.EXPO_PUBLIC_CONVEX_URL;
if (!convexUrl) {
  throw new Error(
    "EXPO_PUBLIC_CONVEX_URL is not set. Copy apps/native/.env.example to .env and fill it in.",
  );
}

const convex = new ConvexReactClient(convexUrl, {
  unsavedChangesWarning: false,
});

function RootStack() {
  const backgroundColor = useTokenColor("--color-background");
  const { isReady, hasOnboarded } = useDeviceIdentity();

  // Hold on a neutral surface until the device id + onboarding flag have
  // loaded, so neither the feed nor onboarding flashes for the wrong audience.
  if (!isReady) {
    return <View className="flex-1" style={{ backgroundColor }} />;
  }

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor },
      }}
    >
      {/* Gated solely by the onboarding flag, never by auth: a fresh install
          sees onboarding first; once done, the tabs become the only home and
          expo-router redirects away from onboarding automatically. */}
      <Stack.Protected guard={!hasOnboarded}>
        <Stack.Screen name="onboarding" />
      </Stack.Protected>
      <Stack.Protected guard={hasOnboarded}>
        <Stack.Screen name="(tabs)" />
      </Stack.Protected>
      <Stack.Screen name="event/[slug]" />
      <Stack.Screen name="auth" options={{ presentation: "modal" }} />
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <ConvexBetterAuthProvider client={convex} authClient={authClient}>
      <AnalyticsProvider>
        <DeviceIdentityProvider>
          <GestureHandlerRootView className="flex-1">
            <KeyboardProvider>
              <AppThemeProvider>
                <LocaleProvider>
                  <FollowedTopicsProvider>
                    <BottomSheetModalProvider>
                      <StatusBar style="auto" />
                      <RootStack />
                    </BottomSheetModalProvider>
                  </FollowedTopicsProvider>
                </LocaleProvider>
              </AppThemeProvider>
            </KeyboardProvider>
          </GestureHandlerRootView>
        </DeviceIdentityProvider>
      </AnalyticsProvider>
    </ConvexBetterAuthProvider>
  );
}
