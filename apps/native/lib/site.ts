export const SITE_URL = "https://biviant.com";

import type { StringKey } from "@news-app/i18n";

export type AboutPage = {
  slug: string;
  titleKey: StringKey;
  /** Path on biviant.com — same content the web footer used to link to. */
  path: string;
};

/**
 * Former web-footer pages. On native these live only in the
 * Profile → "About Biviant" section (never as a footer).
 */
export const ABOUT_PAGES: AboutPage[] = [
  { slug: "about", titleKey: "footer.about", path: "/despre" },
  { slug: "how-it-works", titleKey: "footer.howItWorks", path: "/cum-functioneaza" },
  { slug: "our-sources", titleKey: "footer.sources", path: "/sursele-noastre" },
  { slug: "contact", titleKey: "footer.contact", path: "/contact" },
  { slug: "partners", titleKey: "footer.partners", path: "/parteneri" },
  { slug: "privacy", titleKey: "footer.privacy", path: "/politica-confidentialitate" },
  { slug: "terms", titleKey: "footer.terms", path: "/termeni" },
];

export function aboutPageUrl(page: AboutPage): string {
  return new URL(page.path, SITE_URL).toString();
}

export function eventShareUrl(slug: string): string {
  return new URL(`/event/${slug}`, SITE_URL).toString();
}
