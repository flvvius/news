import { authClient } from "@/lib/auth-client";
import type { AuthRedirectPath } from "@/lib/auth-redirect";
import { useForm } from "@tanstack/react-form";
import { useState } from "react";
import { toast } from "sonner";
import z from "zod";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Loader2, UserPlus } from "lucide-react";
import { AuthDivider, GoogleSignInButton } from "./auth-social";

function getVerificationCallbackURL(redirectTo: AuthRedirectPath) {
  const params = new URLSearchParams({
    mode: "signin",
    verified: "1",
    redirect: redirectTo,
  });
  return `/dashboard?${params.toString()}`;
}

export default function SignUpForm({
  onSwitchToSignIn,
  initialEmail = "",
  emailLocked = false,
  redirectTo = "/dashboard",
  title = "Create Account",
  subtitle = "Join Biviant and see the whole story",
  submitLabel = "Create Account",
  showGoogle = true,
}: {
  onSwitchToSignIn?: () => void;
  initialEmail?: string;
  emailLocked?: boolean;
  redirectTo?: AuthRedirectPath;
  title?: string;
  subtitle?: string;
  submitLabel?: string;
  showGoogle?: boolean;
}) {
  const verificationCallbackURL = getVerificationCallbackURL(redirectTo);
  const [submittedEmail, setSubmittedEmail] = useState(
    initialEmail.trim() || "",
  );
  const [isResendingVerification, setIsResendingVerification] = useState(false);

  const form = useForm({
    defaultValues: {
      email: initialEmail,
      password: "",
      name: "",
    },
    onSubmit: async ({ value }) => {
      await authClient.signUp.email(
        {
          email: value.email,
          password: value.password,
          name: value.name,
          callbackURL: verificationCallbackURL,
        },
        {
          onSuccess: () => {
            setSubmittedEmail(value.email.trim());
            const isLocalDev =
              typeof window !== "undefined" &&
              ["localhost", "127.0.0.1"].includes(window.location.hostname);
            toast.success(
              isLocalDev
                ? "Check your email to verify your account. If nothing arrives, use the verification link printed in the server logs."
                : "Check your email to verify your account.",
            );
            form.reset();
          },
          onError: (error) => {
            console.error(error);
            toast.error(error.error.message || "An unexpected error occurred. Please try again.");
          },
        }
      );
    },
    validators: {
      onSubmit: z.object({
        name: z.string().min(2, "Name must be at least 2 characters"),
        email: z.email("Invalid email address"),
        password: z.string().min(8, "Password must be at least 8 characters"),
      }),
    },
  });

  return (
    <Card className="border-border shadow-lg">
      <CardHeader className="text-center pb-2">
        <div className="flex items-center justify-center size-12 rounded-xl bg-primary/10 text-primary mx-auto mb-4">
          <UserPlus className="size-6" />
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
            <form.Field name="name">
              {(field) => (
                <div className="space-y-2">
                  <Label htmlFor={field.name}>Name</Label>
                  <Input
                    id={field.name}
                    name={field.name}
                    placeholder="Your name"
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
                    placeholder="Create a password"
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
                    Creating account...
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
            <GoogleSignInButton
              callbackURL={redirectTo}
            />
          </>
        )}

        {submittedEmail && (
          <div className="mt-6 rounded-xl border border-border/70 bg-muted/35 px-4 py-3">
            <p className="text-sm text-muted-foreground">
              Didn&apos;t receive the email? Check spam, then resend the
              verification link to <span className="font-medium text-foreground">{submittedEmail}</span>.
            </p>
            <button
              type="button"
              className="mt-3 text-sm font-medium text-primary hover:underline disabled:cursor-not-allowed disabled:opacity-60"
              disabled={isResendingVerification}
              onClick={async () => {
                setIsResendingVerification(true);
                try {
                  const response = await fetch(
                    "/api/auth/send-verification-email",
                    {
                      method: "POST",
                      headers: {
                        "content-type": "application/json",
                      },
                      body: JSON.stringify({
                        email: submittedEmail,
                        callbackURL: verificationCallbackURL,
                      }),
                    },
                  );
                  const payload = (await response
                    .json()
                    .catch(() => null)) as { message?: string } | null;

                  if (!response.ok) {
                    throw new Error(
                      payload?.message ||
                        "We couldn't resend the verification email. Please try again.",
                    );
                  }

                  toast.success(
                    "Verification email sent. Check your inbox for the new link.",
                  );
                } catch (error) {
                  toast.error(
                    error instanceof Error
                      ? error.message
                      : "We couldn't resend the verification email. Please try again.",
                  );
                } finally {
                  setIsResendingVerification(false);
                }
              }}
            >
              {isResendingVerification
                ? "Sending verification email..."
                : "Resend verification email"}
            </button>
          </div>
        )}

        {onSwitchToSignIn && (
          <div className="mt-6 text-center">
            <p className="text-sm text-muted-foreground">
              Already have an account?{" "}
              <button
                type="button"
                onClick={onSwitchToSignIn}
                className="text-primary hover:underline font-medium"
              >
                Sign In
              </button>
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
