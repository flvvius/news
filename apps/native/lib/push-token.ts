import * as SecureStore from "expo-secure-store";

import { reportError } from "@/lib/error-monitoring";

/**
 * Locally-held Expo push token. Obtained once the OS permission is granted;
 * registered to Convex when authenticated (immediately if already signed in,
 * otherwise on the next login in session-sync). Cleared on logout.
 */
const PUSH_TOKEN_KEY = "biviant.push-token";

export async function loadPushToken(): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(PUSH_TOKEN_KEY);
  } catch (error) {
    reportError(error, { scope: "push-token.load" });
    return null;
  }
}

export async function savePushToken(token: string): Promise<void> {
  try {
    await SecureStore.setItemAsync(PUSH_TOKEN_KEY, token);
  } catch (error) {
    reportError(error, { scope: "push-token.save" });
    // Best-effort.
  }
}

export async function clearPushToken(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(PUSH_TOKEN_KEY);
  } catch (error) {
    reportError(error, { scope: "push-token.clear" });
    // Best-effort.
  }
}
