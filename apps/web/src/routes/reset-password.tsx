import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useForm } from "@tanstack/react-form";
import { toast } from "sonner";
import { z } from "zod";

const searchSchema = z.object({
  token: z.string().optional(),
  error: z.string().optional(),
});

const resetPasswordSchema = z
  .object({
    password: z.string().min(8, "Password must be at least 8 characters"),
    confirmPassword: z.string(),
  })
  .refine((value) => value.password === value.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

function getResetErrorMessage(error?: string) {
  if (!error) return null;

  if (error === "INVALID_TOKEN") {
    return "This password reset link is invalid or has expired. Request a new one from the sign-in form.";
  }

  return "We couldn't verify this password reset link. Request a new one and try again.";
}

export const Route = createFileRoute("/reset-password")({
  validateSearch: searchSchema,
  head: () => ({
    meta: [{ title: "Reset Password — Biviant" }],
  }),
  component: ResetPasswordRoute,
});

function ResetPasswordRoute() {
  const search = Route.useSearch();
  const token = search.token?.trim();
  const errorMessage = getResetErrorMessage(search.error);

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
          "This password reset link is invalid or has expired. Request a new one and try again.",
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
            toast.success("Your password has been reset. You can sign in now.");
            window.location.assign("/dashboard?mode=signin");
          },
          onError: (error) => {
            const message =
              error.error.message ||
              "We couldn't reset your password. Request a new link and try again.";
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
              Reset your password
            </CardTitle>
            <p className="text-muted-foreground text-sm mt-1">
              Choose a new password for your Biviant account.
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
                    "This password reset link is missing a token. Request a new one from the sign-in form."}
                </p>
                <Button asChild className="w-full h-11">
                  <Link to="/dashboard" search={{ mode: "signin" }}>
                    Back to sign in
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
                        <Label htmlFor={field.name}>New password</Label>
                        <Input
                          id={field.name}
                          name={field.name}
                          type="password"
                          aria-label="New password"
                          placeholder="Create a new password"
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
                        <Label htmlFor={field.name}>Confirm new password</Label>
                        <Input
                          id={field.name}
                          name={field.name}
                          type="password"
                          aria-label="Confirm new password"
                          placeholder="Repeat your new password"
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
                        ? "Updating password..."
                        : "Reset password"}
                    </Button>
                  )}
                </form.Subscribe>

                <div className="text-center text-sm text-muted-foreground">
                  <Link
                    to="/dashboard"
                    search={{ mode: "signin" }}
                    className="text-primary hover:underline font-medium"
                  >
                    Back to sign in
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
