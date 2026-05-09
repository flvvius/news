import { Bookmark, BarChart3, Newspaper, User } from "lucide-react";
import { Link, useRouterState } from "@tanstack/react-router";
import type { ComponentType, MouseEvent } from "react";
import { useT } from "@/lib/i18n/LocaleContext";
import { cn } from "@/lib/utils";

type TabItem = {
  to: string;
  icon: ComponentType<{ className?: string; strokeWidth?: number }>;
  isActive?: (pathname: string) => boolean;
};

type TabKey =
  | "tabs.feed"
  | "tabs.saved"
  | "tabs.activity"
  | "tabs.profile";

type TabDefinition = TabItem & { key: TabKey };

const tabDefinitions: readonly TabDefinition[] = [
  {
    to: "/feed",
    key: "tabs.feed",
    icon: Newspaper,
    isActive: (pathname: string) =>
      pathname === "/feed" ||
      pathname.startsWith("/feed/") ||
      pathname.startsWith("/event/"),
  },
  { to: "/salvate", key: "tabs.saved", icon: Bookmark },
  { to: "/activitate", key: "tabs.activity", icon: BarChart3 },
  { to: "/profil", key: "tabs.profile", icon: User },
];

function matchesPath(pathname: string, to: string) {
  return pathname === to || pathname.startsWith(`${to}/`);
}

export function MobileTabBar() {
  const t = useT();
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  });

  const handleTabClick =
    (isActive: boolean) => (event: MouseEvent<HTMLAnchorElement>) => {
      if (!isActive) {
        return;
      }

      event.preventDefault();

      if (typeof window !== "undefined") {
        window.scrollTo({ top: 0, behavior: "smooth" });
      }
    };

  return (
    <nav
      aria-label={t("nav.mobile")}
      className="fixed inset-x-0 bottom-0 z-50 border-t border-border bg-background/95 backdrop-blur md:hidden"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <div className="mx-auto grid max-w-md grid-cols-4 px-2 py-2">
        {tabDefinitions.map(({ to, key, icon: Icon, isActive: customIsActive }) => {
          const isActive = customIsActive
            ? customIsActive(pathname)
            : matchesPath(pathname, to);
          const label = t(key);

          return (
            <Link
              key={to}
              to={to}
              onClick={handleTabClick(isActive)}
              aria-current={isActive ? "page" : undefined}
              className={cn(
                "flex min-w-0 flex-col items-center gap-1 rounded-xl px-2 py-2 text-xs transition-colors",
                isActive
                  ? "text-primary"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Icon
                className={cn(
                  "size-5 transition-transform",
                  isActive && "scale-[1.04]",
                )}
                strokeWidth={isActive ? 2.5 : 2}
              />
              <span className={cn("truncate", isActive && "font-semibold")}>
                {label}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
