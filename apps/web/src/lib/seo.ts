/**
 * SEO constants used across all routes.
 *
 * Update `url` once the production domain is finalized.
 * Place an OG image at `public/og-image.png` (1200×630px recommended).
 */
export const SITE = {
  name: "Biviant",
  url: "https://biviant.com",
  title: "Biviant — See Every Side of the Story",
  description:
    "Every story has multiple sides. Biviant shows you all of them, scores each source for bias and reliability, and explains how the news affects your life personally.",
  ogImage: "https://biviant.com/og-image.png",
} as const;
