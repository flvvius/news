import { Link } from "@tanstack/react-router";
import { ThemePicker } from "@/components/theme/ThemePicker";
import { useT } from "@/lib/i18n/LocaleContext";
import { Button } from "@/components/ui/button";
import { SectionTitle } from "@/components/ui/section-title";

/**
 * Guest profile. Same editorial-calm rules as the signed-in one: a single
 * column, zone titles over hairlines, no card chrome. Sign-in is offered as a
 * plain list of what an account adds, not as a marketing panel.
 */
export function AnonymousProfile() {
  const t = useT();

  return (
    <div className="bg-background">
      <div className="container mx-auto max-w-2xl px-4 py-8 sm:py-12">
        <header className="space-y-3">
          <p className="text-sm text-muted-foreground">{t("tabs.profile")}</p>
          <h1 className="text-3xl font-semibold tracking-tight text-foreground">
            {t("profile.account")}
          </h1>
          <p className="max-w-[55ch] text-sm leading-relaxed text-muted-foreground">
            {t("profile.signInBody")}
          </p>
        </header>

        <section className="mt-10 border-t border-border pt-6">
          <SectionTitle>
            {t("auth.unlockTitle")}
          </SectionTitle>
          <dl className="mt-4 space-y-4">
            <div>
              <dt className="text-sm font-medium text-foreground">
                {t("profile.changePassword")}
              </dt>
              <dd className="mt-1 max-w-[55ch] text-sm text-muted-foreground">
                {t("profile.passwordBody")}
              </dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-foreground">
                {t("profile.security")}
              </dt>
              <dd className="mt-1 max-w-[55ch] text-sm text-muted-foreground">
                {t("profile.securityBody")}
              </dd>
            </div>
          </dl>
          <div className="mt-6 flex flex-wrap gap-3">
            <Button asChild>
              <Link to="/dashboard" search={{ mode: "signup" }}>
                {t("auth.signUp")}
              </Link>
            </Button>
            <Button asChild variant="outline">
              <Link to="/dashboard" search={{ mode: "signin" }}>
                {t("auth.signIn")}
              </Link>
            </Button>
          </div>
        </section>

        <section className="mt-10 border-t border-border pt-6">
          <SectionTitle>
            {t("profile.settings")}
          </SectionTitle>
          <div className="mt-5 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-1">
              <p className="text-sm font-medium text-foreground">
                {t("profile.theme")}
              </p>
              <p className="max-w-[55ch] text-sm text-muted-foreground">
                {t("profile.themeBody")}
              </p>
            </div>
            <ThemePicker />
          </div>
        </section>
      </div>
    </div>
  );
}
