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
  // www is the canonical host — the apex 307-redirects to it, so canonicals,
  // og:url and sitemap entries must all use www or every URL we advertise
  // goes through a redirect hop.
  url: "https://www.biviant.com",
  title: getString("en", "seo.siteTitle"),
  description: getString("en", "seo.siteDescription"),
  ogImage: "https://www.biviant.com/og-image.jpg",
  ogImageType: "image/jpeg",
  ogImageWidth: 1200,
  ogImageHeight: 630,
} as const;

export function absoluteSiteUrl(pathname: string): string {
  return new URL(pathname, SITE.url).toString();
}

/**
 * Official social/entity profiles for JSON-LD `sameAs`. Extend as profiles
 * are created; never list a profile that doesn't exist yet.
 */
export const SOCIAL_PROFILES: string[] = [];

type JsonLd = Record<string, unknown>;

/** head() `scripts` entry that server-renders a JSON-LD block. */
export function jsonLdScript(data: JsonLd) {
  return { type: "application/ld+json", children: JSON.stringify(data) };
}

function organizationEntity(): JsonLd {
  return {
    "@type": "Organization",
    name: SITE.name,
    url: SITE.url,
    logo: absoluteSiteUrl("/logo-biviant.png"),
    ...(SOCIAL_PROFILES.length > 0 ? { sameAs: SOCIAL_PROFILES } : {}),
  };
}

export function organizationJsonLd(): JsonLd {
  return { "@context": "https://schema.org", ...organizationEntity() };
}

export function softwareApplicationJsonLd(description: string): JsonLd {
  return {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: SITE.name,
    url: SITE.url,
    description,
    applicationCategory: "NewsApplication",
    operatingSystem: "Web",
    offers: { "@type": "Offer", price: "0", priceCurrency: "RON" },
    // aggregateRating deliberately omitted until real user ratings exist.
  };
}

/**
 * Event pages are AI-generated aggregation, not original reporting, so they
 * get Article — never NewsArticle. Every field must match visible page text.
 */
export function eventArticleJsonLd(args: {
  slug: string;
  title: string;
  description?: string;
  imageUrl?: string;
  datePublished: number;
  dateModified: number;
}): JsonLd {
  const url = absoluteSiteUrl(`/event/${args.slug}`);
  return {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: args.title,
    ...(args.description ? { description: args.description } : {}),
    ...(args.imageUrl ? { image: [args.imageUrl] } : {}),
    datePublished: new Date(args.datePublished).toISOString(),
    dateModified: new Date(args.dateModified).toISOString(),
    mainEntityOfPage: url,
    url,
    inLanguage: "ro",
    publisher: organizationEntity(),
  };
}

/**
 * head() payload for indexable static pages: unique title/description plus
 * self-canonical and OG/Twitter tags, all in the initial server HTML.
 */
export function staticPageHead(args: {
  title: string;
  description: string;
  path: string;
}) {
  const url = absoluteSiteUrl(args.path);
  return {
    meta: [
      { title: args.title },
      { name: "description", content: args.description },
      { property: "og:title", content: args.title },
      { property: "og:description", content: args.description },
      { property: "og:site_name", content: SITE.name },
      { property: "og:type", content: "website" },
      { property: "og:url", content: url },
      { property: "og:image", content: SITE.ogImage },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: args.title },
      { name: "twitter:description", content: args.description },
      { name: "twitter:image", content: SITE.ogImage },
    ],
    links: [{ rel: "canonical", href: url }],
  };
}

export function getSiteSeo(locale: Locale) {
  return {
    title: getString(locale, "seo.siteTitle"),
    description: getString(locale, "seo.siteDescription"),
  };
}
