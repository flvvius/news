import { Link } from "@tanstack/react-router";
import { useT } from "@/lib/i18n/LocaleContext";

const footerSections = [
  {
    titleKey: "footer.aboutSection",
    links: [
      { to: "/despre", labelKey: "footer.about" },
      { to: "/contact", labelKey: "footer.contact" },
      { to: "/parteneri", labelKey: "footer.partners" },
    ],
  },
  {
    titleKey: "footer.resourcesSection",
    links: [
      { to: "/cum-functioneaza", labelKey: "footer.howItWorks" },
      { to: "/sursele-noastre", labelKey: "footer.sources" },
    ],
  },
  {
    titleKey: "footer.legalSection",
    links: [
      {
        to: "/politica-confidentialitate",
        labelKey: "footer.privacy",
      },
      { to: "/termeni", labelKey: "footer.terms" },
    ],
  },
] as const;

export function Footer() {
  const t = useT();

  return (
    <footer className="border-t border-border bg-muted/20 pb-24 md:pb-8">
      <div className="container mx-auto max-w-6xl px-4 py-10">
        <div className="grid grid-cols-2 gap-8 md:grid-cols-3">
          {footerSections.map((section, index) => (
            <div
              key={section.titleKey}
              className={index === footerSections.length - 1 ? "col-span-2 space-y-3 md:col-span-1" : "space-y-3"}
            >
              <h2 className="text-sm font-semibold text-foreground">
                {t(section.titleKey)}
              </h2>
              <div className="flex flex-col gap-2">
                {section.links.map((link) => (
                  <Link
                    key={link.to}
                    to={link.to}
                    className="text-sm text-muted-foreground transition-colors hover:text-foreground"
                  >
                    {t(link.labelKey)}
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
