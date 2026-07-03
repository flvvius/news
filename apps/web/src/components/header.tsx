import { useState } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import {
  Menu,
  Newspaper,
  Bookmark,
  LayoutDashboard,
  User,
  BrainCircuit,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { LanguagePicker } from "@/components/LanguagePicker";
import { FEATURE_FLAGS } from "@/lib/feature-flags";
import { useT } from "@/lib/i18n/LocaleContext";
import { cn } from "@/lib/utils";
import {
  Sheet,
  SheetContent,
  SheetTrigger,
  SheetTitle,
} from "@/components/ui/sheet";

const allLinks = [
  { to: "/feed", key: "tabs.feed", icon: Newspaper },
  { to: "/quiz", key: "tabs.quiz", icon: BrainCircuit },
  { to: "/salvate", key: "tabs.saved", icon: Bookmark },
  { to: "/activitate", key: "tabs.activity", icon: LayoutDashboard },
  { to: "/profil", key: "tabs.profile", icon: User },
] as const;

// Quiz stays out of the nav while its feature flag is off (BIV-802).
// Exported so tests can assert the visible set without rendering the router.
export const links = allLinks.filter(
  (link) => link.to !== "/quiz" || FEATURE_FLAGS.quiz,
);

/**
 * Editorial-calm masthead (BIV-807, mirrors the native DESIGN_LOG): flat
 * bg-background + bottom hairline, holds still on scroll (no scroll-linked
 * chrome on the most-visited surface), active nav state is typographic
 * (weight + color) instead of pill chrome.
 */
export default function Header() {
  const [open, setOpen] = useState(false);
  const t = useT();
  const routerState = useRouterState();
  const currentPath = routerState.location.pathname;

  return (
    <header className="fixed inset-x-0 top-0 z-50 border-b border-border bg-background">
      <div className="container mx-auto max-w-6xl">
        <div className="flex h-14 items-center justify-between px-4">
          {/* Logo */}
          <Link
            to="/feed"
            className="flex items-center gap-2 rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            <div className="flex size-8 items-center justify-center rounded-lg bg-primary text-base font-bold text-primary-foreground">
              B
            </div>
            <span className="text-lg font-semibold tracking-tight">
              Biviant
            </span>
          </Link>

          {/* Desktop nav */}
          <nav
            aria-label={t("header.primaryNav")}
            className="hidden md:flex items-center gap-1"
          >
            {links.map(({ to, key, icon: Icon }) => {
              const isActive =
                currentPath === to || currentPath.startsWith(`${to}/`);
              return (
                <Link
                  key={to}
                  to={to}
                  aria-current={isActive ? "page" : undefined}
                  className={cn(
                    "flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                    isActive
                      ? "font-semibold text-foreground"
                      : "font-medium text-muted-foreground hover:text-foreground",
                  )}
                >
                  <Icon
                    className="size-4"
                    strokeWidth={isActive ? 2.5 : 2}
                    aria-hidden="true"
                  />
                  {t(key)}
                </Link>
              );
            })}
          </nav>

          <div className="hidden md:flex items-center">
            <LanguagePicker compact />
          </div>

          {/* Mobile burger */}
          <Sheet open={open} onOpenChange={setOpen}>
            <SheetTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="md:hidden"
                aria-label={t("header.openMenu")}
              >
                <Menu className="size-5" />
              </Button>
            </SheetTrigger>
            <SheetContent side="right" className="w-72 p-0">
              <div className="flex flex-col h-full">
                <div className="border-b border-border p-6">
                  <SheetTitle className="flex items-center gap-2">
                    <div className="flex size-8 items-center justify-center rounded-lg bg-primary font-bold text-primary-foreground">
                      B
                    </div>
                    <span className="font-semibold">Biviant</span>
                  </SheetTitle>
                </div>
                <nav
                  aria-label={t("header.mobileNav")}
                  className="flex flex-col p-4"
                >
                  {links.map(({ to, key, icon: Icon }) => {
                    const isActive =
                      currentPath === to || currentPath.startsWith(`${to}/`);
                    return (
                      <Link
                        key={to}
                        to={to}
                        aria-current={isActive ? "page" : undefined}
                        className={cn(
                          "flex items-center gap-3 rounded-md px-3 py-3 text-base transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                          isActive
                            ? "font-semibold text-foreground"
                            : "font-medium text-muted-foreground hover:text-foreground",
                        )}
                        onClick={() => setOpen(false)}
                      >
                        <Icon
                          className="size-5"
                          strokeWidth={isActive ? 2.5 : 2}
                          aria-hidden="true"
                        />
                        {t(key)}
                      </Link>
                    );
                  })}
                </nav>
                <div className="mt-auto border-t border-border p-4">
                  <LanguagePicker compact className="justify-center" />
                </div>
              </div>
            </SheetContent>
          </Sheet>
        </div>
      </div>
    </header>
  );
}
