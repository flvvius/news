import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetTrigger,
  SheetTitle,
} from "@/components/ui/sheet";

const links = [
  { to: "/", label: "Home" },
  { to: "/feed", label: "Feed" },
  { to: "/bookmarks", label: "Bookmarks" },
  { to: "/dashboard", label: "Dashboard" },
] as const;

export default function Header() {
  const [open, setOpen] = useState(false);

  return (
    <header>
      <div className="flex items-center justify-between px-6 py-4">
        <Link to="/" className="text-xl font-bold">
          Biviant
        </Link>

        {/* Desktop nav */}
        <nav aria-label="Primary" className="hidden md:flex gap-6">
          {links.map(({ to, label }) => (
            <Link
              key={to}
              to={to}
              className="text-sm font-medium hover:text-primary transition-colors"
            >
              {label}
            </Link>
          ))}
        </nav>

        {/* Mobile burger */}
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="md:hidden"
              aria-label="Open menu"
            >
              <Menu className="size-5" />
            </Button>
          </SheetTrigger>
          <SheetContent side="right" className="w-64">
            <SheetTitle className="text-lg font-bold mb-6">Menu</SheetTitle>
            <nav aria-label="Mobile" className="flex flex-col gap-4">
              {links.map(({ to, label }) => (
                <Link
                  key={to}
                  to={to}
                  className="text-base font-medium hover:text-primary transition-colors"
                  onClick={() => setOpen(false)}
                >
                  {label}
                </Link>
              ))}
            </nav>
          </SheetContent>
        </Sheet>
      </div>
      <hr />
    </header>
  );
}
