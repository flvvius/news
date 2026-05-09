import SignInForm from "@/components/sign-in-form";
import SignUpForm from "@/components/sign-up-form";
import { PageLoadingState } from "@/components/ui/page-loading-state";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
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
  head: () => ({
    meta: [
      { title: "Cont — Biviant" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: DashboardAuthPage,
});

function DashboardAuthPage() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: "/dashboard" });
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
      void navigate({ to: "/activitate", replace: true });
    }
  }, [isAuthenticated, navigate]);

  useEffect(() => {
    if (!isVerified || hasShownVerifiedToastRef.current) {
      return;
    }

    hasShownVerifiedToastRef.current = true;
    toast.message("Dacă ți-ai verificat contul, te poți conecta acum.");
    void navigate({
      search: (current) => ({
        ...current,
        mode: "signin",
        verified: undefined,
      }),
      replace: true,
    });
  }, [isVerified, navigate]);

  if (isLoading || isAuthenticated) {
    return (
      <PageLoadingState
        title="Verificăm sesiunea"
        description="Pregătim accesul la contul tău."
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
                Cont Biviant
              </p>
              <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
                {showSignIn ? "Bine ai revenit" : "Creează un cont gratuit"}
              </h1>
              <p className="max-w-[55ch] leading-relaxed text-muted-foreground">
                Poți citi feed-ul fără cont. Conectarea îți oferă salvări
                sincronizate, preferințe personale și acces rapid la activitatea
                ta.
              </p>
            </div>

            <div className="w-full max-w-md">
              {showSignIn ? (
                <SignInForm
                  redirectTo={redirectTo}
                  title="Conectează-te în cont"
                  subtitle="Accesează salvările, preferințele și experiența ta personalizată."
                  onSwitchToSignUp={() => {
                    void navigate({
                      search: (current) => ({
                        ...current,
                        mode: "signup",
                      }),
                    });
                  }}
                />
              ) : (
                <SignUpForm
                  redirectTo={redirectTo}
                  title="Creează-ți contul"
                  subtitle="Contul gratuit deblochează salvările, feed-ul personalizat și notificările viitoare."
                  submitLabel="Creează cont"
                  onSwitchToSignIn={() => {
                    void navigate({
                      search: (current) => ({
                        ...current,
                        mode: "signin",
                      }),
                    });
                  }}
                />
              )}
            </div>
          </div>

          <div className="space-y-6">
            <div className="rounded-xl border border-border bg-card p-6">
              <h2 className="text-lg font-semibold">Ce deblochează contul</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Conținutul rămâne deschis. Contul adaugă doar funcții personale
                și persistente.
              </p>
              <ol className="mt-4 space-y-2 text-sm text-muted-foreground">
                <li className="flex gap-3">
                  <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium">
                    1
                  </span>
                  Salvezi articole și evenimente pentru mai târziu.
                </li>
                <li className="flex gap-3">
                  <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium">
                    2
                  </span>
                  Îți personalizezi experiența pe baza intereselor tale.
                </li>
                <li className="flex gap-3">
                  <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium">
                    3
                  </span>
                  Primești acces la notificări și funcții noi pe măsură ce apar.
                </li>
              </ol>
            </div>

            <div className="rounded-xl border border-border bg-card p-6">
              <h2 className="text-lg font-semibold">Verificarea contează</h2>
              <p className="mt-2 text-sm text-muted-foreground">
                Conturile create cu email și parolă necesită verificarea adresei
                înainte de prima conectare. Pentru autentificarea cu Google,
                verificarea furnizorului rămâne suficientă.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
