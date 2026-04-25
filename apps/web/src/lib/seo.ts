/**
 * SEO constants used across all routes.
 *
 * Update `url` once the production domain is finalized.
 * Place an OG image at `public/og-image.png` (1200×630px recommended).
 */
export const SITE = {
  name: "Biviant",
  url: "https://biviant.com",
  title: "Biviant — Every news story, broken down fact by fact",
  description:
    "Biviant doesn't just show you different perspectives — it shows you exactly what each side claims, where they agree, and where they spin.",
  ogImage: "https://biviant.com/og-image.png",
} as const;
