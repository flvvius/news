import { expoClient } from "@better-auth/expo/client";
import { convexClient } from "@convex-dev/better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";
import Constants from "expo-constants";
import * as SecureStore from "expo-secure-store";

const scheme = Constants.expoConfig?.scheme;
const appScheme = typeof scheme === "string" ? scheme : "news-app";
const baseURL = process.env.EXPO_PUBLIC_CONVEX_SITE_URL?.trim();
if (!baseURL) {
  throw new Error(
    "EXPO_PUBLIC_CONVEX_SITE_URL is required. Configure it before initializing auth.",
  );
}

export const authClient = createAuthClient({
  baseURL,
  plugins: [
    expoClient({
      scheme: appScheme,
      storagePrefix: appScheme,
      storage: SecureStore,
    }),
    convexClient(),
  ],
});
