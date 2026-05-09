import { Link } from "@tanstack/react-router";

const footerSections = [
  {
    title: "Despre",
    links: [
      { to: "/despre", label: "Despre noi" },
      { to: "/contact", label: "Contact" },
      { to: "/parteneri", label: "Parteneri" },
    ],
  },
  {
    title: "Resurse",
    links: [
      { to: "/cum-functioneaza", label: "Cum funcționează" },
      { to: "/sursele-noastre", label: "Sursele noastre" },
    ],
  },
  {
    title: "Legal",
    links: [
      {
        to: "/politica-confidentialitate",
        label: "Confidențialitate",
      },
      { to: "/termeni", label: "Termeni" },
    ],
  },
] as const;

export function Footer() {
  return (
    <footer className="border-t border-border bg-muted/20 pb-24 md:pb-8">
      <div className="container mx-auto max-w-6xl px-4 py-10">
        <div className="grid gap-8 md:grid-cols-3">
          {footerSections.map((section) => (
            <div key={section.title} className="space-y-3">
              <h2 className="text-sm font-semibold text-foreground">
                {section.title}
              </h2>
              <div className="flex flex-col gap-2">
                {section.links.map((link) => (
                  <Link
                    key={link.to}
                    to={link.to}
                    className="text-sm text-muted-foreground transition-colors hover:text-foreground"
                  >
                    {link.label}
                  </Link>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="mt-8 border-t border-border pt-4 text-sm text-muted-foreground">
          © {new Date().getFullYear()} Biviant
        </div>
      </div>
    </footer>
  );
}
