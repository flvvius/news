import SignInForm from "@/components/sign-in-form";
import SignUpForm from "@/components/sign-up-form";
import { PageLoadingState } from "@/components/ui/page-loading-state";
import { SectionTitle } from "@/components/ui/section-title";
import { getLocaleFromMatches } from "@/lib/i18n/getLocaleFromMatches";
import { useT } from "@/lib/i18n/LocaleContext";
import { getString } from "@/lib/i18n/strings";
import { api } from "@news-app/backend/convex/_generated/api";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useConvexAuth, useQuery } from "convex/react";
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
    const locale = getLocaleFromMatches(matches);

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
  const navigate = useNavigate({ from: "/dashboard" });
  const search = Route.useSearch();
  const { isAuthenticated, isLoading } = useConvexAuth();
  const currentUser = useQuery(
    api.user.getCurrentUser,
    isAuthenticated ? {} : "skip",
  );
  const redirectTo: AuthRedirectPath =
    search.redirect && isAuthRedirectPath(search.redirect)
      ? search.redirect
      : "/activitate";
  const hasShownVerifiedToastRef = useRef(false);
  const isVerified = String(search.verified) === "1";
  const showSignIn = search.mode !== "signup" || isVerified;

  useEffect(() => {
    if (currentUser) {
      void navigate({ to: redirectTo || "/activitate", replace: true });
    }
  }, [currentUser, navigate]);

  const replaceDashboardSearch = (
    mode: "signin" | "signup",
    verified?: string | number,
  ) => {
    return navigate({
      to: "/dashboard",
      replace: true,
      search: () => ({
        mode,
        redirect: search.redirect,
        ...(verified !== undefined ? { verified } : {}),
      }),
    });
  };

  useEffect(() => {
    if (!isVerified || hasShownVerifiedToastRef.current) {
      return;
    }

    hasShownVerifiedToastRef.current = true;
    toast.message(t("auth.verifiedToast"));
    void replaceDashboardSearch("signin");
  }, [isVerified, search.redirect, t, navigate]);

  if (isLoading || (isAuthenticated && currentUser === undefined)) {
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
              <p className="text-sm text-muted-foreground">
                {t("auth.account")}
              </p>
              <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
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

          {/* Supporting copy, not a sidebar of panels: hairline zones with the
              same rhythm as the rest of the app. */}
          <div className="lg:pt-2">
            <section className="border-t border-border pt-6">
              <SectionTitle>{t("auth.unlockTitle")}</SectionTitle>
              <p className="mt-1 max-w-[55ch] text-sm text-muted-foreground">
                {t("auth.unlockBody")}
              </p>
              <ol className="mt-4 space-y-3 text-sm text-muted-foreground">
                {[
                  t("auth.unlockOne"),
                  t("auth.unlockTwo"),
                  t("auth.unlockThree"),
                ].map((step, index) => (
                  <li key={index} className="flex gap-3">
                    <span className="shrink-0 tabular-nums text-muted-foreground">
                      {index + 1}.
                    </span>
                    <span className="min-w-0 flex-1">{step}</span>
                  </li>
                ))}
              </ol>
            </section>

            <section className="mt-8 border-t border-border pt-6">
              <SectionTitle>{t("auth.verificationTitle")}</SectionTitle>
              <p className="mt-1 max-w-[55ch] text-sm text-muted-foreground">
                {t("auth.verificationBody")}
              </p>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}
