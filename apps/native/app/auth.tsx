import { useRouter } from "expo-router";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";

import { AppleSignInButton } from "@/components/auth/apple-sign-in-button";
import { AuthField } from "@/components/auth/auth-field";
import {
  AuthDivider,
  GoogleSignInButton,
} from "@/components/auth/google-sign-in-button";
import { SubmitButton } from "@/components/auth/submit-button";
import { Screen } from "@/components/screen";
import { Icon } from "@/components/ui/icon";
import { useT } from "@/contexts/locale-context";
import { authClient } from "@/lib/auth-client";
import { cn } from "@/lib/cn";
import { SITE_URL } from "@/lib/site";

type AuthMode = "signin" | "signup";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PASSWORD_MIN_LENGTH = 8;

type FieldErrors = {
  name?: string;
  email?: string;
  password?: string;
};

type Translate = ReturnType<typeof useT>;

function describeAuthError(
  t: Translate,
  error: {
    error?: { code?: string; message?: string; statusText?: string };
  },
): string {
  const code = error.error?.code?.toUpperCase() ?? "";
  if (code.includes("INVALID_EMAIL_OR_PASSWORD")) {
    return t("auth.invalidCredentials");
  }
  if (code.includes("EMAIL_NOT_VERIFIED")) {
    return t("auth.checkEmailVerify");
  }
  if (code.includes("USER_ALREADY_EXISTS")) {
    return t("auth.emailInUse");
  }
  return (
    error.error?.message ??
    error.error?.statusText ??
    t("auth.unexpectedError")
  );
}

export default function AuthScreen() {
  const router = useRouter();
  const t = useT();
  const [mode, setMode] = useState<AuthMode>("signin");
  const [verifyEmail, setVerifyEmail] = useState<string | null>(null);
  const [socialError, setSocialError] = useState<string | null>(null);

  const close = () => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace("/");
    }
  };

  return (
    <Screen withTopInset={false}>
      <KeyboardAwareScrollView
        className="flex-1"
        contentContainerClassName="px-6 pb-10 pt-6"
        keyboardShouldPersistTaps="handled"
      >
        <View className="mb-6 flex-row items-center justify-between">
          <Text className="text-3xl font-semibold tracking-tight text-foreground">
            {verifyEmail
              ? t("native.auth.verifyTitle")
              : mode === "signin"
                ? t("auth.welcomeBack")
                : t("auth.signUpTitle")}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("native.auth.close")}
            onPress={close}
            hitSlop={8}
            className="size-11 items-center justify-center rounded-full active:bg-accent"
          >
            <Icon name="close-outline" size={22} className="text-foreground" />
          </Pressable>
        </View>

        {verifyEmail ? (
          <VerifyEmailNotice
            email={verifyEmail}
            onBackToSignIn={() => {
              setVerifyEmail(null);
              setMode("signin");
            }}
          />
        ) : (
          <>
            {mode === "signin" ? (
              <SignInForm onSuccess={close} />
            ) : (
              <SignUpForm onVerificationPending={setVerifyEmail} />
            )}

            <View className="mt-6 gap-4">
              <AuthDivider />
              {socialError ? (
                <Text
                  accessibilityLiveRegion="polite"
                  className="text-sm text-destructive"
                >
                  {socialError}
                </Text>
              ) : null}
              {/* Apple first on iOS per platform convention; renders null
                  where native Sign in with Apple is unavailable. */}
              <AppleSignInButton onSuccess={close} onError={setSocialError} />
              <GoogleSignInButton onSuccess={close} onError={setSocialError} />
            </View>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel={
                mode === "signin"
                  ? t("native.auth.switchToSignUp")
                  : t("native.auth.switchToSignIn")
              }
              onPress={() => {
                setSocialError(null);
                setMode((current) =>
                  current === "signin" ? "signup" : "signin",
                );
              }}
              className="mt-6 min-h-11 items-center justify-center active:opacity-70"
            >
              <Text className="text-sm font-medium text-primary">
                {mode === "signin"
                  ? t("native.auth.switchToSignUp")
                  : t("native.auth.switchToSignIn")}
              </Text>
            </Pressable>

            {/* Guest browsing stays prominent — sign-in unlocks bookmarks
                and personalization; it is never a wall. */}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("native.auth.continueAsGuest")}
              onPress={close}
              className="mt-1 min-h-11 items-center justify-center active:opacity-70"
            >
              <Text className="text-sm font-medium text-muted-foreground">
                {t("native.auth.continueAsGuest")}
              </Text>
            </Pressable>
          </>
        )}
      </KeyboardAwareScrollView>
    </Screen>
  );
}

function SignInForm({ onSuccess }: { onSuccess: () => void }) {
  const t = useT();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSendingReset, setIsSendingReset] = useState(false);
  const [resetMessage, setResetMessage] = useState<string | null>(null);

  const handleSubmit = async () => {
    const errors: FieldErrors = {};
    if (!EMAIL_PATTERN.test(email.trim())) {
      errors.email = t("auth.invalidEmail");
    }
    if (password.length < PASSWORD_MIN_LENGTH) {
      errors.password = t("auth.passwordMin");
    }
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;

    setIsLoading(true);
    setFormError(null);
    try {
      const { error } = await authClient.signIn.email({
        email: email.trim(),
        password,
      });
      if (error) {
        setFormError(describeAuthError(t, { error }));
        return;
      }
      onSuccess();
    } catch {
      setFormError(t("auth.unexpectedError"));
    } finally {
      setIsLoading(false);
    }
  };

  const handleForgotPassword = async () => {
    if (isSendingReset || isLoading) return;
    if (!EMAIL_PATTERN.test(email.trim())) {
      setResetMessage(t("auth.resetEmailFirst"));
      return;
    }
    setIsSendingReset(true);
    setResetMessage(null);
    try {
      // The reset link in the email opens the web reset page; after setting a
      // new password there, the user signs in here.
      const { error } = await authClient.requestPasswordReset({
        email: email.trim(),
        redirectTo: `${SITE_URL}/reset-password`,
      });
      setResetMessage(
        error ? t("auth.resetLinkFailed") : t("auth.resetLinkSent"),
      );
    } catch {
      setResetMessage(t("auth.resetLinkFailed"));
    } finally {
      setIsSendingReset(false);
    }
  };

  return (
    <View className="gap-4">
      <Text className="text-sm leading-relaxed text-muted-foreground">
        {t("native.auth.signInBody")}
      </Text>

      {formError ? (
        <Text
          accessibilityLiveRegion="polite"
          className="text-sm text-destructive"
        >
          {formError}
        </Text>
      ) : null}

      <AuthField
        label={t("auth.email")}
        value={email}
        onChangeText={setEmail}
        placeholder={t("auth.emailPlaceholder")}
        keyboardType="email-address"
        autoCapitalize="none"
        autoComplete="email"
        textContentType="emailAddress"
        editable={!isLoading}
        error={fieldErrors.email}
      />
      <AuthField
        label={t("auth.password")}
        value={password}
        onChangeText={setPassword}
        placeholder={t("auth.passwordPlaceholder")}
        secureTextEntry
        autoCapitalize="none"
        autoComplete="current-password"
        textContentType="password"
        editable={!isLoading}
        onSubmitEditing={() => void handleSubmit()}
        returnKeyType="go"
        error={fieldErrors.password}
      />

      <View className="items-end">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("auth.forgotPassword")}
          onPress={() => void handleForgotPassword()}
          disabled={isSendingReset}
          className={cn(
            "min-h-11 justify-center active:opacity-70",
            isSendingReset && "opacity-70",
          )}
        >
          <Text className="text-sm font-medium text-primary">
            {isSendingReset ? t("auth.sending") : t("auth.forgotPassword")}
          </Text>
        </Pressable>
        {resetMessage ? (
          <Text
            accessibilityLiveRegion="polite"
            className="text-right text-sm text-muted-foreground"
          >
            {resetMessage}
          </Text>
        ) : null}
      </View>

      <SubmitButton
        label={t("auth.signIn")}
        loadingLabel={t("native.auth.signingIn")}
        isLoading={isLoading}
        onPress={() => void handleSubmit()}
      />
    </View>
  );
}

function SignUpForm({
  onVerificationPending,
}: {
  onVerificationPending: (email: string) => void;
}) {
  const t = useT();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async () => {
    const errors: FieldErrors = {};
    if (name.trim().length < 2) {
      errors.name = t("auth.nameMin");
    }
    if (!EMAIL_PATTERN.test(email.trim())) {
      errors.email = t("auth.invalidEmail");
    }
    if (password.length < PASSWORD_MIN_LENGTH) {
      errors.password = t("auth.passwordMin");
    }
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;

    setIsLoading(true);
    setFormError(null);
    const submittedEmail = email.trim();
    try {
      const { error } = await authClient.signUp.email({
        name: name.trim(),
        email: submittedEmail,
        password,
      });
      if (error) {
        setFormError(describeAuthError(t, { error }));
        return;
      }
      // The server requires email verification before sign-in. Note: for an
      // email that already has an account the server intentionally returns
      // success without sending anything (enumeration protection) — the
      // verify screen copy covers that case.
      onVerificationPending(submittedEmail);
    } catch {
      setFormError(t("auth.unexpectedError"));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <View className="gap-4">
      <Text className="text-sm leading-relaxed text-muted-foreground">
        {t("native.auth.signUpBody")}
      </Text>

      {formError ? (
        <Text
          accessibilityLiveRegion="polite"
          className="text-sm text-destructive"
        >
          {formError}
        </Text>
      ) : null}

      <AuthField
        label={t("auth.name")}
        value={name}
        onChangeText={setName}
        placeholder={t("auth.namePlaceholder")}
        autoComplete="name"
        textContentType="name"
        editable={!isLoading}
        error={fieldErrors.name}
      />
      <AuthField
        label={t("auth.email")}
        value={email}
        onChangeText={setEmail}
        placeholder={t("auth.emailPlaceholder")}
        keyboardType="email-address"
        autoCapitalize="none"
        autoComplete="email"
        textContentType="emailAddress"
        editable={!isLoading}
        error={fieldErrors.email}
      />
      <AuthField
        label={t("auth.password")}
        value={password}
        onChangeText={setPassword}
        placeholder={t("auth.passwordCreatePlaceholder")}
        secureTextEntry
        autoCapitalize="none"
        autoComplete="new-password"
        textContentType="newPassword"
        editable={!isLoading}
        onSubmitEditing={() => void handleSubmit()}
        returnKeyType="go"
        error={fieldErrors.password}
      />

      <SubmitButton
        label={t("auth.signUp")}
        loadingLabel={t("native.auth.creatingAccount")}
        isLoading={isLoading}
        onPress={() => void handleSubmit()}
      />
    </View>
  );
}

function VerifyEmailNotice({
  email,
  onBackToSignIn,
}: {
  email: string;
  onBackToSignIn: () => void;
}) {
  const t = useT();
  const [isResending, setIsResending] = useState(false);
  const [resendMessage, setResendMessage] = useState<string | null>(null);

  const handleResend = async () => {
    setIsResending(true);
    setResendMessage(null);
    try {
      await authClient.sendVerificationEmail({ email });
      setResendMessage(t("auth.verifyResent"));
    } catch {
      setResendMessage(t("auth.verifyResendFailed"));
    } finally {
      setIsResending(false);
    }
  };

  return (
    <View className="gap-4">
      {/* Typographic notice — no card costume, no icon mascot. */}
      <View className="gap-2">
        <Text className="text-base font-semibold text-foreground">
          {t("native.auth.verifyInboxTitle")}
        </Text>
        <Text className="max-w-[455px] text-sm leading-relaxed text-muted-foreground">
          {t("native.auth.verifyBody").replace("{email}", email)}
        </Text>
        {resendMessage ? (
          <Text
            accessibilityLiveRegion="polite"
            className="text-sm text-muted-foreground"
          >
            {resendMessage}
          </Text>
        ) : null}
      </View>

      <SubmitButton
        label={t("auth.verifyResend")}
        loadingLabel={t("auth.verifyResending")}
        isLoading={isResending}
        onPress={() => void handleResend()}
      />

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t("native.auth.backToSignIn")}
        onPress={onBackToSignIn}
        className="min-h-11 items-center justify-center active:opacity-70"
      >
        <Text className="text-sm font-medium text-primary">
          {t("native.auth.backToSignIn")}
        </Text>
      </Pressable>
    </View>
  );
}
