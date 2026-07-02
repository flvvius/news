import { describe, expect, test } from "vitest";

import {
  collectImageMetadataCandidates,
  resolveVerifiedImageMetadata,
} from "./lib/articleExtraction";
import { verifyImageUrl } from "./lib/imageVerification";

const PNG_BYTES = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
  0x49, 0x48, 0x44, 0x52,
]);

const ICO_BYTES = Uint8Array.from([
  0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x10, 0x10, 0x00, 0x00, 0x01, 0x00,
  0x20, 0x00, 0x00, 0x00,
]);

function fetchReturning(
  body: BodyInit | null,
  init: ResponseInit = { status: 200 },
): typeof fetch {
  return async () => new Response(body, init);
}

describe("verifyImageUrl (BIV broken event photos)", () => {
  test("accepts real image bytes even when Content-Type lies", async () => {
    const verdict = await verifyImageUrl("https://example.com/photo", {
      fetchImpl: fetchReturning(PNG_BYTES, {
        status: 200,
        headers: { "content-type": "text/html" },
      }),
    });
    expect(verdict).toBe("image");
  });

  test("rejects an HTML photo-detail page served in an image slot", async () => {
    // Agerpres og:image points at foto.agerpres.ro/foto/detaliu/<id>,
    // which 302s to an HTML gallery page.
    const html =
      "<!DOCTYPE html><html><head><title>AGERPRES Foto</title></head></html>";
    const verdict = await verifyImageUrl(
      "https://foto.agerpres.ro/foto/detaliu/15985845",
      { fetchImpl: fetchReturning(html) },
    );
    expect(verdict).toBe("not-image");
  });

  test("rejects favicons in the hero image slot", async () => {
    const verdict = await verifyImageUrl("https://example.com/favicon.ico", {
      fetchImpl: fetchReturning(ICO_BYTES),
    });
    expect(verdict).toBe("not-image");
  });

  test("reads only the leading bytes of a streamed body", async () => {
    let pulls = 0;
    const endlessStream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls++;
        if (pulls === 1) {
          controller.enqueue(PNG_BYTES);
        } else {
          controller.enqueue(new Uint8Array(64 * 1024));
        }
      },
    });
    const verdict = await verifyImageUrl("https://example.com/huge.png", {
      fetchImpl: fetchReturning(endlessStream),
    });
    expect(verdict).toBe("image");
    // 1024-byte target must not drain a multi-megabyte body.
    expect(pulls).toBeLessThan(20);
  });

  test("treats non-2xx responses as unreachable", async () => {
    const verdict = await verifyImageUrl("https://example.com/gone.jpg", {
      fetchImpl: fetchReturning(null, { status: 404 }),
    });
    expect(verdict).toBe("unreachable");
  });

  test("treats network failures as unreachable", async () => {
    const verdict = await verifyImageUrl("https://example.com/photo.jpg", {
      fetchImpl: async () => {
        throw new Error("connect ECONNREFUSED");
      },
    });
    expect(verdict).toBe("unreachable");
  });
});

// Reduced version of the real Agerpres markup that produced the bug: the
// article has no photo, og:image links an HTML page, and twitter:image is
// the literal placeholder text "linkul pozei".
const AGERPRES_LIKE_HTML = `
<html><head>
<meta property="og:image" content="https://foto.agerpres.ro/foto/detaliu/15985845" >
<meta name="twitter:image" content="linkul pozei">
<script type="application/ld+json">
{"@type":"NewsArticle","image":{"url":"https://static.agerpres.ro/img/site/hero.jpg","width":1200,"height":675}}
</script>
</head><body></body></html>`;

describe("collectImageMetadataCandidates", () => {
  test("keeps og first but retains lower-priority fallbacks", () => {
    const candidates = collectImageMetadataCandidates(
      AGERPRES_LIKE_HTML,
      "https://agerpres.ro/economic-extern/2026/07/02/articol--1572574",
      "fallback alt",
    );
    const urls = candidates.map((candidate) => candidate.imageUrl);
    expect(urls[0]).toBe("https://foto.agerpres.ro/foto/detaliu/15985845");
    expect(urls).toContain("https://static.agerpres.ro/img/site/hero.jpg");
  });

  test("dedupes candidates that repeat the same URL", () => {
    const html = `
<meta property="og:image" content="https://example.com/a.jpg">
<meta name="twitter:image" content="https://example.com/a.jpg">`;
    const candidates = collectImageMetadataCandidates(
      html,
      "https://example.com/story",
      "alt",
    );
    expect(
      candidates.filter(
        (candidate) => candidate.imageUrl === "https://example.com/a.jpg",
      ),
    ).toHaveLength(1);
  });
});

describe("resolveVerifiedImageMetadata", () => {
  test("skips an og:image that serves HTML and falls back to a real image", async () => {
    const image = await resolveVerifiedImageMetadata(
      AGERPRES_LIKE_HTML,
      "https://agerpres.ro/economic-extern/2026/07/02/articol--1572574",
      "fallback alt",
      async (url) =>
        url === "https://static.agerpres.ro/img/site/hero.jpg"
          ? "image"
          : "not-image",
    );
    expect(image.imageUrl).toBe("https://static.agerpres.ro/img/site/hero.jpg");
    expect(image.imageSource).toBe("jsonld");
  });

  test("returns no image when nothing verifies", async () => {
    const image = await resolveVerifiedImageMetadata(
      AGERPRES_LIKE_HTML,
      "https://agerpres.ro/economic-extern/2026/07/02/articol--1572574",
      "fallback alt",
      async () => "not-image",
    );
    expect(image).toEqual({});
  });

  test("caps verification fetches per article", async () => {
    const html = `
<meta property="og:image" content="https://example.com/1.jpg">
<meta name="twitter:image" content="https://example.com/2.jpg">
<img src="https://example.com/3.jpg">
<img src="https://example.com/4.jpg">`;
    let attempts = 0;
    await resolveVerifiedImageMetadata(
      html,
      "https://example.com/story",
      "alt",
      async () => {
        attempts++;
        return "not-image";
      },
    );
    expect(attempts).toBeLessThanOrEqual(3);
  });
});
