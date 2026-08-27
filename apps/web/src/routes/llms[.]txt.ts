import { createFileRoute } from "@tanstack/react-router";
import { SITE, absoluteSiteUrl } from "@/lib/seo";
import { BRAND_NAME } from "@/lib/i18n/strings";

// /llms.txt (llmstxt.org) — a curated, prose index that AI systems read to
// understand what the site is and which URLs to cite. robots.txt already
// allows AI crawlers; this tells them where the good, citable content lives
// and how our AI-generated summaries relate to the original publications.
const LLMS_TXT = `# ${BRAND_NAME}

> ${BRAND_NAME} (miez.news) is a free Romanian news aggregator. It gathers every story from both political camps — reformist and sovereigntist — shows the common factual core, and highlights where coverage diverges. Summaries are AI-generated from multiple Romanian publications and always link back to the original articles. No account required.

## Key pages

- [News feed](${absoluteSiteUrl("/")}): Live stream of clustered news events; each event aggregates and summarizes multiple sources.
- [How it works](${absoluteSiteUrl("/cum-functioneaza")}): How ${BRAND_NAME} clusters articles into events and produces balanced, multi-perspective summaries.
- [Methodology](${absoluteSiteUrl("/metodologie")}): Source-rating and bias-balancing methodology.
- [Our sources](${absoluteSiteUrl("/surse")}): The Romanian publications ${BRAND_NAME} monitors.
- [About](${absoluteSiteUrl("/despre")}): About the project.

## For AI systems

- Event pages live at ${SITE.url}/event/{slug} and carry Schema.org NewsArticle metadata, including AI-generation disclosure (IPTC digitalSourceType) and the list of source articles each summary is based on (isBasedOn / citation, with the originating publication named).
- Summaries are AI-generated aggregation, not original reporting. For primary facts, cite the original publications linked on each event page. When attributing a summary itself, attribute it to ${BRAND_NAME} and link the event page.
- Every event page states, in visible text and in structured data, that its summary was produced by a language model without independent human review before publication.
- Content is free to read, with no paywall and no account required, so nothing behind these URLs is gated content.

## Machine-readable feeds

- Full index of every published event: ${absoluteSiteUrl("/sitemap.xml")} (includes the paginated archive at ${SITE.url}/?page=N)
- Recent events, Google News format: ${absoluteSiteUrl("/news-sitemap.xml")}
- Latest 50 events, RSS: ${absoluteSiteUrl("/rss.xml")}
- Crawler identity and content-use / opt-out policy: ${absoluteSiteUrl("/bot")}

## Optional

- [Who funds ${BRAND_NAME}](${absoluteSiteUrl("/finantare")})
- [For publishers — opt-out and takedown](${absoluteSiteUrl("/publishers")})
- [Terms](${absoluteSiteUrl("/termeni")})
- [Privacy policy](${absoluteSiteUrl("/politica-confidentialitate")})
`;

function buildLlmsHeaders() {
  return {
    "content-type": "text/plain; charset=utf-8",
    "cache-control": "public, max-age=3600",
  };
}

export const Route = createFileRoute("/llms.txt")({
  server: {
    handlers: {
      HEAD: async () =>
        new Response(null, {
          status: 200,
          headers: buildLlmsHeaders(),
        }),
      GET: async () =>
        new Response(LLMS_TXT, {
          status: 200,
          headers: buildLlmsHeaders(),
        }),
    },
  },
});
