import { Bookmark, BarChart3, Newspaper, User } from "lucide-react";
import { Link, useRouterState } from "@tanstack/react-router";
import type { ComponentType, MouseEvent } from "react";
import { useScrollVisibility } from "@/hooks/use-scroll-visibility";
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

function matchesPath(pathname: string, to: string, allowPrefix = false) {
  return pathname === to || (allowPrefix && pathname.startsWith(`${to}/`));
}

export function MobileTabBar() {
  const t = useT();
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  });
  const isVisible = useScrollVisibility();

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
      className={cn(
        "fixed inset-x-0 bottom-0 z-50 px-4 pb-4 transition-transform duration-300 ease-out md:hidden",
        isVisible ? "translate-y-0" : "translate-y-[calc(100%+1rem)]",
      )}
      style={{ paddingBottom: "calc(1rem + env(safe-area-inset-bottom, 0px))" }}
    >
      <div className="mx-auto max-w-md rounded-[1.4rem] border border-border bg-background/92 p-2 shadow-lg shadow-foreground/5 backdrop-blur-xl">
        <div className="grid grid-cols-4 gap-1">
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
                "flex min-w-0 flex-col items-center gap-1 rounded-xl px-2 py-2 text-[11px] transition-all",
                isActive
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-muted/70 hover:text-foreground",
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
      </div>
    </nav>
  );
}
