import SignInForm from "@/components/sign-in-form";
import SignUpForm from "@/components/sign-up-form";
import { PageLoadingState } from "@/components/ui/page-loading-state";
import { useT } from "@/lib/i18n/LocaleContext";
import { getString } from "@/lib/i18n/strings";
import { createFileRoute } from "@tanstack/react-router";
import { useConvexAuth } from "convex/react";
import { useEffect, useRef } from "react";
import { isAuthRedirectPath, type AuthRedirectPath } from "@/lib/auth-redirect";
import { toast } from "sonner";
import { z } from "zod";

const searchSchema = z.object({
  mode: z.enum(["signin", "signup"]).optional(),
  redirect: z.string().optional(),
  verified: z.union([z.string(), z.number()]).optional(),
});

export const Route = createFileRoute("/dashboard")({
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
      meta: [
        { title: getString(locale, "auth.metaTitle") },
        { name: "robots", content: "noindex, nofollow" },
      ],
    };
  },
  component: DashboardAuthPage,
});

function DashboardAuthPage() {
  const t = useT();
  const search = Route.useSearch();
  const { isAuthenticated, isLoading } = useConvexAuth();
  const redirectTo: AuthRedirectPath =
    search.redirect && isAuthRedirectPath(search.redirect)
      ? search.redirect
      : "/activitate";
  const hasShownVerifiedToastRef = useRef(false);
  const isVerified = String(search.verified) === "1";
  const showSignIn = search.mode !== "signup" || isVerified;

  useEffect(() => {
    if (isAuthenticated) {
      window.location.replace("/activitate");
    }
  }, [isAuthenticated]);

  const replaceDashboardSearch = (
    mode: "signin" | "signup",
    verified?: string | number,
  ) => {
    const params = new URLSearchParams();
    params.set("mode", mode);

    if (search.redirect) {
      params.set("redirect", search.redirect);
    }

    if (verified !== undefined) {
      params.set("verified", String(verified));
    }

    window.location.replace(`/dashboard?${params.toString()}`);
  };

  useEffect(() => {
    if (!isVerified || hasShownVerifiedToastRef.current) {
      return;
    }

    hasShownVerifiedToastRef.current = true;
    toast.message(t("auth.verifiedToast"));
    replaceDashboardSearch("signin");
  }, [isVerified, search.redirect, t]);

  if (isLoading || isAuthenticated) {
    return (
      <PageLoadingState
        title={t("activity.checking.title")}
        description={t("auth.accountIntro")}
        cardCount={2}
      />
    );
  }

  return (
    <div className="min-h-[calc(100vh-4rem)] bg-background">
      <div className="container mx-auto max-w-5xl px-4 py-10 sm:py-16">
        <div className="grid gap-10 lg:grid-cols-2 lg:gap-16">
          <div className="space-y-6">
            <div className="space-y-3">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">
                {t("auth.account")}
              </p>
              <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
                {showSignIn
                  ? t("auth.welcomeBack")
                  : t("auth.createFreeAccount")}
              </h1>
              <p className="max-w-[55ch] leading-relaxed text-muted-foreground">
                {t("auth.accountIntro")}
              </p>
            </div>

            <div className="w-full max-w-md">
              {showSignIn ? (
                <SignInForm
                  redirectTo={redirectTo}
                  title={t("auth.signInTitle")}
                  subtitle={t("auth.signInSubtitle")}
                  onSwitchToSignUp={() => {
                    replaceDashboardSearch("signup", search.verified);
                  }}
                />
              ) : (
                <SignUpForm
                  redirectTo={redirectTo}
                  title={t("auth.signUpTitle")}
                  subtitle={t("auth.signUpSubtitle")}
                  submitLabel={t("auth.createAccount")}
                  onSwitchToSignIn={() => {
                    replaceDashboardSearch("signin", search.verified);
                  }}
                />
              )}
            </div>
          </div>

          <div className="space-y-6">
            <div className="rounded-xl border border-border bg-card p-6">
              <h2 className="text-lg font-semibold">{t("auth.unlockTitle")}</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {t("auth.unlockBody")}
              </p>
              <ol className="mt-4 space-y-2 text-sm text-muted-foreground">
                <li className="flex gap-3">
                  <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium">
                    1
                  </span>
                  {t("auth.unlockOne")}
                </li>
                <li className="flex gap-3">
                  <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium">
                    2
                  </span>
                  {t("auth.unlockTwo")}
                </li>
                <li className="flex gap-3">
                  <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium">
                    3
                  </span>
                  {t("auth.unlockThree")}
                </li>
              </ol>
            </div>

            <div className="rounded-xl border border-border bg-card p-6">
              <h2 className="text-lg font-semibold">
                {t("auth.verificationTitle")}
              </h2>
              <p className="mt-2 text-sm text-muted-foreground">
                {t("auth.verificationBody")}
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
