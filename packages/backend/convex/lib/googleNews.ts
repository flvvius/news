/**
 * Google News RSS helpers (BIV-103).
 *
 * Google News RSS items link to news.google.com wrapper URLs; the real
 * publisher URL is obtained via the DotsSplashUi batchexecute RPC. This
 * module is runtime-neutral (fetch only, no Node builtins) so both the
 * ingestion action (V8 runtime) and the enrichment extraction path
 * ("use node") can share it.
 */

export const GOOGLE_NEWS_HOST = "news.google.com";

/** Romanian catch-all discovery feed (BIV-103), gated by config. */
export const GOOGLE_NEWS_RO_FEED_URL =
  "https://news.google.com/rss?hl=ro&gl=RO&ceid=RO:ro";

const GOOGLE_NEWS_BATCH_URL =
  "https://news.google.com/_/DotsSplashUi/data/batchexecute?rpcids=Fbv4je";

const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36";

export function isGoogleNewsUrl(url: string): boolean {
  try {
    return new URL(url).hostname === GOOGLE_NEWS_HOST;
  } catch {
    return false;
  }
}

export function getGoogleNewsArticleId(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.hostname !== GOOGLE_NEWS_HOST) return null;

    const parts = parsed.pathname.split("/").filter(Boolean);
    const markerIndex = parts.findIndex(
      (part) => part === "articles" || part === "read",
    );
    if (markerIndex < 0) return null;
    return parts[markerIndex + 1] ?? null;
  } catch {
    return null;
  }
}

async function fetchWrapperHtml(
  articleId: string,
  userAgent: string,
): Promise<string | null> {
  try {
    const response = await fetch(
      `https://news.google.com/rss/articles/${articleId}`,
      {
        redirect: "follow",
        signal: AbortSignal.timeout(8000),
        headers: {
          "User-Agent": userAgent,
          Accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        },
      },
    );
    if (!response.ok) return null;
    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.includes("html")) return null;
    return await response.text();
  } catch {
    return null;
  }
}

/**
 * Resolve a news.google.com wrapper URL to the canonical publisher URL.
 * Returns null when the URL is not a Google News wrapper or resolution
 * fails (callers decide whether to keep or drop the item).
 */
export async function resolveGoogleNewsUrl(
  url: string,
  userAgent: string = DEFAULT_USER_AGENT,
): Promise<string | null> {
  const articleId = getGoogleNewsArticleId(url);
  if (!articleId) return null;

  const wrapperHtml = await fetchWrapperHtml(articleId, userAgent);
  if (!wrapperHtml) return null;

  const timestamp = wrapperHtml.match(/data-n-a-ts="(\d+)"/)?.[1];
  const signature = wrapperHtml.match(/data-n-a-sg="([^"]+)"/)?.[1];
  if (!timestamp || !signature) return null;

  const payload = [[[
    "Fbv4je",
    JSON.stringify([
      "garturlreq",
      [
        [
          "ro-RO",
          "RO",
          ["FINANCE_TOP_INDICES", "WEB_TEST_1_0_0"],
          null,
          null,
          1,
          1,
          "RO:ro",
          null,
          1,
          null,
          null,
          null,
          null,
          null,
          0,
          1,
        ],
        "ro-RO",
        "RO",
        1,
        [2, 3, 4, 8],
        1,
        0,
        "655000234",
        0,
        0,
        null,
        0,
      ],
      articleId,
      Number(timestamp),
      signature,
    ]),
    null,
    "generic",
  ]]];

  try {
    const response = await fetch(GOOGLE_NEWS_BATCH_URL, {
      method: "POST",
      signal: AbortSignal.timeout(8000),
      headers: {
        "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
        "User-Agent": userAgent,
        Referer: "https://news.google.com/",
        "Accept-Language": "ro-RO,ro;q=0.9,en;q=0.8",
      },
      body: `f.req=${encodeURIComponent(JSON.stringify(payload))}`,
    });

    if (!response.ok) return null;

    const text = await response.text();
    const decodedChunk = text.split("\n\n")[1];
    if (!decodedChunk) return null;

    const parsed = JSON.parse(decodedChunk) as unknown[];
    const wrappedResult = (parsed as unknown[][]).find(
      (entry) => Array.isArray(entry) && entry[0] === "wrb.fr",
    );
    const rawPayload = wrappedResult?.[2];
    if (typeof rawPayload !== "string") return null;

    const decoded = JSON.parse(rawPayload) as unknown[];
    const resolvedUrl = decoded[1];
    if (typeof resolvedUrl !== "string") return null;
    // Fail closed: the resolved value is handed straight to downstream
    // fetches, so only expose a well-formed http(s) publisher URL.
    try {
      const parsed = new URL(resolvedUrl);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        return null;
      }
    } catch {
      return null;
    }
    return resolvedUrl;
  } catch {
    return null;
  }
}
