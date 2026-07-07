import { Moon, Sun } from "lucide-react";
import { useT } from "@/lib/i18n/LocaleContext";
import { useTheme } from "@/lib/theme/ThemeProvider";
import { Button } from "@/components/ui/button";

/**
 * Single-tap light/dark switch for the desktop masthead. Toggles against the
 * *resolved* theme, so a "system" preference flips to the opposite of what is
 * currently on screen. The full system/light/dark control stays in Settings
 * (ThemePicker).
 */
export function ThemeToggle({ className }: { className?: string }) {
  const t = useT();
  const { resolvedTheme, setPreference } = useTheme();
  const isDark = resolvedTheme === "dark";

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className={className}
      onClick={() => setPreference(isDark ? "light" : "dark")}
      aria-label={isDark ? t("header.switchToLight") : t("header.switchToDark")}
    >
      {isDark ? (
        <Sun className="size-5" aria-hidden="true" />
      ) : (
        <Moon className="size-5" aria-hidden="true" />
      )}
    </Button>
  );
}
