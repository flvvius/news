import { Link } from "@tanstack/react-router";
import type { AuthRedirectPath } from "@/lib/auth-redirect";
import { useT } from "@/lib/i18n/LocaleContext";
import { Button } from "@/components/ui/button";

type SignInPromptProps = {
  title: string;
  description: string;
  redirectTo: AuthRedirectPath;
};

export function SignInPrompt({
  title,
  description,
  redirectTo,
}: SignInPromptProps) {
  const t = useT();

  return (
    <div className="bg-background">
      <div className="container mx-auto flex min-h-[calc(100vh-4rem)] max-w-4xl items-center px-4 py-10 sm:py-14">
        <div className="mx-auto w-full max-w-xl text-center">
          <h1 className="text-3xl font-semibold tracking-tight">{title}</h1>
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
