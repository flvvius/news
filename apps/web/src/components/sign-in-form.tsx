import { authClient } from "@/lib/auth-client";
import type { AuthRedirectPath } from "@/lib/auth-redirect";
import { useForm } from "@tanstack/react-form";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import z from "zod";
import { useState } from "react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Loader2, Mail } from "lucide-react";
import { AuthDivider, GoogleSignInButton } from "./auth-social";

function getVerificationCallbackURL(redirectTo: AuthRedirectPath) {
  const params = new URLSearchParams({
    mode: "signin",
    verified: "1",
    redirect: redirectTo,
  });
  return `/dashboard?${params.toString()}`;
}

export default function SignInForm({
  onSwitchToSignUp,
  initialEmail = "",
  emailLocked = false,
  redirectTo = "/dashboard",
  title = "Welcome Back",
  subtitle = "Sign in to your Biviant account",
  submitLabel = "Sign In",
  showGoogle = true,
}: {
  onSwitchToSignUp?: () => void;
  initialEmail?: string;
  emailLocked?: boolean;
  redirectTo?: AuthRedirectPath;
  title?: string;
  subtitle?: string;
  submitLabel?: string;
  showGoogle?: boolean;
}) {
  const navigate = useNavigate({
    from: "/",
  });
  const [isResendingVerification, setIsResendingVerification] = useState(false);
  const verificationCallbackURL = getVerificationCallbackURL(redirectTo);

  const form = useForm({
    defaultValues: {
      email: initialEmail,
      password: "",
    },
    onSubmit: async ({ value }) => {
      await authClient.signIn.email(
        {
          email: value.email,
          password: value.password,
          callbackURL: redirectTo,
        },
        {
          onSuccess: () => {
            navigate({ to: redirectTo as never });
            toast.success("Signed in");
          },
          onError: (error) => {
            const message = error.error.message || error.error.statusText;
            if (message.toLowerCase().includes("verify")) {
              toast.error(
                "Verify your email before signing in. You can resend it below.",
              );
              return;
            }
            toast.error(message);
          },
        }
      );
    },
    validators: {
      onSubmit: z.object({
        email: z.email("Invalid email address"),
        password: z.string().min(8, "Password must be at least 8 characters"),
      }),
    },
  });
  const emailValue = form.state.values.email.trim();
  const canResendVerification = z.email().safeParse(emailValue).success;

  const handleResendVerification = async () => {
    if (!canResendVerification || isResendingVerification) {
      return;
    }

    setIsResendingVerification(true);

    try {
      await authClient.sendVerificationEmail(
        {
          email: emailValue,
          callbackURL: verificationCallbackURL,
        },
        {
          onSuccess: () => {
            const isLocalDev =
              typeof window !== "undefined" &&
              ["localhost", "127.0.0.1"].includes(window.location.hostname);
            toast.success(
              isLocalDev
                ? "Verification email sent. If it doesn't arrive, use the verification link printed in the server logs."
                : "Verification email sent.",
            );
          },
          onError: (error) => {
            toast.error(
              error.error.message ||
                "We couldn't resend the verification email.",
            );
          },
        },
      );
    } finally {
      setIsResendingVerification(false);
    }
  };

  return (
    <Card className="border-border shadow-lg">
      <CardHeader className="text-center pb-2">
        <div className="flex items-center justify-center size-12 rounded-xl bg-primary/10 text-primary mx-auto mb-4">
          <Mail className="size-6" />
        </div>
        <CardTitle className="text-2xl font-bold">{title}</CardTitle>
        <p className="text-muted-foreground text-sm mt-1">
          {subtitle}
        </p>
      </CardHeader>

      <CardContent className="pt-6">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            e.stopPropagation();
            form.handleSubmit();
          }}
          className="space-y-4"
        >
          <div>
            <form.Field name="email">
              {(field) => (
                <div className="space-y-2">
                  <Label htmlFor={field.name}>Email</Label>
                  <Input
                    id={field.name}
                    name={field.name}
                    type="email"
                    placeholder="you@example.com"
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(e) => field.handleChange(e.target.value)}
                    className="h-11"
                    disabled={emailLocked}
                  />
                  {field.state.meta.errors.map((error, i) => (
                    <p key={i} className="text-destructive text-sm">
                      {error?.message}
                    </p>
                  ))}
                </div>
              )}
            </form.Field>
          </div>

          <div>
            <form.Field name="password">
              {(field) => (
                <div className="space-y-2">
                  <Label htmlFor={field.name}>Password</Label>
                  <Input
                    id={field.name}
                    name={field.name}
                    type="password"
                    placeholder="Enter your password"
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(e) => field.handleChange(e.target.value)}
                    className="h-11"
                  />
                  {field.state.meta.errors.map((error, i) => (
                    <p key={i} className="text-destructive text-sm">
                      {error?.message}
                    </p>
                  ))}
                </div>
              )}
            </form.Field>
          </div>

          <form.Subscribe>
            {(state) => (
              <Button
                type="submit"
                className="w-full h-11"
                disabled={!state.canSubmit || state.isSubmitting}
              >
                {state.isSubmitting ? (
                  <>
                    <Loader2 className="size-4 mr-2 animate-spin" />
                    Signing in...
                  </>
                ) : (
                  submitLabel
                )}
              </Button>
            )}
          </form.Subscribe>
        </form>

        <div className="mt-4 rounded-lg border border-border/70 bg-muted/35 px-4 py-3 text-sm">
          <p className="text-foreground">Didn&apos;t get the verification email?</p>
          <p className="mt-1 text-muted-foreground">
            Enter the same email address above and we&apos;ll send it again.
          </p>
          <Button
            type="button"
            variant="link"
            className="mt-2 h-auto px-0 text-sm"
            disabled={!canResendVerification || isResendingVerification}
            onClick={handleResendVerification}
          >
            {isResendingVerification ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                Sending verification email...
              </>
            ) : (
              "Resend verification email"
            )}
          </Button>
        </div>

        {showGoogle && (
          <>
            <AuthDivider />
            <GoogleSignInButton callbackURL={redirectTo} />
          </>
        )}

        {onSwitchToSignUp && (
          <div className="mt-6 text-center">
            <p className="text-sm text-muted-foreground">
              Need an account?{" "}
              <button
                type="button"
                onClick={onSwitchToSignUp}
                className="text-primary hover:underline font-medium"
              >
                Sign Up
              </button>
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
