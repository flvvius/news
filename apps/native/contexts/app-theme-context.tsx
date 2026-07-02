import * as SecureStore from "expo-secure-store";
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { Uniwind, useUniwind } from "uniwind";

export type ThemePreference = "system" | "light" | "dark";

// Distinct from the better-auth storage prefix on purpose: sign-out purges
// auth entries and must not touch UI preferences.
const THEME_PREFERENCE_KEY = "biviant.theme-preference";

type AppThemeContextType = {
  /** The user's stored preference (drives the Settings picker). */
  preference: ThemePreference;
  /** The resolved active theme uniwind is rendering with. */
  activeTheme: "light" | "dark";
  setPreference: (preference: ThemePreference) => void;
};

const AppThemeContext = createContext<AppThemeContextType | undefined>(
  undefined,
);

function isThemePreference(value: string | null): value is ThemePreference {
  return value === "system" || value === "light" || value === "dark";
}

export function AppThemeProvider({ children }: { children: ReactNode }) {
  const { theme } = useUniwind();
  const [preference, setPreferenceState] = useState<ThemePreference>("system");

  useEffect(() => {
    let cancelled = false;
    SecureStore.getItemAsync(THEME_PREFERENCE_KEY)
      .then((stored) => {
        if (cancelled || !isThemePreference(stored) || stored === "system") {
          return;
        }
        setPreferenceState(stored);
        Uniwind.setTheme(stored);
      })
      .catch(() => {
        // Unreadable preference — stay on system theme.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const value = useMemo<AppThemeContextType>(
    () => ({
      preference,
      activeTheme: theme === "dark" ? "dark" : "light",
      setPreference: (next) => {
        setPreferenceState(next);
        Uniwind.setTheme(next);
        SecureStore.setItemAsync(THEME_PREFERENCE_KEY, next).catch(() => {
          // Persisting the preference is best-effort.
        });
      },
    }),
    [preference, theme],
  );

  return (
    <AppThemeContext.Provider value={value}>
      {children}
    </AppThemeContext.Provider>
  );
}

export function useAppTheme() {
  const context = useContext(AppThemeContext);
  if (!context) {
    throw new Error("useAppTheme must be used within AppThemeProvider");
  }
  return context;
}
