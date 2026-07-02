import { describe, expect, test } from "vitest";

import {
  GOOGLE_NEWS_RO_FEED_URL,
  getGoogleNewsArticleId,
  isGoogleNewsUrl,
} from "./lib/googleNews";

describe("Google News RO overlay helpers (BIV-103)", () => {
  test("the discovery feed targets Romania", () => {
    const url = new URL(GOOGLE_NEWS_RO_FEED_URL);
    expect(url.hostname).toBe("news.google.com");
    expect(url.searchParams.get("hl")).toBe("ro");
    expect(url.searchParams.get("gl")).toBe("RO");
    expect(url.searchParams.get("ceid")).toBe("RO:ro");
  });

  test("detects google news wrapper URLs", () => {
    expect(
      isGoogleNewsUrl("https://news.google.com/rss/articles/CBMiabc123"),
    ).toBe(true);
    expect(isGoogleNewsUrl("https://www.digi24.ro/stiri/a")).toBe(false);
    expect(isGoogleNewsUrl("not a url")).toBe(false);
  });

  test("extracts the article id from wrapper URL variants", () => {
    expect(
      getGoogleNewsArticleId(
        "https://news.google.com/rss/articles/CBMiabc123?oc=5",
      ),
    ).toBe("CBMiabc123");
    expect(
      getGoogleNewsArticleId("https://news.google.com/read/CAIiEabc?hl=ro"),
    ).toBe("CAIiEabc");
    expect(
      getGoogleNewsArticleId("https://news.google.com/rss?hl=ro"),
    ).toBeNull();
    expect(getGoogleNewsArticleId("https://www.digi24.ro/a")).toBeNull();
  });
});
