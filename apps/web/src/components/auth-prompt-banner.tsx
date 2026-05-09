import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import type { AuthRedirectPath } from "@/lib/auth-redirect";
import { useT } from "@/lib/i18n/LocaleContext";

type AuthPromptBannerProps = {
  redirectTo: AuthRedirectPath;
  title?: string;
  description?: string;
  compact?: boolean;
};

export default function AuthPromptBanner({
  redirectTo,
  title,
  description,
  compact = false,
}: AuthPromptBannerProps) {
  const t = useT();
  const resolvedTitle = title ?? t("auth.promptTitle");
  const resolvedDescription = description ?? t("auth.promptBody");

  return (
    <section className="rounded-[1.2rem] border border-border/70 bg-card/80 p-5 shadow-sm">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div className="space-y-1">
          <p className="text-sm font-semibold tracking-tight">{resolvedTitle}</p>
          <p className="max-w-[60ch] text-sm text-muted-foreground">
            {resolvedDescription}
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <Button asChild size={compact ? "sm" : "default"}>
            <Link to="/dashboard" search={{ mode: "signup", redirect: redirectTo }}>
              {t("auth.createAccount")}
            </Link>
          </Button>
          <Button asChild variant="ghost" size={compact ? "sm" : "default"}>
            <Link to="/dashboard" search={{ mode: "signin", redirect: redirectTo }}>
              {t("auth.signIn")}
            </Link>
          </Button>
        </div>
      </div>
    </section>
  );
}
