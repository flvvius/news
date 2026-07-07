import { BRAND_NAME, getString, type Locale } from "@/lib/i18n/strings";

/**
 * SEO constants used across all routes.
 *
 * Update `url` once the production domain is finalized.
 * The default share card lives at `public/og-image.jpg`: 1200×630 (the 1.91:1
 * size every platform crops to) and kept well under WhatsApp's ~300KB preview
 * limit. JPEG so the cream background and logo gradients stay band-free at that
 * size. Event pages override og:image with their own photo.
 */
export const SITE = {
  name: BRAND_NAME,
  url: "https://biviant.com",
  title: getString("en", "seo.siteTitle"),
  description: getString("en", "seo.siteDescription"),
  ogImage: "https://biviant.com/og-image.jpg",
  ogImageType: "image/jpeg",
  ogImageWidth: 1200,
  ogImageHeight: 630,
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
