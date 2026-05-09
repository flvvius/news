import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import type { AuthRedirectPath } from "@/lib/auth-redirect";
import { useT } from "@/lib/i18n/LocaleContext";
import { Button } from "@/components/ui/button";

type SignInPromptProps = {
  title: string;
  description: string;
  redirectTo: AuthRedirectPath;
  illustration?: ReactNode;
};

export function SignInPrompt({
  title,
  description,
  redirectTo,
  illustration,
}: SignInPromptProps) {
  const t = useT();

  return (
    <div className="bg-gradient-to-b from-background via-background to-muted/35">
      <div className="container mx-auto flex min-h-[calc(100vh-4rem)] max-w-4xl items-center px-4 py-10 sm:py-14">
        <div className="mx-auto w-full max-w-xl rounded-[1.75rem] border border-border/70 bg-card/80 p-8 text-center shadow-sm sm:p-10">
          {illustration ? (
            <div className="mb-6 flex justify-center">{illustration}</div>
          ) : null}
          <h1 className="text-3xl font-bold tracking-tight">{title}</h1>
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground sm:text-base">
            {description}
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:justify-center">
            <Button asChild size="lg" className="sm:min-w-56">
              <Link to="/dashboard" search={{ mode: "signup", redirect: redirectTo }}>
                {t("auth.signUp")}
              </Link>
            </Button>
            <Button asChild size="lg" variant="outline" className="sm:min-w-44">
              <Link to="/dashboard" search={{ mode: "signin", redirect: redirectTo }}>
                {t("auth.signIn")}
              </Link>
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
