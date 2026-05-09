import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useT } from "@/lib/i18n/LocaleContext";
import { getString } from "@/lib/i18n/strings";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useForm } from "@tanstack/react-form";
import { toast } from "sonner";
import { z } from "zod";

const searchSchema = z.object({
  token: z.string().optional(),
  error: z.string().optional(),
});

export const Route = createFileRoute("/reset-password")({
  validateSearch: searchSchema,
  head: ({ matches }) => {
    const locale =
      matches[0]?.context &&
      typeof matches[0].context === "object" &&
      "locale" in matches[0].context &&
      (matches[0].context.locale === "ro" || matches[0].context.locale === "en")
        ? matches[0].context.locale
        : "en";

    return {
      meta: [{ title: getString(locale, "reset.metaTitle") }],
    };
  },
  component: ResetPasswordRoute,
});

function ResetPasswordRoute() {
  const t = useT();
  const search = Route.useSearch();
  const token = search.token?.trim();
  const resetPasswordSchema = z
    .object({
      password: z.string().min(8, t("reset.passwordMin")),
      confirmPassword: z.string(),
    })
    .refine((value) => value.password === value.confirmPassword, {
      message: t("reset.passwordMismatch"),
      path: ["confirmPassword"],
    });

  const errorMessage = !search.error
    ? null
    : search.error === "INVALID_TOKEN"
      ? t("reset.invalidToken")
      : t("reset.verifyLink");

  const form = useForm({
    defaultValues: {
      password: "",
      confirmPassword: "",
    },
    validators: {
      onSubmit: resetPasswordSchema,
    },
    onSubmit: async ({ value }) => {
      if (!token) {
        toast.error(
          t("reset.invalidToast"),
        );
        return;
      }

      await authClient.resetPassword(
        {
          token,
          newPassword: value.password,
        },
        {
          onSuccess: () => {
            toast.success(t("reset.success"));
            window.location.assign("/dashboard?mode=signin");
          },
          onError: (error) => {
            const message = error.error.message || t("reset.error");
            toast.error(message);
          },
        },
      );
    },
  });

  return (
    <div className="min-h-[calc(100vh-4rem)] bg-background">
      <div className="container mx-auto flex max-w-xl px-4 py-10 sm:py-16">
        <Card className="w-full border-border shadow-lg">
          <CardHeader className="text-center pb-2">
            <CardTitle className="text-2xl font-bold">
              {t("reset.title")}
            </CardTitle>
            <p className="text-muted-foreground text-sm mt-1">
              {t("reset.body")}
            </p>
          </CardHeader>

          <CardContent className="pt-6">
            {errorMessage || !token ? (
              <div className="space-y-4 text-sm">
                <p
                  className="rounded-lg border border-border/70 bg-muted/35 px-4 py-3 text-muted-foreground"
                  role="status"
                  aria-live="polite"
                >
                  {errorMessage ||
                    t("reset.missingToken")}
                </p>
                <Button asChild className="w-full h-11">
                  <Link to="/dashboard" search={{ mode: "signin" }}>
                    {t("reset.backToSignIn")}
                  </Link>
                </Button>
              </div>
            ) : (
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  form.handleSubmit();
                }}
                className="space-y-4"
              >
                <div>
                  <form.Field name="password">
                    {(field) => (
                      <div className="space-y-2">
                        <Label htmlFor={field.name}>{t("reset.newPassword")}</Label>
                        <Input
                          id={field.name}
                          name={field.name}
                          type="password"
                          aria-label={t("reset.newPasswordAria")}
                          placeholder={t("reset.newPasswordPlaceholder")}
                          value={field.state.value}
                          onBlur={field.handleBlur}
                          onChange={(event) =>
                            field.handleChange(event.target.value)
                          }
                          className="h-11"
                        />
                        {field.state.meta.errors.map((error, index) => (
                          <p key={index} className="text-destructive text-sm">
                            {error?.message}
                          </p>
                        ))}
                      </div>
                    )}
                  </form.Field>
                </div>

                <div>
                  <form.Field name="confirmPassword">
                    {(field) => (
                      <div className="space-y-2">
                        <Label htmlFor={field.name}>
                          {t("reset.confirmPassword")}
                        </Label>
                        <Input
                          id={field.name}
                          name={field.name}
                          type="password"
                          aria-label={t("reset.confirmPasswordAria")}
                          placeholder={t("reset.confirmPasswordPlaceholder")}
                          value={field.state.value}
                          onBlur={field.handleBlur}
                          onChange={(event) =>
                            field.handleChange(event.target.value)
                          }
                          className="h-11"
                        />
                        {field.state.meta.errors.map((error, index) => (
                          <p key={index} className="text-destructive text-sm">
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
                      {state.isSubmitting
                        ? t("reset.updating")
                        : t("reset.submit")}
                    </Button>
                  )}
                </form.Subscribe>

                <div className="text-center text-sm text-muted-foreground">
                  <Link
                    to="/dashboard"
                    search={{ mode: "signin" }}
                    className="text-primary hover:underline font-medium"
                  >
                    {t("reset.backToSignIn")}
                  </Link>
                </div>
              </form>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
