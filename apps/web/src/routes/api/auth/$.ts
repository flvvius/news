import { handler } from "@/lib/auth-server";
import { createFileRoute } from "@tanstack/react-router";

const AUTH_POST_GUARD_PATHS = new Set([
  "/api/auth/sign-up/email",
  "/api/auth/send-verification-email",
]);

const KNOWN_SCRAPER_UA_PATTERNS = [
  "python-requests",
  "python-urllib",
  "curl/",
  "wget/",
  "scrapy",
  "aiohttp",
  "go-http-client",
  "libwww-perl",
  "postmanruntime",
  "insomnia",
  "axios",
  "node-fetch",
];

function isSuspiciousAuthRequest(request: Request) {
  if (request.method !== "POST") {
    return false;
  }

  const { pathname, origin } = new URL(request.url);
  if (!AUTH_POST_GUARD_PATHS.has(pathname)) {
    return false;
  }

  const userAgent = request.headers.get("user-agent")?.trim().toLowerCase() ?? "";
  if (!userAgent) {
    return true;
  }

  if (KNOWN_SCRAPER_UA_PATTERNS.some((pattern) => userAgent.includes(pattern))) {
    return true;
  }

  const referer = request.headers.get("referer")?.trim();
  if (!referer) {
    return false;
  }

  return !(
    referer.startsWith(origin) ||
    referer.startsWith("http://localhost:3001") ||
    referer.startsWith("http://127.0.0.1:3001")
  );
}

function forbiddenBotResponse() {
  return new Response(
    JSON.stringify({ error: "Request blocked." }),
    {
      status: 403,
      headers: { "content-type": "application/json; charset=utf-8" },
    },
  );
}

export const Route = createFileRoute("/api/auth/$")({
  server: {
    handlers: {
      GET: ({ request }) => handler(request),
      POST: ({ request }) =>
        isSuspiciousAuthRequest(request)
          ? forbiddenBotResponse()
          : handler(request),
    },
  },
});
