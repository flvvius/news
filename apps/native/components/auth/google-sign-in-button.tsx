import { useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";

import { Icon } from "@/components/ui/icon";
import { useT } from "@/contexts/locale-context";
import { authClient } from "@/lib/auth-client";
import { cn } from "@/lib/cn";
import { reportError } from "@/lib/error-monitoring";

export function AuthDivider() {
  const t = useT();

  return (
    <View className="my-2 flex-row items-center gap-3">
      <View className="h-px flex-1 bg-border" />
      <Text className="text-xs uppercase text-muted-foreground">
        {t("auth.orContinueWith")}
      </Text>
      <View className="h-px flex-1 bg-border" />
    </View>
  );
}

export function GoogleSignInButton({
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

  const handlePress = async () => {
    if (isLoading) return;
    setIsLoading(true);
    try {
      // The Better Auth expo plugin opens the system auth session and
      // resolves once the browser deep-links back into the app.
      const result = await authClient.signIn.social({
        provider: "google",
        callbackURL: "/",
      });
      if (result.error) {
        onError(t("auth.googleError"));
        return;
      }
      // The user may dismiss the browser without finishing — only treat
      // it as success once a session actually exists.
      const session = await authClient.getSession();
      if (session.data) {
        onSuccess();
      }
    } catch (error) {
      console.error(error);
      reportError(error, { scope: "auth.googleSignIn" });
      onError(t("auth.googleError"));
    } finally {
      setIsLoading(false);
    }
  };

  const isDisabled = disabled || isLoading;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t("auth.continueGoogle")}
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
        <Icon name="logo-google" size={16} className="text-foreground" />
      )}
      <Text className="text-sm font-medium text-foreground">
        {t("auth.continueGoogle")}
      </Text>
    </Pressable>
  );
}
