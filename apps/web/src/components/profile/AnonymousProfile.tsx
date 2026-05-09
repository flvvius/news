import { BarChart3, Bookmark, Scale, Sparkles } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { useT } from "@/lib/i18n/LocaleContext";
import { Button } from "@/components/ui/button";

const features = [
  {
    titleKey: "profile.feature.bias",
    descriptionKey: "profile.feature.biasBody",
    icon: Scale,
  },
  {
    titleKey: "profile.feature.compare",
    descriptionKey: "profile.feature.compareBody",
    icon: BarChart3,
  },
  {
    titleKey: "profile.feature.facts",
    descriptionKey: "profile.feature.factsBody",
    icon: Sparkles,
  },
] as const;

export function AnonymousProfile() {
  const t = useT();

  return (
    <div className="bg-gradient-to-b from-background via-background to-muted/30">
      <div className="container mx-auto max-w-5xl px-4 py-10 sm:py-14">
        <div className="space-y-8">
          <section className="overflow-hidden rounded-[1.75rem] border border-border/70 bg-card/80 p-6 shadow-sm sm:p-8">
            <div className="max-w-2xl space-y-4">
              <p className="text-sm font-semibold uppercase tracking-[0.24em] text-primary">
                {t("tabs.profile")}
              </p>
              <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
                {t("profile.hero")}
              </h1>
              <p className="text-base leading-relaxed text-muted-foreground">
                {t("profile.heroBody")}
              </p>
            </div>

            <div className="mt-6 flex flex-col gap-3 sm:flex-row">
              <Button asChild size="lg" className="sm:min-w-56">
                <Link to="/dashboard" search={{ mode: "signup" }}>
                  {t("auth.signUp")}
                </Link>
              </Button>
              <Button asChild size="lg" variant="outline" className="sm:min-w-44">
                <Link to="/dashboard" search={{ mode: "signin" }}>
                  {t("auth.signIn")}
                </Link>
              </Button>
            </div>
          </section>

          <section className="grid gap-4 md:grid-cols-3">
            {features.map(({ titleKey, descriptionKey, icon: Icon }) => (
              <article
                key={titleKey}
                className="rounded-[1.5rem] border border-border/70 bg-card/80 p-5 shadow-sm"
              >
                <div className="flex size-11 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                  <Icon className="size-5" />
                </div>
                <h2 className="mt-4 text-lg font-semibold">{t(titleKey)}</h2>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  {t(descriptionKey)}
                </p>
              </article>
            ))}
          </section>

          <section className="rounded-[1.5rem] border border-border/70 bg-muted/30 p-5 sm:p-6">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-lg font-semibold">{t("profile.learnMore")}</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  {t("profile.learnMoreBody")}
                </p>
              </div>
              <div className="flex flex-wrap gap-3 text-sm font-medium">
                <Link
                  to="/cum-functioneaza"
                  className="inline-flex items-center gap-2 text-primary hover:underline"
                >
                  <Bookmark className="size-4" />
                  {t("footer.howItWorks")}
                </Link>
                <Link
                  to="/sursele-noastre"
                  className="text-primary hover:underline"
                >
                  {t("footer.sources")}
                </Link>
                <Link to="/despre" className="text-primary hover:underline">
                  {t("footer.about")}
                </Link>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
