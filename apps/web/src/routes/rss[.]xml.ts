import { createFileRoute } from "@tanstack/react-router";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@news-app/backend/convex/_generated/api";
import {
  SITE,
  absoluteSiteUrl,
  deriveShortTitle,
  truncateAtWordBoundary,
} from "@/lib/seo";
import { getString } from "@/lib/i18n/strings";
import { escapeXml, type SyndicationEvent } from "@/lib/syndication";

const convexUrl = process.env.VITE_CONVEX_URL!;

// Latest N summarized events (thin-page gated in Convex).
const RSS_ITEM_LIMIT = 50;

function buildRssHeaders() {
  return {
    "content-type": "application/rss+xml; charset=utf-8",
    // Short cache: feed readers/crawlers poll frequently; keep it fresh.
    "cache-control": "public, max-age=600, s-maxage=600",
  };
}

function buildRssXml(events: SyndicationEvent[]) {
  const feedTitle = SITE.name;
  const feedDescription = getString("ro", "feed.meta.description");
  const selfHref = absoluteSiteUrl("/rss.xml");
  const homeHref = absoluteSiteUrl("/");
  // The newest timestamp across the window, not events[0]'s: the feed is
  // ordered by publication but an older event can be re-summarized later, and
  // a lastBuildDate that moves backwards makes conditional-GET readers skip
  // the refresh.
  const lastBuildDate = new Date(
    events.reduce(
      (newest, event) =>
        Math.max(newest, event.lastUpdatedAt ?? event.firstPublishedAt),
      0,
    ) || Date.now(),
  ).toUTCString();

  const items = events
    .map((event) => {
      const link = absoluteSiteUrl(`/event/${event.slug}`);
      const title = deriveShortTitle(event.title);
      const description = truncateAtWordBoundary(event.summary, 400);
      const pubDate = new Date(event.firstPublishedAt).toUTCString();
      return [
        "<item>",
        `<title>${escapeXml(title)}</title>`,
        `<link>${escapeXml(link)}</link>`,
        `<guid isPermaLink="true">${escapeXml(link)}</guid>`,
        `<pubDate>${pubDate}</pubDate>`,
        `<description>${escapeXml(description)}</description>`,
        // Aggregation, not original reporting — stated per item so a
        // republisher reading only the feed still sees the disclosure that the
        // event page carries in visible text and structured data.
        `<dc:creator>${escapeXml(SITE.name)}</dc:creator>`,
        "</item>",
      ].join("");
    })
    .join("");

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:dc="http://purl.org/dc/elements/1.1/">',
    "<channel>",
    `<title>${escapeXml(feedTitle)}</title>`,
    `<link>${escapeXml(homeHref)}</link>`,
    `<description>${escapeXml(feedDescription)}</description>`,
    "<language>ro</language>",
    `<atom:link href="${escapeXml(selfHref)}" rel="self" type="application/rss+xml"/>`,
    `<lastBuildDate>${lastBuildDate}</lastBuildDate>`,
    // Readers and aggregators show the channel image next to the feed name;
    // without it the feed renders as an unbranded row.
    "<image>",
    `<url>${escapeXml(SITE.ogImage)}</url>`,
    `<title>${escapeXml(feedTitle)}</title>`,
    `<link>${escapeXml(homeHref)}</link>`,
    "</image>",
    // Matches the 600s cache-control below, so a polite reader's poll interval
    // and our edge cache agree.
    "<ttl>10</ttl>",
    items,
    "</channel>",
    "</rss>",
  ].join("");
}

export const Route = createFileRoute("/rss.xml")({
  server: {
    handlers: {
      HEAD: async () =>
        new Response(null, { status: 200, headers: buildRssHeaders() }),
      GET: async () => {
        const client = new ConvexHttpClient(convexUrl);
        let events: SyndicationEvent[] = [];
        try {
          events = await client.query(api.events.getSyndicationEvents, {
            limit: RSS_ITEM_LIMIT,
          });
        } catch (error) {
          console.error("Failed to load events for /rss.xml:", error);
        }

        return new Response(buildRssXml(events), {
          status: 200,
          headers: buildRssHeaders(),
        });
      },
    },
  },
});
