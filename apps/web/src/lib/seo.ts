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
  url: "https://www.miez.news",
  title: getString("en", "seo.siteTitle"),
  description: getString("en", "seo.siteDescription"),
  ogImage: "https://www.miez.news/og-image.jpg",
  // Romanian alt for the default share card (SEO-2). Event pages override with
  // their own imageAlt when a per-event photo is present.
  ogImageAlt: "Miez - știri din ambele tabere",
  ogImageType: "image/jpeg",
  ogImageWidth: 1200,
  ogImageHeight: 630,
} as const;

export function absoluteSiteUrl(pathname: string): string {
  return new URL(pathname, SITE.url).toString();
}

/**
 * Robots directive for every indexable page.
 *
 * Google's defaults cap news results at a thumbnail-sized image preview and a
 * short snippet; `max-image-preview:large` is what makes an event eligible for
 * the large-image treatment in Google News/Discover, and `max-snippet:-1`
 * lifts the snippet cap so answer engines may quote the full summary. Pages
 * that must stay out of indexes set their own `robots` meta instead and never
 * merge this in.
 */
export const INDEXABLE_ROBOTS =
  "index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1";

/**
 * Stable @id anchors so every JSON-LD block on the site resolves to the *same*
 * Organization / WebSite node instead of minting an anonymous duplicate per
 * page. Search and answer engines merge nodes by @id, so entity signals
 * (logo, sameAs, publisher-of relations) accumulate on one entity.
 */
export const ORGANIZATION_ID = `${SITE.url}/#organization`;
export const WEBSITE_ID = `${SITE.url}/#website`;

/**
 * Truncate text at a word boundary, never mid-word, appending an ellipsis when
 * (and only when) the text was actually cut. Trailing whitespace/punctuation
 * before the ellipsis is stripped so descriptions never read "…word ,…" or end
 * with a dangling space before the closing quote (SEO-6). Whitespace is also
 * collapsed so multi-line summaries render as a single clean meta line.
 */
export function truncateAtWordBoundary(text: string, maxLen: number): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLen) return normalized;
  const slice = normalized.slice(0, maxLen);
  const lastSpace = slice.lastIndexOf(" ");
  const cut = lastSpace > 0 ? slice.slice(0, lastSpace) : slice;
  // Drop any trailing space or dangling punctuation before the ellipsis.
  const trimmed = cut.replace(/[\s.,;:!?…·•\-–—]+$/u, "");
  return `${trimmed}…`;
}

/**
 * Short, stable canonical headline for <title>/og:title/twitter:title, RSS
 * items and the news sitemap (SEO-5). Event titles are concatenated source
 * headlines (200+ chars); take the first segment before the " / " join and cap
 * it at ~65 chars on a word boundary. The long compound title stays on the
 * page as the <h1>. Falls back to the raw title when there is no separator.
 */
export function deriveShortTitle(title: string, maxLen = 65): string {
  const firstSegment = title.split(/\s*\/\s*/)[0]?.trim();
  return truncateAtWordBoundary(
    firstSegment && firstSegment.length > 0 ? firstSegment : title,
    maxLen,
  );
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

/**
 * The publisher node, referenced from every page's structured data. Carries
 * the shared @id so the per-page copies merge into one entity rather than
 * competing duplicates.
 */
export function organizationEntity(): JsonLd {
  return {
    "@type": "NewsMediaOrganization",
    "@id": ORGANIZATION_ID,
    name: SITE.name,
    url: SITE.url,
    // Structured-data logo must be a raster image (Google rejects SVG for the
    // publisher logo); logo-mark.png is 512×512 (SEO-7).
    logo: absoluteSiteUrl("/logo-mark.png"),
    ...(SOCIAL_PROFILES.length > 0 ? { sameAs: SOCIAL_PROFILES } : {}),
  };
}

/**
 * The full Organization node, emitted once (on the feed root). Every other
 * page references it by @id through `organizationEntity()`, so the extra
 * descriptive fields live here and are not repeated site-wide.
 */
function organizationEntityFull(): JsonLd {
  return {
    ...organizationEntity(),
    description: SITE.description,
    // Publisher, not reporter: stated in-band so an answer engine attributing
    // a claim to us knows what kind of entity it is quoting.
    knowsLanguage: ["ro", "en"],
    areaServed: { "@type": "Country", name: "Romania" },
    contactPoint: {
      "@type": "ContactPoint",
      contactType: "customer support",
      url: absoluteSiteUrl("/contact"),
      availableLanguage: ["ro", "en"],
    },
  };
}

export function organizationJsonLd(): JsonLd {
  return { "@context": "https://schema.org", ...organizationEntityFull() };
}

/**
 * The WebSite node. Deliberately carries no `potentialAction`/SearchAction:
 * feed search is client-side and has no addressable ?q= URL, so advertising
 * one would point crawlers at a URL that does not exist.
 */
export function websiteJsonLd(description: string): JsonLd {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    "@id": WEBSITE_ID,
    name: SITE.name,
    url: SITE.url,
    description,
    inLanguage: "ro",
    publisher: { "@id": ORGANIZATION_ID },
  };
}

/**
 * BreadcrumbList for a nested page. Answer engines use it to place a page in
 * the site hierarchy; Google renders it in place of the raw URL. `items` is
 * ordered root-first and every entry must correspond to a real, reachable URL.
 */
export function breadcrumbJsonLd(
  items: Array<{ name: string; path: string }>,
): JsonLd {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      item: absoluteSiteUrl(item.path),
    })),
  };
}

/**
 * FAQPage for a page that really does answer those questions in visible body
 * text. Google requires the answer text to be present on the page verbatim —
 * callers must pass the same strings they render, never a paraphrase.
 */
export function faqPageJsonLd(
  entries: ReadonlyArray<{ question: string; answer: string }>,
  path: string,
): JsonLd {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    "@id": `${absoluteSiteUrl(path)}#faq`,
    inLanguage: "ro",
    mainEntity: entries.map((entry) => ({
      "@type": "Question",
      name: entry.question,
      acceptedAnswer: { "@type": "Answer", text: entry.answer },
    })),
  };
}

/**
 * ItemList for a directory page (e.g. the source index). Gives answer engines
 * the enumerated set behind a "which publications does Miez track?" question
 * without making them parse the rendered list.
 */
export function itemListJsonLd(args: {
  name: string;
  path: string;
  items: Array<{ name: string; path: string }>;
}): JsonLd {
  return {
    "@context": "https://schema.org",
    "@type": "ItemList",
    "@id": `${absoluteSiteUrl(args.path)}#list`,
    name: args.name,
    numberOfItems: args.items.length,
    itemListOrder: "https://schema.org/ItemListUnordered",
    itemListElement: args.items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      url: absoluteSiteUrl(item.path),
    })),
  };
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
 * The default share-card meta, for pages that do not bring their own image.
 *
 * `includeType` is off by default because of how head tags merge: TanStack
 * dedupes meta by name/property with the deepest route winning, so anything
 * the root declares and a child does not re-declare *leaks* onto that child.
 * Event pages override og:image with a publisher photo of unknown MIME type,
 * so a root-level `og:image:type: image/jpeg` would mislabel it. Pages that
 * genuinely serve og-image.jpg (the static pages) opt the type back in.
 */
export function defaultShareImageMeta(options?: { includeType?: boolean }) {
  return [
    { property: "og:image", content: SITE.ogImage },
    ...(options?.includeType
      ? [{ property: "og:image:type", content: SITE.ogImageType }]
      : []),
    { property: "og:image:width", content: String(SITE.ogImageWidth) },
    { property: "og:image:height", content: String(SITE.ogImageHeight) },
    { property: "og:image:alt", content: SITE.ogImageAlt },
    { name: "twitter:image", content: SITE.ogImage },
    { name: "twitter:image:alt", content: SITE.ogImageAlt },
  ];
}

/**
 * head() payload for indexable static pages: unique title/description plus
 * self-canonical, the indexable robots directive, OG/Twitter tags and an
 * optional JSON-LD block — all in the initial server HTML.
 *
 * The static pages are authored in Romanian (the product language), so
 * og:locale is fixed to ro_RO here rather than following the UI chrome locale.
 */
export function staticPageHead(args: {
  title: string;
  description: string;
  path: string;
  /** Root-first breadcrumb trail; the page itself is appended automatically. */
  breadcrumb?: Array<{ name: string; path: string }>;
  /** Extra JSON-LD (FAQPage, ItemList, …) rendered alongside the breadcrumb. */
  jsonLd?: JsonLd[];
}) {
  const url = absoluteSiteUrl(args.path);
  const scripts = [
    ...(args.breadcrumb ? [jsonLdScript(breadcrumbJsonLd(args.breadcrumb))] : []),
    ...(args.jsonLd ?? []).map(jsonLdScript),
  ];

  return {
    meta: [
      { title: args.title },
      { name: "description", content: args.description },
      { name: "robots", content: INDEXABLE_ROBOTS },
      { property: "og:title", content: args.title },
      { property: "og:description", content: args.description },
      { property: "og:site_name", content: SITE.name },
      { property: "og:type", content: "website" },
      { property: "og:url", content: url },
      { property: "og:locale", content: "ro_RO" },
      ...defaultShareImageMeta({ includeType: true }),
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: args.title },
      { name: "twitter:description", content: args.description },
    ],
    links: [{ rel: "canonical", href: url }],
    ...(scripts.length > 0 ? { scripts } : {}),
  };
}

export function getSiteSeo(locale: Locale) {
  return {
    title: getString(locale, "seo.siteTitle"),
    description: getString(locale, "seo.siteDescription"),
  };
}
