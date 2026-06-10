export const SITE_URL = "https://biviant.com";

export type AboutPage = {
  slug: string;
  title: string;
  /** Path on biviant.com — same content the web footer used to link to. */
  path: string;
};

/**
 * Former web-footer pages. On native these live only in the
 * Profile → "About Biviant" section (never as a footer).
 */
export const ABOUT_PAGES: AboutPage[] = [
  { slug: "about", title: "About us", path: "/despre" },
  { slug: "how-it-works", title: "How it works", path: "/cum-functioneaza" },
  { slug: "our-sources", title: "Our sources", path: "/sursele-noastre" },
  { slug: "contact", title: "Contact", path: "/contact" },
  { slug: "partners", title: "Partners", path: "/parteneri" },
  { slug: "privacy", title: "Privacy policy", path: "/politica-confidentialitate" },
  { slug: "terms", title: "Terms of service", path: "/termeni" },
];

export function aboutPageUrl(page: AboutPage): string {
  return new URL(page.path, SITE_URL).toString();
}

export function eventShareUrl(slug: string): string {
  return new URL(`/event/${slug}`, SITE_URL).toString();
}
