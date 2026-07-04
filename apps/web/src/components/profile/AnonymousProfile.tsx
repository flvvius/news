import { Link } from "@tanstack/react-router";
import { Palette } from "lucide-react";
import { ThemePicker } from "@/components/theme/ThemePicker";
import { useT } from "@/lib/i18n/LocaleContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function AnonymousProfile() {
  const t = useT();

  return (
    <div className="bg-background">
      <div className="container mx-auto max-w-4xl px-4 py-8 sm:py-10">
        <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(280px,1fr)]">
          <div className="space-y-6">
            <Card>
              <CardContent className="pt-6">
                <div className="space-y-3">
                  <p className="text-sm text-muted-foreground">
                    {t("tabs.profile")}
                  </p>
                  <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
                    {t("profile.account")}
                  </h1>
                  <p className="max-w-[55ch] text-sm text-muted-foreground">
                    {t("profile.signInBody")}
                  </p>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="border-b">
                <CardTitle>{t("auth.unlockTitle")}</CardTitle>
              </CardHeader>
              <CardContent className="pt-6">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="rounded-lg border border-border bg-muted/30 px-4 py-4">
                    <p className="text-sm font-medium text-card-foreground">
                      {t("profile.changePassword")}
                    </p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {t("profile.passwordBody")}
                    </p>
                  </div>
                  <div className="rounded-lg border border-border bg-muted/30 px-4 py-4">
                    <p className="text-sm font-medium text-card-foreground">
                      {t("profile.security")}
                    </p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {t("profile.securityBody")}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="space-y-6">
            <Card>
              <CardHeader className="border-b">
                <CardTitle>{t("profile.settings")}</CardTitle>
              </CardHeader>
              <CardContent className="pt-6">
                <div className="space-y-4">
                  <div className="space-y-1">
                    <div className="inline-flex items-center gap-2 text-sm font-medium text-card-foreground">
                      <Palette className="size-4 text-primary" />
                      <span>{t("profile.theme")}</span>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {t("profile.themeBody")}
                    </p>
                  </div>
                  <ThemePicker />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="border-b">
                <CardTitle>{t("auth.account")}</CardTitle>
              </CardHeader>
              <CardContent className="pt-6">
                <div className="space-y-3">
                  <Button asChild className="w-full">
                    <Link to="/dashboard" search={{ mode: "signup" }}>
                      {t("auth.signUp")}
                    </Link>
                  </Button>
                  <Button asChild variant="outline" className="w-full">
                    <Link to="/dashboard" search={{ mode: "signin" }}>
                      {t("auth.signIn")}
                    </Link>
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
