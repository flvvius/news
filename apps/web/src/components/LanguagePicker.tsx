import { createServerFn } from "@tanstack/react-start";
import { useRouter } from "@tanstack/react-router";
import { setCookie } from "@tanstack/react-start/server";
import { useConvexAuth, useMutation } from "convex/react";
import { api } from "@news-app/backend/convex/_generated/api";
import { useLocale, useT } from "@/lib/i18n/LocaleContext";
import type { Locale } from "@/lib/i18n/strings";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

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

const LANGUAGE_OPTIONS: Array<{
  locale: Locale;
  flag: string;
  shortLabel: string;
  translationKey: "settings.language.ro" | "settings.language.en";
}> = [
  {
    locale: "ro",
    flag: "🇷🇴",
    shortLabel: "RO",
    translationKey: "settings.language.ro",
  },
  {
    locale: "en",
    flag: "🇺🇸",
    shortLabel: "EN",
    translationKey: "settings.language.en",
  },
];

export function LanguagePicker({
  compact = false,
  className,
}: {
  compact?: boolean;
  className?: string;
}) {
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
      className={cn("flex gap-2", className)}
      role="group"
      aria-label={t("settings.language")}
    >
      {LANGUAGE_OPTIONS.map(({ locale, flag, shortLabel, translationKey }) => (
        <Button
          key={locale}
          type="button"
          variant={currentLocale === locale ? "default" : "outline"}
          size="sm"
          className={cn(
            "min-w-0 gap-2",
            compact ? "px-2.5" : "px-3",
          )}
          onClick={() => void handleChange(locale)}
          aria-pressed={currentLocale === locale}
          aria-label={t(translationKey)}
        >
          <span aria-hidden="true" className="text-base leading-none">
            {flag}
          </span>
          <span className={cn(compact ? "text-xs" : "text-sm")}>{shortLabel}</span>
        </Button>
      ))}
    </div>
  );
}
