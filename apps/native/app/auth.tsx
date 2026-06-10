import { useRouter } from "expo-router";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";

import { AuthField } from "@/components/auth/auth-field";
import { SubmitButton } from "@/components/auth/submit-button";
import { Screen } from "@/components/screen";
import { Icon } from "@/components/ui/icon";
import { authClient } from "@/lib/auth-client";

type AuthMode = "signin" | "signup";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PASSWORD_MIN_LENGTH = 8;

type FieldErrors = {
  name?: string;
  email?: string;
  password?: string;
};

function describeAuthError(error: {
  error?: { code?: string; message?: string; statusText?: string };
}): string {
  const code = error.error?.code?.toUpperCase() ?? "";
  if (code.includes("INVALID_EMAIL_OR_PASSWORD")) {
    return "Invalid email or password.";
  }
  if (code.includes("EMAIL_NOT_VERIFIED")) {
    return "Please verify your email before signing in. Check your inbox for the verification link.";
  }
  if (code.includes("USER_ALREADY_EXISTS")) {
    return "An account with this email already exists. Try signing in instead.";
  }
  return (
    error.error?.message ??
    error.error?.statusText ??
    "Something went wrong. Please try again."
  );
}

export default function AuthScreen() {
  const router = useRouter();
  const [mode, setMode] = useState<AuthMode>("signin");
  const [verifyEmail, setVerifyEmail] = useState<string | null>(null);

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
          <Text className="text-2xl font-bold tracking-tight text-foreground">
            {verifyEmail
              ? "Verify your email"
              : mode === "signin"
                ? "Welcome back"
                : "Create your account"}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close"
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

            <Pressable
              accessibilityRole="button"
              accessibilityLabel={
                mode === "signin"
                  ? "Switch to sign up"
                  : "Switch to sign in"
              }
              onPress={() =>
                setMode((current) =>
                  current === "signin" ? "signup" : "signin",
                )
              }
              className="mt-6 min-h-11 items-center justify-center active:opacity-70"
            >
              <Text className="text-sm text-muted-foreground">
                {mode === "signin" ? (
                  <>
                    Need an account?{" "}
                    <Text className="font-medium text-primary">Sign up</Text>
                  </>
                ) : (
                  <>
                    Already have an account?{" "}
                    <Text className="font-medium text-primary">Sign in</Text>
                  </>
                )}
              </Text>
            </Pressable>
          </>
        )}
      </KeyboardAwareScrollView>
    </Screen>
  );
}

function SignInForm({ onSuccess }: { onSuccess: () => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async () => {
    const errors: FieldErrors = {};
    if (!EMAIL_PATTERN.test(email.trim())) {
      errors.email = "Enter a valid email address.";
    }
    if (password.length < PASSWORD_MIN_LENGTH) {
      errors.password = `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`;
    }
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;

    setIsLoading(true);
    setFormError(null);
    await authClient.signIn.email(
      { email: email.trim(), password },
      {
        onSuccess: () => {
          onSuccess();
        },
        onError: (error) => {
          setFormError(describeAuthError(error));
        },
        onFinished: () => {
          setIsLoading(false);
        },
      },
    );
  };

  return (
    <View className="gap-4">
      <Text className="text-sm leading-relaxed text-muted-foreground">
        Sign in to bookmark events and keep your reading balanced.
      </Text>

      {formError ? (
        <View
          accessibilityLiveRegion="polite"
          className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2.5"
        >
          <Text className="text-sm text-destructive">{formError}</Text>
        </View>
      ) : null}

      <AuthField
        label="Email"
        value={email}
        onChangeText={setEmail}
        placeholder="you@example.com"
        keyboardType="email-address"
        autoCapitalize="none"
        autoComplete="email"
        textContentType="emailAddress"
        editable={!isLoading}
        error={fieldErrors.email}
      />
      <AuthField
        label="Password"
        value={password}
        onChangeText={setPassword}
        placeholder="Your password"
        secureTextEntry
        autoCapitalize="none"
        autoComplete="current-password"
        textContentType="password"
        editable={!isLoading}
        onSubmitEditing={() => void handleSubmit()}
        returnKeyType="go"
        error={fieldErrors.password}
      />

      <SubmitButton
        label="Sign in"
        loadingLabel="Signing in…"
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
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async () => {
    const errors: FieldErrors = {};
    if (name.trim().length < 2) {
      errors.name = "Enter your name.";
    }
    if (!EMAIL_PATTERN.test(email.trim())) {
      errors.email = "Enter a valid email address.";
    }
    if (password.length < PASSWORD_MIN_LENGTH) {
      errors.password = `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`;
    }
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;

    setIsLoading(true);
    setFormError(null);
    const submittedEmail = email.trim();
    await authClient.signUp.email(
      { name: name.trim(), email: submittedEmail, password },
      {
        onSuccess: () => {
          // The server requires email verification before sign-in.
          onVerificationPending(submittedEmail);
        },
        onError: (error) => {
          setFormError(describeAuthError(error));
        },
        onFinished: () => {
          setIsLoading(false);
        },
      },
    );
  };

  return (
    <View className="gap-4">
      <Text className="text-sm leading-relaxed text-muted-foreground">
        Create an account to save events and track your bias balance.
      </Text>

      {formError ? (
        <View
          accessibilityLiveRegion="polite"
          className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2.5"
        >
          <Text className="text-sm text-destructive">{formError}</Text>
        </View>
      ) : null}

      <AuthField
        label="Name"
        value={name}
        onChangeText={setName}
        placeholder="Your name"
        autoComplete="name"
        textContentType="name"
        editable={!isLoading}
        error={fieldErrors.name}
      />
      <AuthField
        label="Email"
        value={email}
        onChangeText={setEmail}
        placeholder="you@example.com"
        keyboardType="email-address"
        autoCapitalize="none"
        autoComplete="email"
        textContentType="emailAddress"
        editable={!isLoading}
        error={fieldErrors.email}
      />
      <AuthField
        label="Password"
        value={password}
        onChangeText={setPassword}
        placeholder="At least 8 characters"
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
        label="Create account"
        loadingLabel="Creating account…"
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
  const [isResending, setIsResending] = useState(false);
  const [resendMessage, setResendMessage] = useState<string | null>(null);

  const handleResend = async () => {
    setIsResending(true);
    setResendMessage(null);
    try {
      await authClient.sendVerificationEmail({ email });
      setResendMessage("Verification email sent. Check your inbox.");
    } catch {
      setResendMessage("Couldn't resend the email. Please try again.");
    } finally {
      setIsResending(false);
    }
  };

  return (
    <View className="gap-4">
      <View className="items-center gap-3 rounded-xl border border-border bg-card px-5 py-8">
        <View className="size-14 items-center justify-center rounded-full bg-primary/10">
          <Icon name="mail-outline" size={26} className="text-primary" />
        </View>
        <Text className="text-center text-base font-semibold text-foreground">
          Check your inbox
        </Text>
        <Text className="max-w-[36ch] text-center text-sm leading-relaxed text-muted-foreground">
          We sent a verification link to {email}. Verify your email, then come
          back and sign in.
        </Text>
        {resendMessage ? (
          <Text
            accessibilityLiveRegion="polite"
            className="text-center text-sm text-muted-foreground"
          >
            {resendMessage}
          </Text>
        ) : null}
      </View>

      <SubmitButton
        label="Resend verification email"
        loadingLabel="Sending…"
        isLoading={isResending}
        onPress={() => void handleResend()}
      />

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Back to sign in"
        onPress={onBackToSignIn}
        className="min-h-11 items-center justify-center active:opacity-70"
      >
        <Text className="text-sm font-medium text-primary">Back to sign in</Text>
      </Pressable>
    </View>
  );
}
