import { authClient } from "@/lib/auth-client";
import type { AuthRedirectPath } from "@/lib/auth-redirect";
import { useForm } from "@tanstack/react-form";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import z from "zod";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Loader2, Mail } from "lucide-react";
import { AuthDivider, GoogleSignInButton } from "./auth-social";

function getPasswordResetRedirectURL() {
  if (typeof window === "undefined") {
    return `${redirectFallbackOrigin}/reset-password`;
  }
  return `${window.location.origin}/reset-password`;
}

const redirectFallbackOrigin = "http://localhost:3001";

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
  const [isSendingReset, setIsSendingReset] = useState(false);

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
        },
        {
          onSuccess: () => {
            navigate({ to: redirectTo as never });
            toast.success("Signed in");
          },
          onError: (error) => {
            toast.error(
              error.error?.message ??
                error.error?.statusText ??
                "Sign-in failed. Please try again.",
            );
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
                  <div className="flex items-center justify-between gap-3">
                    <Label htmlFor={field.name}>Password</Label>
                    <button
                      type="button"
                      className="text-xs font-medium text-primary hover:underline disabled:cursor-not-allowed disabled:opacity-60"
                      disabled={isSendingReset}
                      onClick={async () => {
                        const email = form.getFieldValue("email").trim();
                        const parsedEmail = z.email().safeParse(email);

                        if (!parsedEmail.success) {
                          toast.error(
                            "Enter your email address first so we know where to send the reset link.",
                          );
                          return;
                        }

                        setIsSendingReset(true);
                        try {
                          const response = await fetch(
                            "/api/auth/request-password-reset",
                            {
                              method: "POST",
                              headers: {
                                "content-type": "application/json",
                              },
                              body: JSON.stringify({
                                email,
                                redirectTo: getPasswordResetRedirectURL(),
                              }),
                            },
                          );
                          const payload = (await response.json().catch(() => null)) as
                            | { message?: string }
                            | null;

                          if (!response.ok) {
                            throw new Error(
                              payload?.message ||
                                "We couldn't send a reset link. Please try again.",
                            );
                          }

                          toast.success(
                            payload?.message ||
                              "If that email exists, we sent a password reset link.",
                          );
                        } catch (error) {
                          toast.error(
                            error instanceof Error
                              ? error.message
                              : "We couldn't send a reset link. Please try again.",
                          );
                        } finally {
                          setIsSendingReset(false);
                        }
                      }}
                    >
                      {isSendingReset ? "Sending..." : "Forgot password?"}
                    </button>
                  </div>
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
