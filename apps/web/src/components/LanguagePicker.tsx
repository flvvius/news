import { createServerFn } from "@tanstack/react-start";
import { useRouter } from "@tanstack/react-router";
import { setCookie } from "@tanstack/react-start/server";
import { useConvexAuth, useMutation } from "convex/react";
import { api } from "@news-app/backend/convex/_generated/api";
import { useLocale, useT } from "@/lib/i18n/LocaleContext";
import type { Locale } from "@/lib/i18n/strings";
import { Button } from "@/components/ui/button";

function validateLocale(input: unknown): Locale {
  if (input === "ro" || input === "en") {
    return input;
  }

  throw new Error("Invalid locale");
}

const setLocaleCookie = createServerFn({ method: "POST" })
  .inputValidator(validateLocale)
  .handler(({ data }) => {
    setCookie("bv_locale", data, {
      path: "/",
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 365,
    });

    return { locale: data };
  });

export function LanguagePicker() {
  const router = useRouter();
  const t = useT();
  const currentLocale = useLocale();
  const { isAuthenticated } = useConvexAuth();
  const updatePreferredLanguage = useMutation(api.user.updatePreferredLanguage);

  const handleChange = async (locale: Locale) => {
    if (locale === currentLocale) {
      return;
    }

    await setLocaleCookie({ data: locale });

    if (isAuthenticated) {
      try {
        await updatePreferredLanguage({ language: locale });
      } catch {
        // Cookie persistence is still enough for anonymous/fallback usage.
      }
    }

    await router.invalidate();
  };

  return (
    <div
      className="flex gap-2"
      role="group"
      aria-label={t("settings.language")}
    >
      <Button
        variant={currentLocale === "ro" ? "default" : "outline"}
        size="sm"
        onClick={() => void handleChange("ro")}
      >
        {t("settings.language.ro")}
      </Button>
      <Button
        variant={currentLocale === "en" ? "default" : "outline"}
        size="sm"
        onClick={() => void handleChange("en")}
      >
        {t("settings.language.en")}
      </Button>
    </div>
  );
}
