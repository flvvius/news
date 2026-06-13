import "@/global.css";
import "@/lib/intl-polyfills";

import { BottomSheetModalProvider } from "@gorhom/bottom-sheet";
import { ConvexBetterAuthProvider } from "@convex-dev/better-auth/react";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { ConvexReactClient } from "convex/react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { AnalyticsProvider } from "@/contexts/analytics-context";
import { AppThemeProvider } from "@/contexts/app-theme-context";
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

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor },
      }}
    >
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="event/[slug]" />
      <Stack.Screen name="auth" options={{ presentation: "modal" }} />
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <ConvexBetterAuthProvider client={convex} authClient={authClient}>
      <AnalyticsProvider>
        <GestureHandlerRootView className="flex-1">
          <KeyboardProvider>
            <AppThemeProvider>
              <LocaleProvider>
                <BottomSheetModalProvider>
                  <StatusBar style="auto" />
                  <RootStack />
                </BottomSheetModalProvider>
              </LocaleProvider>
            </AppThemeProvider>
          </KeyboardProvider>
        </GestureHandlerRootView>
      </AnalyticsProvider>
    </ConvexBetterAuthProvider>
  );
}
