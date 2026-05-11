import { getString, type Locale } from "@/lib/i18n/strings";

/**
 * SEO constants used across all routes.
 *
 * Update `url` once the production domain is finalized.
 * Place an OG image at `public/og-image.png` (1200×630px recommended).
 */
export const SITE = {
  name: "Biviant",
  url: "https://biviant.com",
  title: getString("en", "seo.siteTitle"),
  description: getString("en", "seo.siteDescription"),
  ogImage: "https://biviant.com/og-image.png",
} as const;

export function absoluteSiteUrl(pathname: string): string {
  return new URL(pathname, SITE.url).toString();
}

export function getSiteSeo(locale: Locale) {
  return {
    title: getString(locale, "seo.siteTitle"),
    description: getString(locale, "seo.siteDescription"),
  };
}
