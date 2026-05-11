import { ConvexHttpClient } from "convex/browser";
import { createFileRoute } from "@tanstack/react-router";
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
    "cache-control": "public, max-age=900",
  };
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
        const [events, sources] = await Promise.all([
          client.query(api.events.getSitemapPublishedEvents, { limit: 5000 }),
          client.query(api.sources.getSitemapSources, { limit: 5000 }),
        ]);

        const entries = [
          toSitemapUrl("/"),
          toSitemapUrl("/feed"),
          ...events.map((event) =>
            toSitemapUrl(`/event/${event.slug}`, event.lastModifiedAt),
          ),
          ...sources.map((source) =>
            toSitemapUrl(`/source/${source.sourceId}`, source.lastModifiedAt),
          ),
        ];

        const xml = [
          '<?xml version="1.0" encoding="UTF-8"?>',
          '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
          ...entries,
          "</urlset>",
        ].join("");

        return new Response(xml, {
          status: 200,
          headers: buildSitemapHeaders(),
        });
      },
    },
  },
});
