import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  THEME_MEDIA_QUERY,
  applyResolvedTheme,
  getStoredThemePreference,
  getSystemPrefersDark,
  resolveThemePreference,
  setStoredThemePreference,
  type ResolvedTheme,
  type ThemePreference,
} from "@/lib/theme";

type ThemeContextValue = {
  preference: ThemePreference;
  resolvedTheme: ResolvedTheme;
  setPreference: (preference: ThemePreference) => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);
const useIsomorphicLayoutEffect =
  typeof window === "undefined" ? useEffect : useLayoutEffect;

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setPreferenceState] =
    useState<ThemePreference>("system");
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>("light");

  const syncTheme = useCallback((nextPreference: ThemePreference) => {
    const nextResolvedTheme = resolveThemePreference(
      nextPreference,
      getSystemPrefersDark(),
    );

    setPreferenceState(nextPreference);
    setResolvedTheme(nextResolvedTheme);
    applyResolvedTheme(nextResolvedTheme);
  }, []);

  const setPreference = useCallback(
    (nextPreference: ThemePreference) => {
      setStoredThemePreference(nextPreference);
      syncTheme(nextPreference);
    },
    [syncTheme],
  );

  useIsomorphicLayoutEffect(() => {
    syncTheme(getStoredThemePreference());
  }, [syncTheme]);

  useEffect(() => {
    const media = window.matchMedia?.(THEME_MEDIA_QUERY);
    if (!media) {
      return;
    }

    const handleChange = () => {
      const nextResolvedTheme = resolveThemePreference(
        preference,
        getSystemPrefersDark(),
      );

      setResolvedTheme(nextResolvedTheme);
      applyResolvedTheme(nextResolvedTheme);
    };

    media.addEventListener("change", handleChange);
    return () => {
      media.removeEventListener("change", handleChange);
    };
  }, [preference]);

  const value = useMemo<ThemeContextValue>(
    () => ({
      preference,
      resolvedTheme,
      setPreference,
    }),
    [preference, resolvedTheme, setPreference],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error("useTheme must be used within ThemeProvider");
  }

  return context;
}
