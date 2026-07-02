/**
 * Magic-byte image format detection for fetched logos/images.
 *
 * Favicon CDNs (e.g. icons.duckduckgo.com) pass through whatever the origin
 * serves and frequently mislabel it — PNG bytes shipped as image/x-icon and
 * vice versa — so the share renderer must trust the bytes, not the
 * Content-Type header.
 */

export type SniffedImageFormat =
  | "png"
  | "jpeg"
  | "gif"
  | "ico"
  | "webp"
  | "avif"
  | "bmp"
  | "svg";

function ascii(bytes: Uint8Array, start: number, length: number): string {
  let out = "";
  for (let i = start; i < start + length && i < bytes.length; i++) {
    out += String.fromCharCode(bytes[i]!);
  }
  return out;
}

export function sniffImageFormat(bytes: Uint8Array): SniffedImageFormat | null {
  if (bytes.length < 12) return null;

  if (
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "png";
  }

  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "jpeg";
  }

  if (ascii(bytes, 0, 4) === "GIF8") {
    return "gif";
  }

  // ICO (type 1) and CUR (type 2) share the container format.
  if (
    bytes[0] === 0x00 &&
    bytes[1] === 0x00 &&
    (bytes[2] === 0x01 || bytes[2] === 0x02) &&
    bytes[3] === 0x00
  ) {
    return "ico";
  }

  if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP") {
    return "webp";
  }

  if (ascii(bytes, 4, 4) === "ftyp") {
    const brand = ascii(bytes, 8, 4);
    if (brand === "avif" || brand === "avis") return "avif";
  }

  if (bytes[0] === 0x42 && bytes[1] === 0x4d) {
    return "bmp";
  }

  // SVG: text document whose first non-whitespace content opens an <svg> or
  // XML/doctype prologue. Skip a UTF-8 BOM if present.
  let offset = 0;
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) offset = 3;
  const head = ascii(bytes, offset, Math.min(256, bytes.length - offset))
    .trimStart()
    .toLowerCase();
  if (
    head.startsWith("<svg") ||
    ((head.startsWith("<?xml") || head.startsWith("<!doctype")) &&
      head.includes("<svg"))
  ) {
    return "svg";
  }

  return null;
}
