"use node";

/**
 * Remote image URL verification for article/event hero images.
 *
 * Publishers sometimes put non-image URLs in image slots: Agerpres emits
 * `og:image` pointing at an HTML photo-detail page
 * (https://foto.agerpres.ro/foto/detaliu/<id>) and a literal
 * `twitter:image` of "linkul pozei" when an article has no photo. Neither
 * URL shape nor Content-Type can be trusted, so the only reliable check is
 * fetching the first bytes and sniffing the magic numbers.
 */

import { sniffImageFormat, type SniffedImageFormat } from "./imageSniff";
import { BOT_USER_AGENT } from "./botIdentity";

export type ImageUrlVerdict = "image" | "not-image" | "unreachable";

export type VerifyImageUrlOptions = {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  userAgent?: string;
};

// Formats acceptable as an article/event hero image. ICO is excluded: a
// favicon in a hero slot is always wrong even though it is technically an
// image.
const HERO_IMAGE_FORMATS: ReadonlySet<SniffedImageFormat> = new Set([
  "png",
  "jpeg",
  "gif",
  "webp",
  "avif",
  "bmp",
  "svg",
]);

// Enough bytes for every signature in sniffImageFormat, including the
// 256-char window scanned for an <svg> prologue.
const SNIFF_BYTE_TARGET = 1024;
const DEFAULT_VERIFY_TIMEOUT_MS = 8000;
// Redirects are followed manually so every hop can be re-validated; cap the
// chain so a redirect loop can't spin.
const MAX_REDIRECT_HOPS = 5;
// L6: honest crawler identity (no browser masquerading).
const DEFAULT_USER_AGENT = BOT_USER_AGENT;

/**
 * Block SSRF to internal infrastructure. Image URLs come from attacker-shaped
 * publisher HTML (og:image / twitter:image / inline <img>), so a hostile page
 * can point an image slot at loopback, private-range, or cloud-metadata
 * addresses. We reject IP literals in those ranges and obvious internal
 * hostnames on every request, including each redirect hop. (DNS rebinding —
 * a public name that resolves to a private IP — is out of scope here; it
 * would need connect-time IP pinning the fetch API doesn't expose.)
 */
function isBlockedImageHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal")
  ) {
    return true;
  }
  // IPv6 loopback (::1), unspecified (::), link-local (fe80::) and
  // unique-local (fc00::/7 → fc/fd prefixes).
  if (host === "::1" || host === "::") return true;
  if (host.startsWith("fe80:") || host.startsWith("fc") || host.startsWith("fd")) {
    return true;
  }
  const ipv4 = host.match(/(?:^|:)(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    const a = Number(ipv4[1]);
    const b = Number(ipv4[2]);
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true; // link-local incl. 169.254.169.254 metadata
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  }
  return false;
}

async function readLeadingBytes(
  response: Response,
  target: number,
): Promise<Uint8Array> {
  const body = response.body;
  if (!body) {
    const buffer = new Uint8Array(await response.arrayBuffer());
    return buffer.slice(0, target);
  }

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  try {
    while (received < target) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      received += value.byteLength;
    }
  } finally {
    await reader.cancel().catch(() => {});
  }

  const combined = new Uint8Array(Math.min(received, target));
  let offset = 0;
  for (const chunk of chunks) {
    const remaining = combined.byteLength - offset;
    if (remaining <= 0) break;
    combined.set(chunk.subarray(0, Math.min(chunk.byteLength, remaining)), offset);
    offset += Math.min(chunk.byteLength, remaining);
  }
  return combined;
}

/**
 * Fetch the first bytes of `url` and verify they are a renderable image.
 *
 * - "image": bytes carry a known raster/SVG signature.
 * - "not-image": the server responded, but with something that is not an
 *   image a browser could render in an <img> (HTML page, favicon, junk).
 * - "unreachable": network error, timeout, or non-2xx response.
 */
export async function verifyImageUrl(
  url: string,
  options: VerifyImageUrlOptions = {},
): Promise<ImageUrlVerdict> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    options.timeoutMs ?? DEFAULT_VERIFY_TIMEOUT_MS,
  );

  try {
    let currentUrl = url;
    let response: Response | undefined;

    for (let hop = 0; hop <= MAX_REDIRECT_HOPS; hop++) {
      let parsed: URL;
      try {
        parsed = new URL(currentUrl);
      } catch {
        return "unreachable";
      }
      if (!/^https?:$/.test(parsed.protocol) || isBlockedImageHost(parsed.hostname)) {
        return "unreachable";
      }

      response = await fetchImpl(currentUrl, {
        redirect: "manual",
        signal: controller.signal,
        headers: {
          "User-Agent": options.userAgent ?? DEFAULT_USER_AGENT,
          Accept: "image/avif,image/webp,image/png,image/*;q=0.8,*/*;q=0.5",
        },
      });

      // Follow redirects by hand so the destination host is re-validated
      // before we connect — `redirect: "follow"` would silently reach an
      // internal target the initial URL check can't see.
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        await response.body?.cancel().catch(() => {});
        if (!location) return "unreachable";
        currentUrl = new URL(location, currentUrl).toString();
        continue;
      }
      break;
    }

    if (!response || !response.ok) {
      return "unreachable";
    }

    const bytes = await readLeadingBytes(response, SNIFF_BYTE_TARGET);
    const format = sniffImageFormat(bytes);
    return format && HERO_IMAGE_FORMATS.has(format) ? "image" : "not-image";
  } catch {
    return "unreachable";
  } finally {
    clearTimeout(timeout);
  }
}
