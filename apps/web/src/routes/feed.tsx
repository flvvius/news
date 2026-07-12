import { createFileRoute } from "@tanstack/react-router";

// SEO-1: the feed now renders at the root URL (/). /feed is kept only as a
// permanent (308) redirect so old links, bookmarks and previously indexed
// URLs resolve to the canonical root. Query params (e.g. the ?page=N archive)
// are preserved: /feed?page=2 -> /?page=2. 308 (not 307/301) keeps the method
// and tells crawlers the move is permanent so they transfer signals to /.
function buildRedirectResponse(url: string) {
  const search = new URL(url).search;
  return new Response(null, {
    status: 308,
    headers: {
      location: `/${search}`,
      "cache-control": "public, max-age=3600",
    },
  });
}

export const Route = createFileRoute("/feed")({
  server: {
    handlers: {
      HEAD: ({ request }) => buildRedirectResponse(request.url),
      GET: ({ request }) => buildRedirectResponse(request.url),
    },
  },
});
