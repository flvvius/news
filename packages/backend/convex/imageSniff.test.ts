import { describe, expect, test } from "vitest";

import { sniffImageFormat } from "./lib/imageSniff";

function bytes(...values: Array<number | string>): Uint8Array {
  const out: number[] = [];
  for (const value of values) {
    if (typeof value === "number") out.push(value);
    else for (const char of value) out.push(char.charCodeAt(0));
  }
  // Pad so every fixture clears the 12-byte minimum.
  while (out.length < 16) out.push(0);
  return Uint8Array.from(out);
}

describe("sniffImageFormat", () => {
  test("detects PNG regardless of served content-type", () => {
    expect(
      sniffImageFormat(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)),
    ).toBe("png");
  });

  test("detects JPEG", () => {
    expect(sniffImageFormat(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe("jpeg");
  });

  test("detects GIF", () => {
    expect(sniffImageFormat(bytes("GIF89a"))).toBe("gif");
  });

  test("detects ICO and CUR containers", () => {
    expect(sniffImageFormat(bytes(0x00, 0x00, 0x01, 0x00, 0x01, 0x00))).toBe(
      "ico",
    );
    expect(sniffImageFormat(bytes(0x00, 0x00, 0x02, 0x00, 0x01, 0x00))).toBe(
      "ico",
    );
  });

  test("detects WebP", () => {
    expect(sniffImageFormat(bytes("RIFF", 0, 0, 0, 0, "WEBP"))).toBe("webp");
  });

  test("detects AVIF", () => {
    expect(sniffImageFormat(bytes(0, 0, 0, 0x20, "ftypavif"))).toBe("avif");
  });

  test("detects BMP", () => {
    expect(sniffImageFormat(bytes("BM", 0x36, 0x00, 0x00, 0x00))).toBe("bmp");
  });

  test("detects SVG with and without XML prologue", () => {
    expect(
      sniffImageFormat(bytes('<svg xmlns="http://www.w3.org/2000/svg">')),
    ).toBe("svg");
    expect(
      sniffImageFormat(bytes('<?xml version="1.0"?><svg xmlns="x">')),
    ).toBe("svg");
  });

  test("rejects HTML error pages and garbage", () => {
    expect(sniffImageFormat(bytes("<!doctype html><html></html>"))).toBeNull();
    expect(sniffImageFormat(bytes("hello world, not an image"))).toBeNull();
    expect(sniffImageFormat(Uint8Array.from([1, 2, 3]))).toBeNull();
  });
});
