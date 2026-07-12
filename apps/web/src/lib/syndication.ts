// Shared helpers for the web syndication routes (rss.xml, sitemap.xml,
// news-sitemap.xml). Kept in one place so the XML-escaping order and the
// event shape stay identical across feeds.

/** Escape the five XML special characters. Order matters: `&` first. */
export function escapeXml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

/** Shape returned by `api.events.getSyndicationEvents`. */
export type SyndicationEvent = {
  slug: string;
  title: string;
  summary: string;
  firstPublishedAt: number;
  lastUpdatedAt: number;
};
