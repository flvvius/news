import { Bookmark, BarChart3, BrainCircuit, Newspaper, User } from "lucide-react";
import { Link, useRouterState } from "@tanstack/react-router";
import type { ComponentType, MouseEvent } from "react";
import { FEATURE_FLAGS } from "@/lib/feature-flags";
import { useT } from "@/lib/i18n/LocaleContext";
import { cn } from "@/lib/utils";

type TabItem = {
  to: string;
  icon: ComponentType<{ className?: string; strokeWidth?: number }>;
  isActive?: (pathname: string) => boolean;
};

type TabKey =
  | "tabs.feed"
  | "tabs.quiz"
  | "tabs.saved"
  | "tabs.activity"
  | "tabs.profile";

type TabDefinition = TabItem & { key: TabKey };

const allTabDefinitions: readonly TabDefinition[] = [
  {
    to: "/feed",
    key: "tabs.feed",
    icon: Newspaper,
    isActive: (pathname: string) =>
      pathname === "/feed" ||
      pathname.startsWith("/feed/") ||
      pathname.startsWith("/event/"),
  },
  { to: "/quiz", key: "tabs.quiz", icon: BrainCircuit },
  { to: "/salvate", key: "tabs.saved", icon: Bookmark },
  { to: "/activitate", key: "tabs.activity", icon: BarChart3 },
  { to: "/profil", key: "tabs.profile", icon: User },
];

// Quiz tab hidden while its feature flag is off (BIV-802). Exported so tests
// can assert the visible set without rendering the router.
export const tabDefinitions = allTabDefinitions.filter(
  (tab) => tab.to !== "/quiz" || FEATURE_FLAGS.quiz,
);

// Tailwind needs literal class names, so pick the column class explicitly
// instead of interpolating the tab count.
const gridColsClass =
  tabDefinitions.length === 5 ? "grid-cols-5" : "grid-cols-4";

function matchesPath(pathname: string, to: string, allowPrefix = false) {
  return pathname === to || (allowPrefix && pathname.startsWith(`${to}/`));
}

/**
 * Flat, full-width tab bar (BIV-807, mirrors the native DESIGN_LOG): system
 * chrome, bg-background + top hairline. The floating blurred pill and the
 * hide-on-scroll motion were rejected on native — glassmorphism/elevation
 * theater, and scroll-linked chrome contradicts the frequency law. Active
 * state is icon weight + foreground text; no tab-switch animation.
 */
export function MobileTabBar() {
  const t = useT();
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  });

  const handleTabClick =
    (isSameDestination: boolean) => (event: MouseEvent<HTMLAnchorElement>) => {
      if (!isSameDestination) {
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
      data-slot="mobile-tab-bar"
      className="fixed inset-x-0 bottom-0 z-50 border-t border-border bg-background pb-[var(--safe-area-bottom)] pl-[var(--safe-area-left)] pr-[var(--safe-area-right)] md:hidden"
    >
      <div className={cn("grid", gridColsClass)}>
        {tabDefinitions.map(
          ({ to, key, icon: Icon, isActive: customIsActive }) => {
            const isActive = customIsActive
              ? customIsActive(pathname)
              : matchesPath(pathname, to);
            const isSameDestination = pathname === to;
            const label = t(key);

            return (
              <Link
                key={to}
                to={to}
                onClick={handleTabClick(isSameDestination)}
                aria-current={isActive ? "page" : undefined}
                className={cn(
                  "flex min-w-0 flex-col items-center gap-1 px-2 pb-2 pt-2.5 text-[11px] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring",
                  isActive
                    ? "text-foreground"
                    : "text-muted-foreground",
                )}
              >
                <Icon className="size-5" strokeWidth={isActive ? 2.5 : 2} />
                <span className={cn("truncate", isActive && "font-semibold")}>
                  {label}
                </span>
              </Link>
            );
          },
        )}
      </div>
    </nav>
  );
}
