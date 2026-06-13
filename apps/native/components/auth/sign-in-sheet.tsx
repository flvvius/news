import { BottomSheetModal } from "@gorhom/bottom-sheet";
import { forwardRef, useRef, useState } from "react";
import { Text } from "react-native";

import { AppleSignInButton } from "@/components/auth/apple-sign-in-button";
import { GoogleSignInButton } from "@/components/auth/google-sign-in-button";
import { PressableScale } from "@/components/ui/pressable-scale";
import { Sheet } from "@/components/ui/sheet";
import { useT } from "@/contexts/locale-context";

type SignInSheetProps = {
  /** Benefit-framed heading for the gate (e.g. "Save stories across devices"). */
  title: string;
  body: string;
  /** Auth succeeded in-sheet (Apple/Google). The sheet dismisses itself. */
  onSuccess: () => void;
  /** User chose the email fallback — caller navigates to the auth screen. */
  onEmail: () => void;
  /** Sheet closed without choosing any method (swipe/backdrop). */
  onCancel: () => void;
};

/**
 * Contextual sign-in gate: benefit copy, then Apple/Google one-tap as the
 * primary methods with email as the fallback — never a wall. The action that
 * triggered the gate is completed elsewhere (a persisted pending intent), so
 * this sheet only has to start auth and get out of the way.
 */
export const SignInSheet = forwardRef<BottomSheetModal, SignInSheetProps>(
  function SignInSheet({ title, body, onSuccess, onEmail, onCancel }, ref) {
    const t = useT();
    const [error, setError] = useState<string | null>(null);
    // Distinguishes a deliberate choice (auth/email) from a swipe-to-dismiss,
    // so picking "email" doesn't fire the cancel/dismissed path.
    const actionTakenRef = useRef(false);

    const dismiss = () => {
      if (ref && "current" in ref) {
        ref.current?.dismiss();
      }
    };

    const handleSuccess = () => {
      actionTakenRef.current = true;
      dismiss();
      onSuccess();
    };

    const handleEmail = () => {
      actionTakenRef.current = true;
      dismiss();
      onEmail();
    };

    const handleDismiss = () => {
      const acted = actionTakenRef.current;
      actionTakenRef.current = false;
      setError(null);
      if (!acted) {
        onCancel();
      }
    };

    return (
      <Sheet ref={ref} onDismiss={handleDismiss}>
        <Text className="text-lg font-semibold tracking-tight text-card-foreground">
          {title}
        </Text>
        <Text className="max-w-[455px] text-base leading-relaxed text-muted-foreground">
          {body}
        </Text>
        {error ? (
          <Text
            accessibilityLiveRegion="polite"
            className="text-sm text-destructive"
          >
            {error}
          </Text>
        ) : null}
        <AppleSignInButton onSuccess={handleSuccess} onError={setError} />
        <GoogleSignInButton onSuccess={handleSuccess} onError={setError} />
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel={t("gate.continueEmail")}
          onPress={handleEmail}
          contentClassName="min-h-11 items-center justify-center rounded-lg"
        >
          <Text className="text-sm font-medium text-muted-foreground">
            {t("gate.continueEmail")}
          </Text>
        </PressableScale>
      </Sheet>
    );
  },
);
