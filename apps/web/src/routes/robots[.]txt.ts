import { createFileRoute } from "@tanstack/react-router";
import { absoluteSiteUrl } from "@/lib/seo";

const ROBOTS_TXT = `User-agent: *
Allow: /

Disallow: /dashboard
Disallow: /api/
Disallow: /unsubscribe

Sitemap: ${absoluteSiteUrl("/sitemap.xml")}
`;

function buildRobotsHeaders() {
  return {
    "content-type": "text/plain; charset=utf-8",
    "cache-control": "public, max-age=900",
  };
}

export const Route = createFileRoute("/robots.txt")({
  server: {
    handlers: {
      HEAD: async () =>
        new Response(null, {
          status: 200,
          headers: buildRobotsHeaders(),
        }),
      GET: async () =>
        new Response(ROBOTS_TXT, {
          status: 200,
          headers: buildRobotsHeaders(),
        }),
    },
  },
});
