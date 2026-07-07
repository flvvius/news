import { api } from "@news-app/backend/convex/_generated/api";
import { getString, type Locale, type StringKey } from "@news-app/i18n";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import * as SecureStore from "expo-secure-store";
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export type LanguagePreference = "system" | Locale;

// Separate from the better-auth storage prefix: sign-out must not reset the
// chosen language.
const LANGUAGE_PREFERENCE_KEY = "biviant.language-preference";

type LocaleContextType = {
  /** Resolved locale used for rendering. */
  locale: Locale;
  /** The stored preference driving the Settings picker. */
  preference: LanguagePreference;
  setPreference: (preference: LanguagePreference) => void;
};

const LocaleContext = createContext<LocaleContextType | undefined>(undefined);

function isLanguagePreference(
  value: string | null,
): value is LanguagePreference {
  return value === "system" || value === "ro" || value === "en";
}

// Romanian-first product: default everyone to Romanian on first open. English
// is opt-in only, via an explicit account preference. A non-Romanian device
// locale does NOT pull the user into English.
const DEFAULT_LOCALE: Locale = "ro";

export function LocaleProvider({ children }: { children: ReactNode }) {
  const { isAuthenticated } = useConvexAuth();
  const currentUser = useQuery(
    api.user.getCurrentUser,
    isAuthenticated ? {} : "skip",
  );
  const updatePreferredLanguage = useMutation(api.user.updatePreferredLanguage);
  const [preference, setPreferenceState] =
    useState<LanguagePreference>("system");

  useEffect(() => {
    let cancelled = false;
    SecureStore.getItemAsync(LANGUAGE_PREFERENCE_KEY)
      .then((stored) => {
        if (!cancelled && isLanguagePreference(stored)) {
          setPreferenceState(stored);
        }
      })
      .catch(() => {
        // Unreadable preference — fall back to system resolution.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const profileLanguage = currentUser?.profile?.preferredLanguage;

  const value = useMemo<LocaleContextType>(() => {
    // Resolution mirrors the web's resolveLocale priorities, adapted to
    // native inputs: explicit choice → account preference → Romanian default.
    const locale: Locale =
      preference !== "system"
        ? preference
        : (profileLanguage ?? DEFAULT_LOCALE);

    return {
      locale,
      preference,
      setPreference: (next) => {
        setPreferenceState(next);
        SecureStore.setItemAsync(LANGUAGE_PREFERENCE_KEY, next).catch(() => {
          // Persisting the preference is best-effort.
        });
        if (next !== "system" && isAuthenticated) {
          updatePreferredLanguage({ language: next }).catch(() => {
            // Account sync is best-effort; the local choice still applies.
          });
        }
      },
    };
  }, [preference, profileLanguage, isAuthenticated, updatePreferredLanguage]);

  return (
    <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>
  );
}

export function useLocaleContext(): LocaleContextType {
  const context = useContext(LocaleContext);
  if (!context) {
    throw new Error("useLocaleContext must be used within LocaleProvider");
  }
  return context;
}

export function useLocale(): Locale {
  return useLocaleContext().locale;
}

/** Same call shape as the web useT hook. */
export function useT() {
  const locale = useLocale();

  return (key: StringKey, fallback?: string): string =>
    getString(locale, key, fallback);
}
