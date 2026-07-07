import { Monitor, Moon, Sun } from "lucide-react";
import { useT } from "@/lib/i18n/LocaleContext";
import { type ThemePreference } from "@/lib/theme";
import { useTheme } from "@/lib/theme/ThemeProvider";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

const THEME_OPTIONS: Array<{
  preference: ThemePreference;
  labelKey:
    | "settings.theme.system"
    | "settings.theme.light"
    | "settings.theme.dark";
  Icon: typeof Monitor;
}> = [
  {
    preference: "system",
    labelKey: "settings.theme.system",
    Icon: Monitor,
  },
  {
    preference: "light",
    labelKey: "settings.theme.light",
    Icon: Sun,
  },
  {
    preference: "dark",
    labelKey: "settings.theme.dark",
    Icon: Moon,
  },
];

export function ThemePicker({
  compact = false,
  className,
}: {
  compact?: boolean;
  className?: string;
}) {
  const t = useT();
  const { preference, setPreference } = useTheme();

  return (
    <div
      className={cn("flex flex-wrap gap-2", className)}
      role="group"
      aria-label={t("settings.theme")}
    >
      {THEME_OPTIONS.map(({ preference: option, labelKey, Icon }) => {
        const label = t(labelKey);

        return (
          <Button
            key={option}
            type="button"
            variant={preference === option ? "default" : "outline"}
            size="sm"
            className={cn("min-w-0 gap-2", compact ? "px-2.5" : "px-3")}
            onClick={() => setPreference(option)}
            aria-pressed={preference === option}
            aria-label={label}
          >
            <Icon className="size-4" aria-hidden="true" />
            <span className={cn(compact ? "text-xs" : "text-sm")}>
              {label}
            </span>
          </Button>
        );
      })}
    </div>
  );
}
