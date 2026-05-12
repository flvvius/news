import { authClient } from "@/lib/auth-client";
import type { AuthRedirectPath } from "@/lib/auth-redirect";
import { useForm } from "@tanstack/react-form";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import z from "zod";
import { useT } from "@/lib/i18n/LocaleContext";
import { absoluteSiteUrl } from "@/lib/seo";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Loader2, Mail } from "lucide-react";
import { AuthDivider, GoogleSignInButton } from "./auth-social";

function getPasswordResetRedirectURL() {
  if (typeof window === "undefined") {
    return absoluteSiteUrl("/reset-password");
  }
  return new URL("/reset-password", window.location.origin).toString();
}

function normalizeErrorCode(code: string | undefined) {
  return code?.trim().toLowerCase().replace(/[\s-]+/g, "_") ?? "";
}

function getLocalizedSignInError(
  t: ReturnType<typeof useT>,
  error: {
    error?: {
      code?: string;
      message?: string;
      statusText?: string;
    };
  },
) {
  const code = normalizeErrorCode(error.error?.code);

  if (["invalid_credentials", "invalid_password", "invalid_login"].includes(code)) {
    return t("auth.invalidCredentials");
  }

  return (
    error.error?.message ??
    error.error?.statusText ??
    t("auth.signInError")
  );
}

export default function SignInForm({
  onSwitchToSignUp,
  initialEmail = "",
  emailLocked = false,
  redirectTo = "/activitate",
  title,
  subtitle,
  submitLabel,
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
  const t = useT();
  const navigate = useNavigate({
    from: "/",
  });
  const [isSendingReset, setIsSendingReset] = useState(false);
  const [resetStatusMessage, setResetStatusMessage] = useState("");
  const resolvedTitle = title ?? t("auth.signInTitle");
  const resolvedSubtitle = subtitle ?? t("auth.signInSubtitle");
  const resolvedSubmitLabel = submitLabel ?? t("auth.signIn");

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
            toast.success(t("auth.signInSuccess"));
          },
          onError: (error: Parameters<typeof getLocalizedSignInError>[1]) => {
            toast.error(getLocalizedSignInError(t, error));
          },
        }
      );
    },
    validators: {
      onSubmit: z.object({
        email: z.email(t("auth.invalidEmail")),
        password: z.string().min(8, t("auth.passwordMin")),
      }),
    },
  });

  return (
    <Card className="border-border shadow-lg">
      <CardHeader className="text-center pb-2">
        <div className="flex items-center justify-center size-12 rounded-xl bg-primary/10 text-primary mx-auto mb-4">
          <Mail className="size-6" />
        </div>
        <CardTitle className="text-2xl font-bold">{resolvedTitle}</CardTitle>
        <p className="text-muted-foreground text-sm mt-1">
          {resolvedSubtitle}
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
                  <Label htmlFor={field.name}>{t("auth.email")}</Label>
                  <Input
                    id={field.name}
                    name={field.name}
                    type="email"
                    aria-label={t("auth.email")}
                    placeholder={t("auth.emailPlaceholder")}
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
                    <Label htmlFor={field.name}>{t("auth.password")}</Label>
                    <button
                      type="button"
                      className="text-xs font-medium text-primary hover:underline disabled:cursor-not-allowed disabled:opacity-60"
                      disabled={isSendingReset}
                      onClick={async () => {
                        const email = form.getFieldValue("email").trim();
                        const parsedEmail = z.email().safeParse(email);

                        if (!parsedEmail.success) {
                          setResetStatusMessage(
                            t("auth.resetEmailFirst"),
                          );
                          toast.error(
                            t("auth.resetEmailFirst"),
                          );
                          return;
                        }

                        setResetStatusMessage("");
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
                                t("auth.resetLinkFailed"),
                            );
                          }

                          setResetStatusMessage(
                            payload?.message ||
                              t("auth.resetLinkSent"),
                          );
                          toast.success(
                            payload?.message ||
                              t("auth.resetLinkSent"),
                          );
                        } catch (error) {
                          setResetStatusMessage(
                            error instanceof Error
                              ? error.message
                              : t("auth.resetLinkFailed"),
                          );
                          toast.error(
                            error instanceof Error
                              ? error.message
                              : t("auth.resetLinkFailed"),
                          );
                        } finally {
                          setIsSendingReset(false);
                        }
                      }}
                    >
                      {isSendingReset ? t("auth.sending") : t("auth.forgotPassword")}
                    </button>
                    <div aria-live="polite" role="status" className="sr-only">
                      {isSendingReset
                        ? t("auth.resetSendingStatus")
                        : resetStatusMessage}
                    </div>
                  </div>
                  <Input
                    id={field.name}
                    name={field.name}
                    type="password"
                    aria-label={t("auth.password")}
                    placeholder={t("auth.passwordPlaceholder")}
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
                    {t("auth.signingIn")}
                  </>
                ) : (
                  resolvedSubmitLabel
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
              {t("auth.needAccount")}{" "}
              <button
                type="button"
                onClick={onSwitchToSignUp}
                className="text-primary hover:underline font-medium"
              >
                {t("auth.signUp")}
              </button>
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
