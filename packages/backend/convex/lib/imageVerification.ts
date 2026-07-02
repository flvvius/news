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
const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36";

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
    const response = await fetchImpl(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "User-Agent": options.userAgent ?? DEFAULT_USER_AGENT,
        Accept: "image/avif,image/webp,image/png,image/*;q=0.8,*/*;q=0.5",
      },
    });

    if (!response.ok) {
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
