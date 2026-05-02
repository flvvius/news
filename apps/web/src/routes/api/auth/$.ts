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

type OriginParts = {
  protocol: string;
  hostname: string;
  port: string;
};

function normalizeOriginParts(url: URL): OriginParts {
  const port =
    url.port ||
    (url.protocol === "https:" ? "443" : url.protocol === "http:" ? "80" : "");
  return { protocol: url.protocol, hostname: url.hostname, port };
}

function matchesAllowedOrigin(value: string, allowed: OriginParts[]) {
  try {
    const parsed = normalizeOriginParts(new URL(value));
    return allowed.some(
      (allowedOrigin) =>
        allowedOrigin.protocol === parsed.protocol &&
        allowedOrigin.hostname === parsed.hostname &&
        allowedOrigin.port === parsed.port,
    );
  } catch {
    return false;
  }
}

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

  const allowedOrigins = [
    normalizeOriginParts(new URL(origin)),
    normalizeOriginParts(new URL("http://localhost:3001")),
    normalizeOriginParts(new URL("http://127.0.0.1:3001")),
  ];
  const originHeader = request.headers.get("origin")?.trim();
  const referer = request.headers.get("referer")?.trim();
  if (!originHeader && !referer) {
    return true;
  }

  if (originHeader && !matchesAllowedOrigin(originHeader, allowedOrigins)) {
    return true;
  }

  if (referer && !matchesAllowedOrigin(referer, allowedOrigins)) {
    return true;
  }

  if (originHeader && referer) {
    try {
      const originParts = normalizeOriginParts(new URL(originHeader));
      const refererParts = normalizeOriginParts(new URL(referer));
      if (
        originParts.protocol !== refererParts.protocol ||
        originParts.hostname !== refererParts.hostname ||
        originParts.port !== refererParts.port
      ) {
        return true;
      }
    } catch {
      return true;
    }
  }

  return false;
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
