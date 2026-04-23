"use node";

type ExtractionMethod =
  | "article"
  | "main"
  | "selector"
  | "body"
  | "jsonld"
  | "meta"
  | "rss_fallback";

export type ExtractedArticleContent = {
  embeddingText: string;
  summary: string | undefined;
  method: ExtractionMethod;
  bodyChars: number;
  fetchSucceeded: boolean;
  resolvedUrl?: string;
};

const EXTRACTION_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36";
const FETCH_TIMEOUT_MS = 8000;
const MIN_EXTRACTED_BODY_CHARS = 350;
const MAX_BODY_CHARS = 6000;
const MAX_EMBEDDING_CHARS = 5000;
const MAX_SUMMARY_CHARS = 320;
const PRIORITY_PATTERNS = [
  /<article\b[\s\S]*?<\/article>/gi,
  /<main\b[\s\S]*?<\/main>/gi,
  /<(div|section)\b[^>]*(?:itemprop=["']articleBody["']|data-testid=["']article-body["']|class=["'][^"']*(?:article-body|story-body|entry-content|post-content|article__content|story-content)[^"']*["'])[^>]*>[\s\S]*?<\/\1>/gi,
];
const GOOGLE_NEWS_HOST = "news.google.com";
const GOOGLE_NEWS_BATCH_URL =
  "https://news.google.com/_/DotsSplashUi/data/batchexecute?rpcids=Fbv4je";
const GOOGLE_REFERER = "https://news.google.com/";
const GOOGLE_SEARCH_REFERER = "https://www.google.com/";
const BLOCKED_PAGE_PATTERNS = [
  /please enable js/i,
  /disable (?:your )?ad blocker/i,
  /access denied/i,
  /request unsuccessful/i,
  /verify you are human/i,
  /captcha/i,
  /bot detection/i,
];

type FetchAttempt = {
  name: string;
  headers: Record<string, string>;
};

type FetchResult = {
  ok: boolean;
  html?: string;
  finalUrl?: string;
  attemptName?: string;
};

function normalizeWhitespace(text: string): string {
  return text
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function summarizeBody(text: string): string | undefined {
  const cleaned = normalizeWhitespace(text);
  if (!cleaned) return undefined;
  if (cleaned.length <= MAX_SUMMARY_CHARS) return cleaned;

  const slice = cleaned.slice(0, MAX_SUMMARY_CHARS);
  const boundary = Math.max(
    slice.lastIndexOf(". "),
    slice.lastIndexOf("; "),
    slice.lastIndexOf(", "),
    slice.lastIndexOf(" "),
  );
  const trimmed = (boundary > MAX_SUMMARY_CHARS * 0.6 ? slice.slice(0, boundary) : slice)
    .trim()
    .replace(/[,:;.\s]+$/g, "");
  return trimmed ? `${trimmed}.` : undefined;
}

function firstNonEmpty(values: Array<string | undefined>): string | undefined {
  for (const value of values) {
    const cleaned = normalizeWhitespace(value ?? "");
    if (cleaned) return cleaned;
  }
  return undefined;
}

function buildEmbeddingText(title: string, bodyText: string, rssSnippet: string): string {
  const parts = [normalizeWhitespace(title)];
  const preferredBody = normalizeWhitespace(bodyText).slice(0, MAX_BODY_CHARS);
  const fallbackSnippet = normalizeWhitespace(rssSnippet);

  if (preferredBody.length >= MIN_EXTRACTED_BODY_CHARS) {
    parts.push(preferredBody);
  } else if (fallbackSnippet) {
    parts.push(fallbackSnippet);
  }

  return parts.join("\n\n").slice(0, MAX_EMBEDDING_CHARS);
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) =>
      String.fromCharCode(parseInt(code, 16)),
    );
}

function getHostname(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function isLikelyBlockedHtml(html: string): boolean {
  const sample = html.slice(0, 4000);
  return BLOCKED_PAGE_PATTERNS.some((pattern) => pattern.test(sample));
}

function getBaseBrowserHeaders(): Record<string, string> {
  return {
    "User-Agent": EXTRACTION_USER_AGENT,
    Accept:
      "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Cache-Control": "no-cache",
    Pragma: "no-cache",
    "Upgrade-Insecure-Requests": "1",
    "Sec-Fetch-Site": "none",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-User": "?1",
    "Sec-Fetch-Dest": "document",
  };
}

function buildFetchAttempts(url: string, preferGoogleReferer: boolean): FetchAttempt[] {
  const base = getBaseBrowserHeaders();
  const hostname = getHostname(url);
  const attempts: FetchAttempt[] = [
    {
      name: "browser-default",
      headers: base,
    },
  ];

  if (preferGoogleReferer) {
    attempts.push({
      name: "browser-google-referer",
      headers: {
        ...base,
        Referer: GOOGLE_REFERER,
      },
    });
  }

  if (hostname.endsWith("reuters.com")) {
    attempts.push(
      {
        name: "reuters-google-search-referer",
        headers: {
          ...base,
          Referer: GOOGLE_SEARCH_REFERER,
          Origin: "https://www.google.com",
        },
      },
      {
        name: "reuters-mobile",
        headers: {
          ...base,
          "User-Agent":
            "Mozilla/5.0 (iPhone; CPU iPhone OS 18_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.3 Mobile/15E148 Safari/604.1",
          Referer: GOOGLE_SEARCH_REFERER,
        },
      },
    );
  }

  if (
    hostname.endsWith("apnews.com") ||
    hostname.endsWith("politico.com") ||
    hostname.endsWith("cnn.com")
  ) {
    attempts.push({
      name: "browser-google-search-referer",
      headers: {
        ...base,
        Referer: GOOGLE_SEARCH_REFERER,
      },
    });
  }

  return attempts;
}

function stripNoise(html: string): string {
  return html
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<svg\b[\s\S]*?<\/svg>/gi, " ")
    .replace(
      /<(aside|nav|footer|header|form|button)\b[\s\S]*?<\/\1>/gi,
      " ",
    )
    .replace(
      /<(div|section)\b[^>]*(?:advertisement|social-share|newsletter|related|ad-slot|promo)[^>]*>[\s\S]*?<\/\1>/gi,
      " ",
    );
}

function stripTags(html: string): string {
  return normalizeWhitespace(
    decodeHtmlEntities(
      html
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<\/p>/gi, "\n\n")
        .replace(/<[^>]+>/g, " "),
    ),
  );
}

function extractJsonLdText(html: string): string | undefined {
  const scripts = Array.from(
    html.matchAll(
      /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
    ),
  );
  const collected: string[] = [];

  const collectFields = (value: unknown) => {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      for (const item of value) collectFields(item);
      return;
    }

    const record = value as Record<string, unknown>;
    for (const key of ["articleBody", "description", "abstract"]) {
      const field = record[key];
      if (typeof field === "string") {
        const cleaned = stripTags(field);
        if (cleaned.length >= 80) {
          collected.push(cleaned);
        }
      }
    }

    if (record["@graph"]) collectFields(record["@graph"]);
    if (record.mainEntity) collectFields(record.mainEntity);
  };

  for (const script of scripts) {
    const raw = decodeHtmlEntities(script[1] ?? "").trim();
    if (!raw) continue;

    try {
      collectFields(JSON.parse(raw));
    } catch {
      continue;
    }
  }

  const best = collected.sort((a, b) => b.length - a.length)[0];
  return best ? normalizeWhitespace(best) : undefined;
}

function extractParagraphText(html: string): string {
  const paragraphs = Array.from(html.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi))
    .map((match) => stripTags(match[1] ?? ""))
    .filter((text) => text.length >= 40);

  const deduped = Array.from(new Set(paragraphs));
  if (deduped.length > 0) {
    return deduped.join("\n\n");
  }

  return stripTags(html);
}

function scoreHtmlBlock(html: string): number {
  const text = extractParagraphText(html);
  const paragraphCount = (html.match(/<p\b/gi) ?? []).length;
  const headingCount = (html.match(/<h[123]\b/gi) ?? []).length;
  const linkCount = (html.match(/<a\b/gi) ?? []).length;

  return (
    Math.min(text.length, 5000) * 0.01 +
    paragraphCount * 20 +
    headingCount * 5 -
    linkCount * 2
  );
}

function getMetaContent(
  html: string,
  attribute: "property" | "name",
  value: string,
): string | undefined {
  const patterns = [
    new RegExp(
      `<meta[^>]*${attribute}=["']${value}["'][^>]*content=["']([^"']+)["'][^>]*>`,
      "i",
    ),
    new RegExp(
      `<meta[^>]*content=["']([^"']+)["'][^>]*${attribute}=["']${value}["'][^>]*>`,
      "i",
    ),
  ];

  for (const pattern of patterns) {
    const cleaned = firstNonEmpty([pattern.exec(html)?.[1]]);
    if (cleaned) return cleaned;
  }
  return undefined;
}

function chooseBestContentBlock(html: string): {
  text: string;
  method: ExtractionMethod;
} {
  const cleanedHtml = stripNoise(html);

  for (const pattern of PRIORITY_PATTERNS) {
    const matches = Array.from(cleanedHtml.matchAll(pattern));
    for (const match of matches) {
      const text = extractParagraphText(match[0]);
      if (text.length >= MIN_EXTRACTED_BODY_CHARS) {
        const raw = match[0].toLowerCase();
        return {
          text,
          method: raw.startsWith("<article")
            ? "article"
            : raw.startsWith("<main")
              ? "main"
              : "selector",
        };
      }
    }
  }

  const candidates = Array.from(
    cleanedHtml.matchAll(/<(article|main|section|div)\b[\s\S]*?<\/\1>/gi),
  )
    .map((match) => ({ html: match[0], score: scoreHtmlBlock(match[0]) }))
    .sort((a, b) => b.score - a.score);

  const best = candidates[0]?.html ?? cleanedHtml;
  const bestText = extractParagraphText(best);
  if (bestText.length >= MIN_EXTRACTED_BODY_CHARS) {
    return {
      text: bestText,
      method: "body",
    };
  }

  const jsonLdText = extractJsonLdText(cleanedHtml);
  if (jsonLdText && jsonLdText.length >= MIN_EXTRACTED_BODY_CHARS) {
    return {
      text: jsonLdText,
      method: "jsonld",
    };
  }

  return {
    text: bestText,
    method: "body",
  };
}

function extractMetaDescription(html: string): string | undefined {
  return firstNonEmpty([
    getMetaContent(html, "property", "og:description"),
    getMetaContent(html, "name", "description"),
  ]);
}

async function fetchHtml(
  url: string,
  preferGoogleReferer = false,
): Promise<FetchResult> {
  const attempts = buildFetchAttempts(url, preferGoogleReferer);
  let lastHtmlResult: FetchResult | null = null;

  for (const attempt of attempts) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    try {
      const response = await fetch(url, {
        redirect: "follow",
        signal: controller.signal,
        headers: attempt.headers,
      });

      if (!response.ok) {
        continue;
      }

      const contentType = response.headers.get("content-type") ?? "";
      if (!contentType.includes("html")) {
        continue;
      }

      const html = await response.text();
      const result: FetchResult = {
        ok: !isLikelyBlockedHtml(html),
        html,
        finalUrl: response.url,
        attemptName: attempt.name,
      };

      if (result.ok) {
        return result;
      }

      lastHtmlResult = result;
    } catch {
      // Try the next fetch profile.
    } finally {
      clearTimeout(timeout);
    }
  }

  return lastHtmlResult ?? { ok: false };
}

function getGoogleNewsArticleId(url: string): string | null {
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

async function resolveGoogleNewsUrl(url: string): Promise<string | null> {
  const articleId = getGoogleNewsArticleId(url);
  if (!articleId) return null;

  const wrapperResponse = await fetchHtml(
    `https://news.google.com/rss/articles/${articleId}`,
  );
  if (!wrapperResponse.ok || !wrapperResponse.html) return null;

  const timestamp = wrapperResponse.html.match(/data-n-a-ts="(\d+)"/)?.[1];
  const signature = wrapperResponse.html.match(/data-n-a-sg="([^"]+)"/)?.[1];
  if (!timestamp || !signature) return null;

  const payload = [[[
    "Fbv4je",
    JSON.stringify([
      "garturlreq",
      [
        [
          "en-US",
          "US",
          ["FINANCE_TOP_INDICES", "WEB_TEST_1_0_0"],
          null,
          null,
          1,
          1,
          "US:en",
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
        "en-US",
        "US",
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
      headers: {
        "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
        "User-Agent": EXTRACTION_USER_AGENT,
        Referer: "https://news.google.com/",
        "Accept-Language": "en-US,en;q=0.9",
      },
      body: `f.req=${encodeURIComponent(JSON.stringify(payload))}`,
    });

    if (!response.ok) return null;

    const text = await response.text();
    const decodedChunk = text.split("\n\n")[1];
    if (!decodedChunk) return null;

    const parsed = JSON.parse(decodedChunk) as any[];
    const wrappedResult = parsed.find(
      (entry) => Array.isArray(entry) && entry[0] === "wrb.fr",
    );
    const rawPayload = wrappedResult?.[2];
    if (typeof rawPayload !== "string") return null;

    const decoded = JSON.parse(rawPayload) as unknown[];
    const resolvedUrl = typeof decoded[1] === "string" ? decoded[1] : null;
    return resolvedUrl;
  } catch {
    return null;
  }
}

export async function extractArticleContentForEmbedding(args: {
  title: string;
  url: string;
  rssSnippet: string;
}): Promise<ExtractedArticleContent> {
  const fallbackEmbeddingText = buildEmbeddingText(
    args.title,
    "",
    args.rssSnippet,
  );
  const fallbackSummary = summarizeBody(args.rssSnippet);
  const resolvedUrl = (await resolveGoogleNewsUrl(args.url)) ?? args.url;
  const fetched = await fetchHtml(resolvedUrl, resolvedUrl !== args.url);

  if (!fetched.ok || !fetched.html) {
    const blockedMetaDescription = fetched.html
      ? extractMetaDescription(fetched.html)
      : undefined;
    return {
      embeddingText: buildEmbeddingText(
        args.title,
        "",
        blockedMetaDescription ?? args.rssSnippet,
      ),
      summary: summarizeBody(
        blockedMetaDescription ?? args.rssSnippet,
      ) ?? fallbackSummary,
      method: blockedMetaDescription ? "meta" : "rss_fallback",
      bodyChars: 0,
      fetchSucceeded: false,
      resolvedUrl: resolvedUrl !== args.url ? resolvedUrl : undefined,
    };
  }

  try {
    const { text: extractedText, method } = chooseBestContentBlock(fetched.html);
    const metaDescription = extractMetaDescription(fetched.html);

    const normalizedBody = normalizeWhitespace(extractedText).slice(0, MAX_BODY_CHARS);
    const bodyChars = normalizedBody.length;
    const strongBody =
      bodyChars >= MIN_EXTRACTED_BODY_CHARS ? normalizedBody : "";

    return {
      embeddingText: buildEmbeddingText(
        args.title,
        strongBody,
        metaDescription ?? args.rssSnippet,
      ),
      summary: summarizeBody(
        strongBody || metaDescription || args.rssSnippet,
      ),
      method:
        strongBody.length > 0
          ? method
          : metaDescription
            ? "meta"
            : "rss_fallback",
      bodyChars,
      fetchSucceeded: true,
      resolvedUrl:
        fetched.finalUrl && fetched.finalUrl !== args.url
          ? fetched.finalUrl
          : resolvedUrl !== args.url
            ? resolvedUrl
            : undefined,
    };
  } catch {
    return {
      embeddingText: fallbackEmbeddingText,
      summary: fallbackSummary,
      method: "rss_fallback",
      bodyChars: 0,
      fetchSucceeded: true,
      resolvedUrl: resolvedUrl !== args.url ? resolvedUrl : undefined,
    };
  }
}
