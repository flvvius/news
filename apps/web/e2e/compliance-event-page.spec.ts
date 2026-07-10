// L15/L1 — the served HTML of an event page (what curl sees, before any JS)
// must contain the visible AI-disclosure label and the machine-readable
// JSON-LD marker (IPTC trainedAlgorithmicMedia + creativeWorkStatus).
import { expect, test } from "@playwright/test";

test("event page initial HTML carries the AI label and JSON-LD marker", async ({
  request,
}) => {
  // Event discovery via the sitemap (server-rendered from the public
  // previews — independent of the client feed's snapshot state).
  const sitemap = await request.get("/sitemap.xml");
  expect(sitemap.ok()).toBe(true);
  const xml = await sitemap.text();
  const match = xml.match(/<loc>([^<]*\/event\/[^<]+)<\/loc>/);
  expect(match, "sitemap contains no event URLs — seed the dev deployment").toBeTruthy();
  const eventUrl = new URL(match![1]!);

  // curl-equivalent: raw server response, no client JS.
  const response = await request.get(eventUrl.pathname);
  expect(response.ok()).toBe(true);
  const html = await response.text();

  // Visible label (SSR, adjacent to the summary — not the footer).
  expect(html).toContain("data-ai-disclosure");
  expect(html).toContain("Rezumat generat de AI");

  // Machine-readable marking.
  expect(html).toContain(
    "https://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia",
  );
  expect(html).toContain("creativeWorkStatus");
});
