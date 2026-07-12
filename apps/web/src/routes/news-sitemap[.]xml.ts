import { createFileRoute } from "@tanstack/react-router";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@news-app/backend/convex/_generated/api";
import { SITE, absoluteSiteUrl, deriveShortTitle } from "@/lib/seo";
import { escapeXml, type SyndicationEvent } from "@/lib/syndication";

const convexUrl = process.env.VITE_CONVEX_URL!;

// Google News only wants articles from roughly the last two days.
const NEWS_WINDOW_MS = 48 * 60 * 60 * 1000;
const NEWS_ITEM_LIMIT = 100;

function buildNewsSitemapHeaders() {
  return {
    "content-type": "application/xml; charset=utf-8",
    "cache-control": "public, max-age=600, s-maxage=600",
  };
}

function buildNewsSitemapXml(events: SyndicationEvent[]) {
  const cutoff = Date.now() - NEWS_WINDOW_MS;
  const urls = events
    .filter((event) => event.firstPublishedAt >= cutoff)
    .map((event) => {
      const loc = absoluteSiteUrl(`/event/${event.slug}`);
      const title = deriveShortTitle(event.title);
      const publicationDate = new Date(event.firstPublishedAt).toISOString();
      return [
        "<url>",
        `<loc>${escapeXml(loc)}</loc>`,
        "<news:news>",
        "<news:publication>",
        `<news:name>${escapeXml(SITE.name)}</news:name>`,
        "<news:language>ro</news:language>",
        "</news:publication>",
        `<news:publication_date>${publicationDate}</news:publication_date>`,
        `<news:title>${escapeXml(title)}</news:title>`,
        "</news:news>",
        "</url>",
      ].join("");
    })
    .join("");

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:news="http://www.google.com/schemas/sitemap-news/0.9">',
    urls,
    "</urlset>",
  ].join("");
}

export const Route = createFileRoute("/news-sitemap.xml")({
  server: {
    handlers: {
      HEAD: async () =>
        new Response(null, {
          status: 200,
          headers: buildNewsSitemapHeaders(),
        }),
      GET: async () => {
        const client = new ConvexHttpClient(convexUrl);
        let events: SyndicationEvent[] = [];
        try {
          events = await client.query(api.events.getSyndicationEvents, {
            limit: NEWS_ITEM_LIMIT,
          });
        } catch (error) {
          console.error("Failed to load events for /news-sitemap.xml:", error);
        }

        return new Response(buildNewsSitemapXml(events), {
          status: 200,
          headers: buildNewsSitemapHeaders(),
        });
      },
    },
  },
});
