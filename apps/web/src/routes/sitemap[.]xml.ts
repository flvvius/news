import { createFileRoute } from "@tanstack/react-router";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@news-app/backend/convex/_generated/api";
import { absoluteSiteUrl } from "@/lib/seo";

const convexUrl = process.env.VITE_CONVEX_URL!;

function escapeXml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function toSitemapUrl(pathname: string, lastModifiedAt?: number) {
  const url = absoluteSiteUrl(pathname);
  const lastmod = lastModifiedAt
    ? `<lastmod>${new Date(lastModifiedAt).toISOString()}</lastmod>`
    : "";
  return `<url><loc>${escapeXml(url)}</loc>${lastmod}</url>`;
}

function buildSitemapHeaders() {
  return {
    "content-type": "application/xml; charset=utf-8",
    "cache-control": "public, max-age=3600, s-maxage=86400",
  };
}

function buildFallbackSitemapXml() {
  const entries = [toSitemapUrl("/")];
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...entries,
    "</urlset>",
  ].join("");
}

export const Route = createFileRoute("/sitemap.xml")({
  server: {
    handlers: {
      HEAD: async () =>
        new Response(null, {
          status: 200,
          headers: buildSitemapHeaders(),
        }),
      GET: async () => {
        const client = new ConvexHttpClient(convexUrl);
        let xml = buildFallbackSitemapXml();
        try {
          const snapshot = await client.query(api.sitemap.getPublicSitemapXml, {});
          xml = snapshot?.xml ?? xml;
        } catch (error) {
          console.error("Failed to load sitemap snapshot from Convex:", error);
        }

        return new Response(xml, {
          status: 200,
          headers: buildSitemapHeaders(),
        });
      },
    },
  },
});
