import { describe, expect, test } from "vitest";

import { ABOUT_PAGES, aboutPageUrl } from "./site";

// Ticket 5d: the privacy policy must stay reachable from onboarding + profile.
// These guard against the privacy entry being removed or its URL breaking.
describe("privacy policy reachability (Ticket 5d)", () => {
  test("a privacy page exists in ABOUT_PAGES", () => {
    const privacy = ABOUT_PAGES.find((page) => page.slug === "privacy");
    expect(privacy).toBeDefined();
  });

  test("the privacy page resolves to an absolute miez.news URL", () => {
    const privacy = ABOUT_PAGES.find((page) => page.slug === "privacy");
    expect(privacy).toBeDefined();
    if (!privacy) return;
    expect(aboutPageUrl(privacy)).toBe(
      "https://miez.news/politica-confidentialitate",
    );
  });
});
