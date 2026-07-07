export const THEME_STORAGE_KEY = "biviant-theme-preference";
export const THEME_MEDIA_QUERY = "(prefers-color-scheme: dark)";

export type ThemePreference = "system" | "light" | "dark";
export type ResolvedTheme = "light" | "dark";

export function isThemePreference(value: unknown): value is ThemePreference {
  return value === "system" || value === "light" || value === "dark";
}

export function coerceThemePreference(value: unknown): ThemePreference {
  return isThemePreference(value) ? value : "system";
}

export function resolveThemePreference(
  preference: ThemePreference,
  systemPrefersDark: boolean,
): ResolvedTheme {
  if (preference === "dark") {
    return "dark";
  }

  if (preference === "light") {
    return "light";
  }

  return systemPrefersDark ? "dark" : "light";
}

export function getSystemPrefersDark(
  matchMedia: Window["matchMedia"] | undefined =
    typeof window === "undefined" ? undefined : window.matchMedia,
): boolean {
  return Boolean(matchMedia?.(THEME_MEDIA_QUERY).matches);
}

export function getStoredThemePreference(
  storage?: Storage,
): ThemePreference {
  try {
    const targetStorage =
      storage ?? (typeof window === "undefined" ? undefined : window.localStorage);

    return coerceThemePreference(targetStorage?.getItem(THEME_STORAGE_KEY));
  } catch {
    return "system";
  }
}

export function setStoredThemePreference(
  preference: ThemePreference,
  storage?: Storage,
) {
  try {
    const targetStorage =
      storage ?? (typeof window === "undefined" ? undefined : window.localStorage);

    if (preference === "system") {
      targetStorage?.removeItem(THEME_STORAGE_KEY);
      return;
    }

    targetStorage?.setItem(THEME_STORAGE_KEY, preference);
  } catch {
    // Private browsing and locked-down embeds can reject storage access.
  }
}

export function applyResolvedTheme(
  resolvedTheme: ResolvedTheme,
  root: HTMLElement | undefined =
    typeof document === "undefined" ? undefined : document.documentElement,
) {
  if (!root) {
    return;
  }

  root.classList.toggle("dark", resolvedTheme === "dark");
  root.style.colorScheme = resolvedTheme;
}

export const themeNoFlashScript = `
(() => {
  const storageKey = ${JSON.stringify(THEME_STORAGE_KEY)};
  const mediaQuery = ${JSON.stringify(THEME_MEDIA_QUERY)};
  let preference = "system";

  try {
    const stored = window.localStorage.getItem(storageKey);
    if (stored === "light" || stored === "dark" || stored === "system") {
      preference = stored;
    }
  } catch {}

  const systemDark = window.matchMedia?.(mediaQuery).matches === true;
  const resolved = preference === "dark" || (preference === "system" && systemDark)
    ? "dark"
    : "light";
  document.documentElement.classList.toggle("dark", resolved === "dark");
  document.documentElement.style.colorScheme = resolved;
})();
`.trim();
