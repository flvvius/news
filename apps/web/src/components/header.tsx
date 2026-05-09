import { useState } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import { Menu, Newspaper, Bookmark, LayoutDashboard, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useT } from "@/lib/i18n/LocaleContext";
import {
  Sheet,
  SheetContent,
  SheetTrigger,
  SheetTitle,
} from "@/components/ui/sheet";

const links = [
  { to: "/feed", key: "tabs.feed", icon: Newspaper },
  { to: "/salvate", key: "tabs.saved", icon: Bookmark },
  { to: "/activitate", key: "tabs.activity", icon: LayoutDashboard },
  { to: "/profil", key: "tabs.profile", icon: User },
] as const;

export default function Header() {
  const [open, setOpen] = useState(false);
  const t = useT();
  const routerState = useRouterState();
  const currentPath = routerState.location.pathname;

  return (
    <header className="sticky top-0 z-50 bg-background/80 backdrop-blur-lg border-b border-border">
      <div className="container mx-auto max-w-6xl">
        <div className="flex items-center justify-between px-4 h-16">
          {/* Logo */}
          <Link to="/feed" className="flex items-center gap-2 group">
            <div className="relative flex items-center justify-center size-9 rounded-lg bg-primary text-primary-foreground font-bold text-lg transition-transform group-hover:scale-105">
              B
              <div className="absolute inset-0 rounded-lg bg-primary/20 blur-md -z-10" />
            </div>
            <span className="text-xl font-bold tracking-tight">Biviant</span>
          </Link>

          {/* Desktop nav */}
          <nav
            aria-label={t("header.primaryNav")}
            className="hidden md:flex items-center gap-1"
          >
            {links.map(({ to, key, icon: Icon }) => {
              const isActive = currentPath === to || currentPath.startsWith(`${to}/`);
              return (
                <Link
                  key={to}
                  to={to}
                  className={`
                    flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all
                    ${isActive 
                      ? "bg-primary/10 text-primary" 
                      : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                    }
                  `}
                >
                  <Icon className="size-4" />
                  {t(key)}
                </Link>
              );
            })}
          </nav>

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
                <div className="p-6 border-b border-border">
                  <SheetTitle className="flex items-center gap-2">
                    <div className="flex items-center justify-center size-8 rounded-lg bg-primary text-primary-foreground font-bold">
                      B
                    </div>
                    <span className="font-bold">Biviant</span>
                  </SheetTitle>
                </div>
                <nav
                  aria-label={t("header.mobileNav")}
                  className="flex flex-col gap-1 p-4"
                >
                  {links.map(({ to, key, icon: Icon }) => {
                    const isActive =
                      currentPath === to || currentPath.startsWith(`${to}/`);
                    return (
                      <Link
                        key={to}
                        to={to}
                        className={`
                          flex items-center gap-3 px-4 py-3 rounded-lg text-base font-medium transition-all
                          ${isActive 
                            ? "bg-primary/10 text-primary" 
                            : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                          }
                        `}
                        onClick={() => setOpen(false)}
                      >
                        <Icon className="size-5" />
                        {t(key)}
                      </Link>
                    );
                  })}
                </nav>
              </div>
            </SheetContent>
          </Sheet>
        </div>
      </div>
    </header>
  );
}
