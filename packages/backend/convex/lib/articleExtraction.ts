"use node";

import { normalizeRomanianDiacritics } from "./romanian";
import { resolveGoogleNewsUrl } from "./googleNews";
import { verifyImageUrl, type ImageUrlVerdict } from "./imageVerification";
import { BOT_USER_AGENT, botFetchHeaders } from "./botIdentity";
import { politeFetch } from "./politeFetch";

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
  imageUrl?: string;
  imageWidth?: number;
  imageHeight?: number;
  imageAlt?: string;
  imageSource?: "og" | "twitter" | "jsonld" | "inline";
  entities: string[];
  extractionQuality: "strong" | "weak";
};

// L6: honest crawler identity on every fetch — no browser masquerading.
const EXTRACTION_USER_AGENT = BOT_USER_AGENT;
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
const BLOCKED_PAGE_PATTERNS = [
  /please enable js/i,
  /disable (?:your )?ad blocker/i,
  /access denied/i,
  /request unsuccessful/i,
  /verify you are human/i,
  /captcha/i,
  /bot detection/i,
];

type NormalizedEntityCandidate = {
  value: string;
  wasAllUppercase: boolean;
};

const ENTITY_MAX_TEXT_CHARS = 6000;
const ENTITY_MAX_COUNT = 32;
const ENTITY_NOISE_TERMS = new Set([
  "after",
  "all",
  "also",
  "and",
  "before",
  "by",
  "dinner",
  "enough",
  "ever",
  "however",
  "hours",
  "live",
  "many",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
  "over",
  "people",
  "running",
  "that",
  "there",
  "this",
  "tickets",
  "typically",
  "watch",
]);
const WEEKDAY_ENTITY_NOISE_TERMS = new Set([
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
  "luni",
  "marți",
  "marti",
  "miercuri",
  "joi",
  "vineri",
  "sâmbătă",
  "sambata",
  "duminică",
  "duminica",
]);
const ENTITY_ROLE_PREFIXES = [
  "former",
  "president",
  "prime minister",
  "rep",
  "sen",
  "dr",
  "fostul",
  "fosta",
  "președintele",
  "presedintele",
  "premierul",
  "prim-ministrul",
  "ministrul",
  "senatorul",
  "deputatul",
  "europarlamentarul",
  "primarul",
  "liderul",
];
const NUMERIC_ENTITY_PATTERN =
  /\$\d[\d,.]*(?:\s?(?:billion|million|trillion))?|\b\d+(?:\.\d+)?%|\b\d+(?:st|nd|rd|th)\b/gi;

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
  // Diacritic normalization rides along here so every extracted field
  // (body text, summaries, meta descriptions, entities) reads normalized
  // before embedding, clustering, or any LLM call.
  return normalizeRomanianDiacritics(text)
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

function normalizeEntityCandidate(value: string): NormalizedEntityCandidate {
  const cleaned = normalizeWhitespace(value).replace(
    /^[^\p{L}\p{N}$]+|[^\p{L}\p{N}%]+$/gu,
    "",
  );
  const letters = cleaned.match(/\p{L}/gu) ?? [];
  const wasAllUppercase =
    letters.length > 0 &&
    letters.every((letter) => letter === letter.toUpperCase());
  let entity = cleaned.toLowerCase();

  for (const prefix of ENTITY_ROLE_PREFIXES) {
    if (entity === prefix) return { value: "", wasAllUppercase };
    if (entity.startsWith(`${prefix} `)) {
      entity = entity.slice(prefix.length + 1).trim();
      break;
    }
  }

  return { value: entity, wasAllUppercase };
}

function isUsefulEntityCandidate(
  entity: string,
  count: number,
  titleEntities: Set<string>,
  allUppercaseEntities: Set<string>,
  numericEntities: Set<string>,
): boolean {
  if (entity.length < 3 || entity.length > 80) return false;
  if (!/[\p{Ll}\p{N}]/u.test(entity)) return false;
  // Reject runs of single letters ("a b c"); the old ASCII version of this
  // check accidentally rejected every all-lowercase entity.
  if (/^\p{Ll}(?:\s+\p{Ll})*$/u.test(entity)) return false;

  const words = entity.split(/\s+/).filter(Boolean);
  if (words.length === 0 || words.length > 7) return false;
  if (
    words.length === 1 &&
    (ENTITY_NOISE_TERMS.has(entity) || WEEKDAY_ENTITY_NOISE_TERMS.has(entity))
  ) {
    return false;
  }
  if (
    words.length > 1 &&
    words.some(
      (word) =>
        ENTITY_NOISE_TERMS.has(word) &&
        !WEEKDAY_ENTITY_NOISE_TERMS.has(word),
    )
  ) {
    return false;
  }
  if (ENTITY_NOISE_TERMS.has(entity)) return false;

  if (words.length === 1) {
    return (
      numericEntities.has(entity) ||
      titleEntities.has(entity) ||
      count > 1 ||
      (/^[a-z]{2,6}$/.test(entity.toLowerCase()) &&
        allUppercaseEntities.has(entity))
    );
  }

  return true;
}

function addNumericEntities(
  text: string,
  scores: Map<string, number>,
  numericEntities: Set<string>,
  weight: number,
) {
  const numericMatches = text.match(NUMERIC_ENTITY_PATTERN) ?? [];
  for (const match of numericMatches) {
    const normalized = normalizeEntityCandidate(match).value;
    if (normalized.length >= 2) {
      scores.set(normalized, (scores.get(normalized) ?? 0) + weight);
      numericEntities.add(normalized);
    }
  }
}

// Capitalized-run entity matcher (BIV-601). Replaces the former wink-nlp
// PROPN tagger, whose English-only model produced garbage on Romanian text.
// Matches runs of capitalized words optionally joined by Romanian/English
// name connectors ("Curtea de Apel București", "Bank of America").
const PROPER_NOUN_CONNECTOR =
  "(?:de|din|al|ale|a|la|lui|pe|sub|și|si|of|the|and|for|in|on|to)";
// Digits are allowed inside words (Digi24, G4Media) and as standalone
// continuation tokens (Antena 3, Formula 1).
const PROPER_NOUN_WORD = "\\p{Lu}[\\p{L}\\p{N}'’.-]*";
const PROPER_NOUN_CONTINUATION = `(?:${PROPER_NOUN_WORD}|\\p{N}+)`;
const PROPER_NOUN_SEQUENCE = new RegExp(
  `${PROPER_NOUN_WORD}(?:\\s+(?:${PROPER_NOUN_CONNECTOR}\\s+)?${PROPER_NOUN_CONTINUATION}){0,4}`,
  "gu",
);

function collectProperNounCandidates(
  text: string,
  scores: Map<string, number>,
  titleEntities: Set<string>,
  allUppercaseEntities: Set<string>,
  weight: number,
) {
  const sample = text.slice(0, ENTITY_MAX_TEXT_CHARS);
  const matches = sample.match(PROPER_NOUN_SEQUENCE) ?? [];

  for (const match of matches) {
    const normalized = normalizeEntityCandidate(match);
    if (normalized.value) {
      scores.set(normalized.value, (scores.get(normalized.value) ?? 0) + weight);
      if (normalized.wasAllUppercase) allUppercaseEntities.add(normalized.value);
      // Only proper nouns collected from the title get title-entity priority.
      // Body matches use lower weights and must earn their way in by repetition.
      if (weight >= 3) titleEntities.add(normalized.value);
    }
  }
}

export function extractEntityCandidates(
  title: string,
  ...texts: string[]
): string[] {
  const scores = new Map<string, number>();
  const titleEntities = new Set<string>();
  const allUppercaseEntities = new Set<string>();
  const numericEntities = new Set<string>();
  const cleanedTitle = stripTags(title);

  collectProperNounCandidates(
    cleanedTitle,
    scores,
    titleEntities,
    allUppercaseEntities,
    3,
  );
  addNumericEntities(cleanedTitle, scores, numericEntities, 3);

  for (const rawText of texts) {
    const text = stripTags(rawText);
    if (!text) continue;
    collectProperNounCandidates(
      text,
      scores,
      titleEntities,
      allUppercaseEntities,
      1,
    );
    addNumericEntities(text, scores, numericEntities, 1);
  }

  return Array.from(scores.entries())
    .filter(([entity, score]) =>
      isUsefulEntityCandidate(
        entity,
        score,
        titleEntities,
        allUppercaseEntities,
        numericEntities,
      ),
    )
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([entity]) => entity)
    .slice(0, ENTITY_MAX_COUNT);
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

/**
 * L6: one honest fetch profile. The pre-compliance code rotated browser
 * header disguises (Chrome UA, spoofed Google referers, a fake iPhone UA
 * for Reuters) to get past bot checks — the opposite of provable good-faith
 * crawling. If a publisher blocks MiezBot, we take the RSS fallback.
 */
function buildFetchAttempts(): FetchAttempt[] {
  return [
    {
      name: "miezbot",
      headers: botFetchHeaders({
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "ro-RO,ro;q=0.9,en;q=0.8",
      }),
    },
  ];
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

function parseJsonLdScripts(html: string): unknown[] {
  const scripts = Array.from(
    html.matchAll(
      /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
    ),
  );
  const parsed: unknown[] = [];

  for (const script of scripts) {
    const raw = decodeHtmlEntities(script[1] ?? "").trim();
    if (!raw) continue;

    try {
      parsed.push(JSON.parse(raw));
      continue;
    } catch {
      // Fall through to the sanitized retry.
    }

    // BIV-813: zf.ro (and others) emit raw newlines/tabs inside JSON string
    // literals — legal in HTML, illegal in JSON — so the NewsArticle block
    // holding the real articleBody failed to parse and extraction fell back
    // to a site-wide teaser widget shared by every page. Control characters
    // cannot appear in valid JSON strings, so replacing them with spaces is
    // lossless for well-formed documents and recovers the malformed ones.
    try {
      parsed.push(JSON.parse(raw.replace(/[\u0000-\u001f]+/g, " ")));
    } catch {
      continue;
    }
  }

  return parsed;
}

function collectJsonLdFields(
  documents: unknown[],
  keys: readonly string[],
): string[] {
  const collected: string[] = [];

  const collectFields = (value: unknown) => {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      for (const item of value) collectFields(item);
      return;
    }

    const record = value as Record<string, unknown>;
    for (const key of keys) {
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

  for (const doc of documents) collectFields(doc);
  return collected;
}

function longestOrUndefined(values: string[]): string | undefined {
  const best = values.sort((a, b) => b.length - a.length)[0];
  return best ? normalizeWhitespace(best) : undefined;
}

/**
 * The publisher-declared article body. Trustworthy when present: unlike
 * description/abstract (which can be site-wide marketing text), articleBody
 * is per-article by definition, so it may outrank generic block scoring.
 */
function extractJsonLdArticleBody(documents: unknown[]): string | undefined {
  return longestOrUndefined(collectJsonLdFields(documents, ["articleBody"]));
}

function extractJsonLdText(documents: unknown[]): string | undefined {
  return longestOrUndefined(
    collectJsonLdFields(documents, ["articleBody", "description", "abstract"]),
  );
}

/**
 * BIV-813: text living inside <a> tags is navigation, not prose. zf.ro's
 * "Articole recomandate" carousel renders every teaser as
 * <p><a class="title">headline…</a></p>, so by raw text volume it looked
 * like the article body on every page whose real body is script-rendered.
 */
function linkTextRatio(html: string): number {
  const total = stripTags(html);
  if (!total) return 0;
  const linkText = stripTags(
    (html.match(/<a\b[^>]*>[\s\S]*?<\/a>/gi) ?? []).join(" "),
  );
  return linkText.length / total.length;
}

function extractParagraphText(html: string): string {
  const paragraphs = Array.from(html.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi))
    .filter((match) => linkTextRatio(match[1] ?? "") <= 0.7)
    .map((match) => stripTags(match[1] ?? ""))
    .filter((text) => text.length >= 40);

  const deduped = Array.from(new Set(paragraphs));
  if (deduped.length > 0) {
    return deduped.join("\n\n");
  }

  // Blocks without usable <p> prose fall back to their whole text — but only
  // when that text isn't mostly link labels (menus, teaser carousels).
  return linkTextRatio(html) > 0.5 ? "" : stripTags(html);
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

function parseOptionalInteger(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function absolutizeUrl(candidate: string | undefined, baseUrl: string): string | undefined {
  if (!candidate) return undefined;
  try {
    return new URL(candidate, baseUrl).toString();
  } catch {
    return undefined;
  }
}

function isAvatarImagePath(pathname: string): boolean {
  const segments = pathname
    .toLowerCase()
    .split("/")
    .map((segment) => segment.trim())
    .filter(Boolean);
  return segments.some((segment, index) => {
    if (segment === "avatar") return true;
    if (index !== segments.length - 1) return false;
    return /^avatar(?:[-_.]|$)/.test(segment);
  });
}

function isLikelyValidImageUrl(url: string | undefined): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    if (!/^https?:$/.test(parsed.protocol)) return false;
    const path = parsed.pathname.toLowerCase();
    if (
      isAvatarImagePath(path) ||
      path.includes("author") ||
      path.includes("logo") ||
      path.includes("icon") ||
      path.includes("sprite") ||
      path.includes("pixel") ||
      path.includes("badge")
    ) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

function normalizeEscapedUrl(candidate: string | undefined): string | undefined {
  if (!candidate) return undefined;
  return candidate
    .replace(/\\u002F/gi, "/")
    .replace(/\\\//g, "/")
    .replace(/&amp;/gi, "&");
}

function scoreRawImageCandidate(url: string, hostname: string): number {
  let score = 0;
  const lower = url.toLowerCase();
  let pathname = "";
  try {
    pathname = new URL(url).pathname;
  } catch {
    pathname = url;
  }

  if (/\.(avif|jpe?g|png|webp)(?:$|\?)/i.test(lower)) score += 4;
  if (lower.includes("reutersmedia.net")) score += 6;
  if (lower.includes("assets.bwbx.io")) score += 6;
  if (lower.includes("bbci.co.uk")) score += 4;
  if (lower.includes("cdn.cnn.com")) score += 4;
  if (lower.includes("media.npr.org")) score += 4;
  if (lower.includes("image")) score += 1;
  if (lower.includes("photo")) score += 1;
  if (lower.includes("hero")) score += 2;
  if (lower.includes("lead")) score += 1;
  if (lower.includes("social")) score += 1;

  if (hostname.endsWith("reuters.com") && lower.includes("reuters")) score += 3;
  if (hostname.endsWith("bloomberg.com") && lower.includes("bwbx")) score += 3;

  if (
    lower.includes("logo") ||
    lower.includes("icon") ||
    lower.includes("sprite") ||
    isAvatarImagePath(pathname) ||
    lower.includes("author") ||
    lower.includes("thumbnail")
  ) {
    score -= 6;
  }

  return score;
}

function extractRawImageCandidates(html: string, baseUrl: string): string[] {
  const hostname = getHostname(baseUrl);
  const candidates = new Set<string>();

  const addCandidate = (candidate: string | undefined) => {
    const normalized = absolutizeUrl(normalizeEscapedUrl(candidate), baseUrl);
    if (!normalized || !isLikelyValidImageUrl(normalized)) return;
    candidates.add(normalized);
  };

  const urlPatterns = [
    /https?:\\\/\\\/[^"'\\\s>]+?\.(?:jpg|jpeg|png|webp|avif)(?:\?[^"'\\\s>]*)?/gi,
    /https?:\/\/[^"'\s>]+?\.(?:jpg|jpeg|png|webp|avif)(?:\?[^"'\s>]*)?/gi,
    /"image"\s*:\s*"([^"]+)"/gi,
    /"imageUrl"\s*:\s*"([^"]+)"/gi,
    /"thumbnailUrl"\s*:\s*"([^"]+)"/gi,
    /"url"\s*:\s*"(https?:[^"]+\.(?:jpg|jpeg|png|webp|avif)[^"]*)"/gi,
    /contentUrl"\s*:\s*"([^"]+)"/gi,
    /data-image-url=["']([^"']+)["']/gi,
    /srcset=["']([^"']+)["']/gi,
  ];

  for (const pattern of urlPatterns) {
    for (const match of html.matchAll(pattern)) {
      const raw = match[1] ?? match[0];
      if (!raw) continue;
      if (pattern.source.includes("srcset")) {
        const srcsetCandidates = raw
          .split(",")
          .map((part) => part.trim().split(/\s+/)[0])
          .filter(Boolean);
        for (const candidate of srcsetCandidates) addCandidate(candidate);
      } else {
        addCandidate(raw);
      }
    }
  }

  return Array.from(candidates).sort(
    (a, b) => scoreRawImageCandidate(b, hostname) - scoreRawImageCandidate(a, hostname),
  );
}

function extractJsonLdImage(html: string): {
  imageUrl?: string;
  imageWidth?: number;
  imageHeight?: number;
  imageAlt?: string;
} {
  const scripts = Array.from(
    html.matchAll(
      /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
    ),
  );

  const candidates: Array<{
    imageUrl?: string;
    imageWidth?: number;
    imageHeight?: number;
    imageAlt?: string;
  }> = [];

  const collectImage = (value: unknown) => {
    if (!value) return;
    if (typeof value === "string") {
      candidates.push({ imageUrl: value });
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) collectImage(item);
      return;
    }
    if (typeof value !== "object") return;

    const record = value as Record<string, unknown>;
    const url =
      typeof record.url === "string"
        ? record.url
        : typeof record.contentUrl === "string"
          ? record.contentUrl
          : typeof record["@id"] === "string"
            ? record["@id"]
            : undefined;

    candidates.push({
      imageUrl: url,
      imageWidth:
        typeof record.width === "number"
          ? record.width
          : parseOptionalInteger(
              typeof record.width === "string" ? record.width : undefined,
            ),
      imageHeight:
        typeof record.height === "number"
          ? record.height
          : parseOptionalInteger(
              typeof record.height === "string" ? record.height : undefined,
            ),
      imageAlt:
        typeof record.caption === "string"
          ? record.caption
          : typeof record.description === "string"
            ? record.description
            : undefined,
    });
  };

  const walk = (value: unknown) => {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      for (const item of value) walk(item);
      return;
    }
    const record = value as Record<string, unknown>;
    if (record.image) collectImage(record.image);
    if (record["@graph"]) walk(record["@graph"]);
    if (record.mainEntity) walk(record.mainEntity);
  };

  for (const script of scripts) {
    const raw = decodeHtmlEntities(script[1] ?? "").trim();
    if (!raw) continue;
    try {
      walk(JSON.parse(raw));
    } catch {
      continue;
    }
  }

  return candidates[0] ?? {};
}

function extractFirstInlineImage(html: string): {
  imageUrl?: string;
  imageWidth?: number;
  imageHeight?: number;
  imageAlt?: string;
} {
  const matches = Array.from(html.matchAll(/<img\b[^>]*>/gi));
  for (const match of matches) {
    const tag = match[0];
    const directSrc =
      tag.match(/\bsrc=["']([^"']+)["']/i)?.[1] ??
      tag.match(/\bdata-src=["']([^"']+)["']/i)?.[1] ??
      undefined;
    const width = parseOptionalInteger(
      tag.match(/\bwidth=["']?(\d+)["']?/i)?.[1],
    );
    const height = parseOptionalInteger(
      tag.match(/\bheight=["']?(\d+)["']?/i)?.[1],
    );
    const alt =
      tag.match(/\balt=["']([^"']+)["']/i)?.[1] ??
      tag.match(/\btitle=["']([^"']+)["']/i)?.[1] ??
      undefined;

    const imageUrl = directSrc;
    if (!isLikelyValidImageUrl(imageUrl)) continue;
    if ((width ?? 0) > 0 && (height ?? 0) > 0 && ((width ?? 0) < 300 || (height ?? 0) < 200)) {
      continue;
    }

    return {
      imageUrl,
      imageWidth: width,
      imageHeight: height,
      imageAlt: alt,
    };
  }

  return {};
}

export type ExtractedImageMetadata = {
  imageUrl?: string;
  imageWidth?: number;
  imageHeight?: number;
  imageAlt?: string;
  imageSource?: "og" | "twitter" | "jsonld" | "inline";
};

export function collectImageMetadataCandidates(
  html: string,
  baseUrl: string,
  fallbackAlt: string,
): ExtractedImageMetadata[] {
  const candidates: ExtractedImageMetadata[] = [];
  const seenUrls = new Set<string>();
  const addCandidate = (candidate: ExtractedImageMetadata) => {
    if (!candidate.imageUrl || seenUrls.has(candidate.imageUrl)) return;
    seenUrls.add(candidate.imageUrl);
    candidates.push(candidate);
  };

  const ogImage = absolutizeUrl(
    getMetaContent(html, "property", "og:image"),
    baseUrl,
  );
  const ogImageUrl = absolutizeUrl(
    getMetaContent(html, "property", "og:image:url"),
    baseUrl,
  );
  const normalizedOgImage = ogImage ?? ogImageUrl;
  if (isLikelyValidImageUrl(normalizedOgImage)) {
    addCandidate({
      imageUrl: normalizedOgImage,
      imageWidth: parseOptionalInteger(
        getMetaContent(html, "property", "og:image:width"),
      ),
      imageHeight: parseOptionalInteger(
        getMetaContent(html, "property", "og:image:height"),
      ),
      imageAlt:
        getMetaContent(html, "property", "og:image:alt") ??
        getMetaContent(html, "property", "og:title") ??
        fallbackAlt,
      imageSource: "og",
    });
  }

  const twitterImage = absolutizeUrl(
    getMetaContent(html, "name", "twitter:image"),
    baseUrl,
  );
  const twitterImageSrc = absolutizeUrl(
    getMetaContent(html, "name", "twitter:image:src"),
    baseUrl,
  );
  const normalizedTwitterImage = twitterImage ?? twitterImageSrc;
  if (isLikelyValidImageUrl(normalizedTwitterImage)) {
    addCandidate({
      imageUrl: normalizedTwitterImage,
      imageAlt:
        getMetaContent(html, "name", "twitter:image:alt") ??
        getMetaContent(html, "name", "twitter:title") ??
        fallbackAlt,
      imageSource: "twitter",
    });
  }

  const jsonLdImage = extractJsonLdImage(html);
  const jsonLdUrl = absolutizeUrl(jsonLdImage.imageUrl, baseUrl);
  if (isLikelyValidImageUrl(jsonLdUrl)) {
    addCandidate({
      imageUrl: jsonLdUrl,
      imageWidth: jsonLdImage.imageWidth,
      imageHeight: jsonLdImage.imageHeight,
      imageAlt: jsonLdImage.imageAlt ?? fallbackAlt,
      imageSource: "jsonld",
    });
  }

  const inlineImage = extractFirstInlineImage(html);
  const inlineUrl = absolutizeUrl(inlineImage.imageUrl, baseUrl);
  if (isLikelyValidImageUrl(inlineUrl)) {
    addCandidate({
      imageUrl: inlineUrl,
      imageWidth: inlineImage.imageWidth,
      imageHeight: inlineImage.imageHeight,
      imageAlt: inlineImage.imageAlt ?? fallbackAlt,
      imageSource: "inline",
    });
  }

  const rawCandidate = extractRawImageCandidates(html, baseUrl)[0];
  if (isLikelyValidImageUrl(rawCandidate)) {
    addCandidate({
      imageUrl: rawCandidate,
      imageAlt: fallbackAlt,
      imageSource: "inline",
    });
  }

  return candidates;
}

// Publishers lie in image slots (Agerpres og:image links an HTML photo page
// when the article has no photo), so the winning candidate must prove it
// serves image bytes before we store it. Capped so one pathological page
// can't trigger a fetch storm.
const MAX_IMAGE_VERIFICATION_ATTEMPTS = 3;

// This best-effort hero check runs inline in the content-fetch worker and
// probes up to MAX_IMAGE_VERIFICATION_ATTEMPTS candidates sequentially, so
// each probe uses a tighter timeout than verifyImageUrl's default to bound
// worst-case blocking (3 × 4s instead of 3 × 8s).
const HERO_IMAGE_VERIFY_TIMEOUT_MS = 4000;

export type ImageUrlVerifier = (url: string) => Promise<ImageUrlVerdict>;

const defaultHeroImageVerifier: ImageUrlVerifier = (url) =>
  verifyImageUrl(url, { timeoutMs: HERO_IMAGE_VERIFY_TIMEOUT_MS });

export async function resolveVerifiedImageMetadata(
  html: string,
  baseUrl: string,
  fallbackAlt: string,
  verifier: ImageUrlVerifier = defaultHeroImageVerifier,
): Promise<ExtractedImageMetadata> {
  const candidates = collectImageMetadataCandidates(html, baseUrl, fallbackAlt);
  for (const candidate of candidates.slice(
    0,
    MAX_IMAGE_VERIFICATION_ATTEMPTS,
  )) {
    if ((await verifier(candidate.imageUrl!)) === "image") {
      return candidate;
    }
  }
  return {};
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

  // BIV-813: parsed ONCE from the ORIGINAL html — stripNoise removes
  // <script> blocks, which also made the old post-scoring JSON-LD fallback
  // unreachable.
  const jsonLdDocs = parseJsonLdScripts(html);
  const jsonLdBody = extractJsonLdArticleBody(jsonLdDocs);

  const candidates = Array.from(
    cleanedHtml.matchAll(/<(article|main|section|div)\b[\s\S]*?<\/\1>/gi),
  )
    .map((match) => ({ html: match[0], score: scoreHtmlBlock(match[0]) }))
    .sort((a, b) => b.score - a.score);

  const best = candidates[0]?.html ?? cleanedHtml;
  const bestText = extractParagraphText(best);

  // BIV-813: the publisher-declared JSON-LD articleBody outranks generic
  // block scoring. On zf.ro the real body is script-rendered, so the
  // best-scored <div> was a site-wide teaser widget — identical across every
  // ZF page — which embedded as a near-identical vector and merged unrelated
  // articles into one event. articleBody is per-article by definition, so it
  // can't repeat that failure. Exception (longer-wins): some publishers put
  // only a lede/teaser in articleBody; when the DOM prose is substantially
  // fuller, it is the real body and the JSON-LD field is the excerpt.
  if (jsonLdBody && jsonLdBody.length >= MIN_EXTRACTED_BODY_CHARS) {
    const domIsSubstantiallyFuller =
      bestText.length >= MIN_EXTRACTED_BODY_CHARS &&
      bestText.length >= jsonLdBody.length * 1.5;
    if (!domIsSubstantiallyFuller) {
      return {
        text: jsonLdBody,
        method: "jsonld",
      };
    }
  }

  if (bestText.length >= MIN_EXTRACTED_BODY_CHARS) {
    return {
      text: bestText,
      method: "body",
    };
  }

  const jsonLdText = extractJsonLdText(jsonLdDocs);
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
  _preferGoogleReferer = false,
): Promise<FetchResult> {
  const attempts = buildFetchAttempts();
  let lastHtmlResult: FetchResult | null = null;

  for (const attempt of attempts) {
    try {
      // L6: per-domain rate limiting + backoff via politeFetch.
      const response = await politeFetch(url, {
        redirect: "follow",
        timeoutMs: FETCH_TIMEOUT_MS,
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
      // Network failure — fall through to the RSS fallback.
    }
  }

  return lastHtmlResult ?? { ok: false };
}

/**
 * L5 — no-network fallback for domains whose TDM permission state forbids
 * extraction (rss_only/blocked): the article contributes only its RSS
 * metadata (title + snippet) to embeddings and downstream processing.
 */
export function rssOnlyArticleContent(args: {
  title: string;
  rssSnippet: string;
}): ExtractedArticleContent {
  return {
    embeddingText: buildEmbeddingText(args.title, "", args.rssSnippet),
    summary: summarizeBody(args.rssSnippet),
    method: "rss_fallback",
    bodyChars: 0,
    fetchSucceeded: false,
    resolvedUrl: undefined,
    imageUrl: undefined,
    imageWidth: undefined,
    imageHeight: undefined,
    imageAlt: undefined,
    imageSource: undefined,
    entities: extractEntityCandidates(args.title, args.rssSnippet),
    extractionQuality: "weak",
  };
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
  const resolvedUrl =
    (await resolveGoogleNewsUrl(args.url, EXTRACTION_USER_AGENT)) ?? args.url;
  const fetched = await fetchHtml(resolvedUrl, resolvedUrl !== args.url);

  if (!fetched.ok || !fetched.html) {
    const blockedMetaDescription = fetched.html
      ? extractMetaDescription(fetched.html)
      : undefined;
    const blockedImage = fetched.html
      ? await resolveVerifiedImageMetadata(
          fetched.html,
          fetched.finalUrl ?? resolvedUrl,
          args.title,
        )
      : {};
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
      imageUrl: blockedImage.imageUrl,
      imageWidth: blockedImage.imageWidth,
      imageHeight: blockedImage.imageHeight,
      imageAlt: blockedImage.imageAlt,
      imageSource: blockedImage.imageSource,
      entities: extractEntityCandidates(args.title, blockedMetaDescription ?? args.rssSnippet),
      extractionQuality: "weak",
    };
  }

  try {
    const { text: extractedText, method } = chooseBestContentBlock(fetched.html);
    const metaDescription = extractMetaDescription(fetched.html);
    const effectiveUrl =
      fetched.finalUrl && fetched.finalUrl !== args.url
        ? fetched.finalUrl
        : resolvedUrl !== args.url
          ? resolvedUrl
          : args.url;
    const image = await resolveVerifiedImageMetadata(
      fetched.html,
      effectiveUrl,
      args.title,
    );

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
      resolvedUrl: effectiveUrl !== args.url ? effectiveUrl : undefined,
      imageUrl: image.imageUrl,
      imageWidth: image.imageWidth,
      imageHeight: image.imageHeight,
      imageAlt: image.imageAlt,
      imageSource: image.imageSource,
      entities: extractEntityCandidates(
        args.title,
        strongBody || metaDescription || args.rssSnippet,
      ),
      extractionQuality: strongBody.length > 0 ? "strong" : "weak",
    };
  } catch {
    return {
      embeddingText: fallbackEmbeddingText,
      summary: fallbackSummary,
      method: "rss_fallback",
      bodyChars: 0,
      fetchSucceeded: true,
      resolvedUrl: resolvedUrl !== args.url ? resolvedUrl : undefined,
      imageUrl: undefined,
      imageWidth: undefined,
      imageHeight: undefined,
      imageAlt: undefined,
      imageSource: undefined,
      entities: extractEntityCandidates(args.title, args.rssSnippet),
      extractionQuality: "weak",
    };
  }
}

/**
 * Fixture-testable seam over the body-selection pipeline (no network).
 * Exercises exactly what extractArticleContentForEmbedding does with a
 * fetched page: choose the body block, including the JSON-LD articleBody
 * preference (BIV-813).
 */
export function extractBodyFromHtml(html: string): {
  text: string;
  method: ExtractionMethod;
} {
  return chooseBestContentBlock(html);
}

export type FetchedArticleBody = {
  body?: string;
  method: ExtractionMethod | "fetch_failed";
};

/**
 * Transient body fetch for the event summarizer. Article bodies must never
 * be persisted (storing scraped third-party text is a copyright exposure),
 * so the summarizer re-fetches at summarization time, uses the text in
 * memory for the prompt, and drops it. Same fetch/extraction machinery as
 * extractArticleContentForEmbedding, minus summary/entities/images. Returns
 * no body when the page is blocked or the extracted text is below the
 * strong-body floor — callers fall back to the stored summary/rssSnippet.
 */
export async function fetchArticleBodyText(
  url: string,
): Promise<FetchedArticleBody> {
  const resolvedUrl =
    (await resolveGoogleNewsUrl(url, EXTRACTION_USER_AGENT)) ?? url;
  const fetched = await fetchHtml(resolvedUrl, resolvedUrl !== url);
  if (!fetched.ok || !fetched.html) {
    return { method: "fetch_failed" };
  }

  try {
    const { text, method } = chooseBestContentBlock(fetched.html);
    const normalizedBody = normalizeWhitespace(text).slice(0, MAX_BODY_CHARS);
    if (normalizedBody.length < MIN_EXTRACTED_BODY_CHARS) {
      return { method };
    }
    return { body: normalizedBody, method };
  } catch {
    return { method: "fetch_failed" };
  }
}

export type PreparedEmbeddingArticle = {
  sourceName?: string;
  title: string;
  rssSnippet?: string | null;
  embeddingText: string;
  extractedSummary?: string;
  extractionMethod: string;
  bodyChars: number;
  extractionQuality?: "strong" | "weak";
  entities?: string[];
};

/**
 * BIV-813 guard: when several articles from the same source in a batch carry
 * an IDENTICAL extracted body under different titles, that body is site
 * furniture (paywall teaser widget, promo block), not article content —
 * zf.ro served the same 3.9k-char teaser list as the "body" of 38 unrelated
 * articles, which embedded as near-identical vectors and merged them all
 * into one event. Demote those articles to title+snippet embeddings and
 * re-derive summary/entities so no downstream signal (embedding similarity,
 * entity overlap) is built from the shared boilerplate.
 *
 * Known tradeoff: a legitimate article the same source republishes under a
 * retitled headline within one batch gets demoted too. It still embeds via
 * title+snippet (and clusters on those signals), which we accept over the
 * alternative — boilerplate bodies silently merging unrelated events.
 */
export function demoteRepeatedSourceBodies<
  T extends PreparedEmbeddingArticle,
>(articles: T[]): T[] {
  const bodyOf = (article: T) => {
    const separator = article.embeddingText.indexOf("\n\n");
    return separator >= 0 ? article.embeddingText.slice(separator + 2) : "";
  };

  const bySourceBody = new Map<string, Map<string, number[]>>();
  articles.forEach((article, index) => {
    if (!article.sourceName) return;
    const body = bodyOf(article);
    if (body.length < MIN_EXTRACTED_BODY_CHARS) return;

    // Group on a fixed-length prefix: buildEmbeddingText truncates
    // title+body at MAX_EMBEDDING_CHARS, so the SAME boilerplate body ends
    // up with different tail lengths under different-length titles — an
    // exact-match key would miss exactly the repeats this guard exists for.
    const bodyKey = body.slice(0, 2000);

    const bodies =
      bySourceBody.get(article.sourceName) ?? new Map<string, number[]>();
    bySourceBody.set(article.sourceName, bodies);
    bodies.set(bodyKey, [...(bodies.get(bodyKey) ?? []), index]);
  });

  const demoted = new Set<number>();
  for (const bodies of bySourceBody.values()) {
    for (const indexes of bodies.values()) {
      // The same body under one title is a re-syndicated duplicate (fine);
      // under two or more DIFFERENT titles it can only be boilerplate.
      const distinctTitles = new Set(
        indexes.map((index) =>
          normalizeWhitespace(articles[index]!.title).toLowerCase(),
        ),
      );
      if (distinctTitles.size >= 2) {
        for (const index of indexes) demoted.add(index);
      }
    }
  }

  if (demoted.size === 0) return articles;

  console.warn(
    `[extraction] BIV-813 boilerplate guard: demoted ${demoted.size} article(s) whose extracted body repeats across different titles from the same source`,
    {
      sources: [
        ...new Set(
          [...demoted].map((index) => articles[index]!.sourceName ?? "?"),
        ),
      ],
    },
  );

  return articles.map((article, index) => {
    if (!demoted.has(index)) return article;
    const snippet = article.rssSnippet ?? "";
    // The overridden fields stay within T's property types (rss_fallback is
    // a valid ExtractionMethod); the cast is needed because TS can't prove
    // that for an arbitrary T extends PreparedEmbeddingArticle.
    return {
      ...article,
      embeddingText: buildEmbeddingText(article.title, "", snippet),
      extractedSummary: summarizeBody(snippet),
      extractionMethod: "rss_fallback",
      bodyChars: 0,
      extractionQuality: "weak",
      entities: extractEntityCandidates(article.title, snippet),
    } as T;
  });
}
