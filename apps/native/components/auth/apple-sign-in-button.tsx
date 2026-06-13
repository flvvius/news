import * as AppleAuthentication from "expo-apple-authentication";
import { useEffect, useState } from "react";
import { ActivityIndicator, Platform, Pressable, Text } from "react-native";

import { Icon } from "@/components/ui/icon";
import { useT } from "@/contexts/locale-context";
import { authClient } from "@/lib/auth-client";
import { cn } from "@/lib/cn";

/** Apple raises this code when the user dismisses the native sheet. */
const APPLE_CANCELED_CODE = "ERR_REQUEST_CANCELED";

function isUserCancellation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === APPLE_CANCELED_CODE
  );
}

/**
 * Native Sign in with Apple. Renders only where the native API is available
 * (iOS 13+); on Android/web the Google + email methods carry sign-in, so this
 * returns null rather than a broken affordance.
 *
 * Flow: `signInAsync` returns an identity token (a JWT whose `aud` is the app
 * bundle id), which we hand to Better Auth's `signIn.social` idToken path. The
 * server verifies it against Apple's keys — no redirect, no client secret.
 * Apple only returns the user's name/email on the *first* consent, so we
 * forward them so the account is created with a name.
 */
export function AppleSignInButton({
  disabled = false,
  onSuccess,
  onError,
}: {
  disabled?: boolean;
  onSuccess: () => void;
  onError: (message: string) => void;
}) {
  const t = useT();
  const [isLoading, setIsLoading] = useState(false);
  const [isAvailable, setIsAvailable] = useState(false);

  useEffect(() => {
    let cancelled = false;
    AppleAuthentication.isAvailableAsync()
      .then((available) => {
        if (!cancelled) setIsAvailable(available);
      })
      .catch(() => {
        // Treat probe failures as "unavailable" — the button simply hides.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (Platform.OS !== "ios" || !isAvailable) {
    return null;
  }

  const handlePress = async () => {
    if (isLoading) return;
    setIsLoading(true);
    try {
      const credential = await AppleAuthentication.signInAsync({
        requestedScopes: [
          AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
          AppleAuthentication.AppleAuthenticationScope.EMAIL,
        ],
      });

      const identityToken = credential.identityToken;
      if (!identityToken) {
        onError(t("auth.appleError"));
        return;
      }

      const { error } = await authClient.signIn.social({
        provider: "apple",
        idToken: {
          token: identityToken,
          // Name/email arrive only on first consent — forward them so the
          // created account is not nameless. Absent on later sign-ins.
          user: credential.fullName
            ? {
                name: {
                  firstName: credential.fullName.givenName ?? undefined,
                  lastName: credential.fullName.familyName ?? undefined,
                },
                email: credential.email ?? undefined,
              }
            : undefined,
        },
      });
      if (error) {
        onError(t("auth.appleError"));
        return;
      }

      // The user may abandon the flow — only treat it as success once a
      // session actually exists (mirrors the Google button).
      const session = await authClient.getSession();
      if (session.data) {
        onSuccess();
      }
    } catch (error) {
      if (isUserCancellation(error)) {
        return;
      }
      console.error(error);
      onError(t("auth.appleError"));
    } finally {
      setIsLoading(false);
    }
  };

  const isDisabled = disabled || isLoading;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t("auth.continueApple")}
      accessibilityState={{ disabled: isDisabled, busy: isLoading }}
      disabled={isDisabled}
      onPress={() => void handlePress()}
      className={cn(
        "min-h-11 flex-row items-center justify-center gap-2 rounded-md border border-input bg-background active:bg-muted/50",
        isDisabled && "opacity-70",
      )}
    >
      {isLoading ? (
        <ActivityIndicator size="small" colorClassName="accent-foreground" />
      ) : (
        <Icon name="logo-apple" size={16} className="text-foreground" />
      )}
      <Text className="text-sm font-medium text-foreground">
        {t("auth.continueApple")}
      </Text>
    </Pressable>
  );
}
