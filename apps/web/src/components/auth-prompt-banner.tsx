import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import type { AuthRedirectPath } from "@/lib/auth-redirect";

type AuthPromptBannerProps = {
  redirectTo: AuthRedirectPath;
  title?: string;
  description?: string;
  compact?: boolean;
};

export default function AuthPromptBanner({
  redirectTo,
  title = "Creează un cont gratuit ca să salvezi și să personalizezi știrile",
  description = "Poți citi fără cont. Autentificarea adaugă salvări, recomandări personale și funcții viitoare.",
  compact = false,
}: AuthPromptBannerProps) {
  return (
    <section className="rounded-[1.2rem] border border-border/70 bg-card/80 p-5 shadow-sm">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div className="space-y-1">
          <p className="text-sm font-semibold tracking-tight">{title}</p>
          <p className="max-w-[60ch] text-sm text-muted-foreground">
            {description}
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <Button asChild size={compact ? "sm" : "default"}>
            <Link to="/dashboard" search={{ mode: "signup", redirect: redirectTo }}>
              Creează cont
            </Link>
          </Button>
          <Button asChild variant="ghost" size={compact ? "sm" : "default"}>
            <Link to="/dashboard" search={{ mode: "signin", redirect: redirectTo }}>
              Conectare
            </Link>
          </Button>
        </div>
      </div>
    </section>
  );
}
