// Guards for the head/structured-data contract. These assert the properties
// that silently break SEO when they regress — a canonical that is not
// absolute, a share card with no alt text, a JSON-LD block whose entity ids
// stop matching — none of which surface as a type error or a runtime crash.
import { describe, expect, test } from "vitest";
import {
  INDEXABLE_ROBOTS,
  ORGANIZATION_ID,
  SITE,
  WEBSITE_ID,
  absoluteSiteUrl,
  breadcrumbJsonLd,
  defaultShareImageMeta,
  deriveShortTitle,
  faqPageJsonLd,
  itemListJsonLd,
  jsonLdScript,
  organizationEntity,
  organizationJsonLd,
  staticPageHead,
  truncateAtWordBoundary,
  websiteJsonLd,
} from "./seo";

function metaValue(
  meta: Array<Record<string, unknown>>,
  key: string,
): string | undefined {
  const entry = meta.find((m) => m.name === key || m.property === key);
  return entry?.content as string | undefined;
}

describe("staticPageHead", () => {
  const head = staticPageHead({
    title: "Despre noi — Miez",
    description: "Ce este Miez.",
    path: "/despre",
  });

  test("canonical is absolute and on the canonical www host", () => {
    // The apex 307-redirects to www; a canonical on the apex would advertise
    // a URL that never resolves directly.
    expect(head.links).toEqual([
      { rel: "canonical", href: "https://www.miez.news/despre" },
    ]);
  });

  test("og:url matches the canonical exactly", () => {
    expect(metaValue(head.meta, "og:url")).toBe(head.links[0].href);
  });

  test("declares the indexable robots directive with large image previews", () => {
    const robots = metaValue(head.meta, "robots");
    expect(robots).toBe(INDEXABLE_ROBOTS);
    expect(robots).toContain("max-image-preview:large");
    expect(robots).toContain("max-snippet:-1");
  });

  test("the share card carries dimensions and alt text", () => {
    // A summary_large_image card with no width/height renders as a thumbnail
    // on several platforms, and with no alt it is unreadable to screen readers
    // in the timeline.
    expect(metaValue(head.meta, "og:image")).toBe(SITE.ogImage);
    expect(metaValue(head.meta, "og:image:width")).toBe("1200");
    expect(metaValue(head.meta, "og:image:height")).toBe("630");
    expect(metaValue(head.meta, "og:image:alt")).toBe(SITE.ogImageAlt);
    expect(metaValue(head.meta, "twitter:image:alt")).toBe(SITE.ogImageAlt);
    expect(metaValue(head.meta, "twitter:card")).toBe("summary_large_image");
  });

  test("emits no scripts when the page supplies no structured data", () => {
    expect(head).not.toHaveProperty("scripts");
  });

  test("renders the breadcrumb trail with the page appended last", () => {
    const withCrumbs = staticPageHead({
      title: "MiezBot — Miez",
      description: "Crawler.",
      path: "/bot",
      breadcrumb: [
        { name: "Miez", path: "/" },
        { name: "MiezBot", path: "/bot" },
      ],
    });
    const crumb = JSON.parse(withCrumbs.scripts![0].children);
    expect(crumb["@type"]).toBe("BreadcrumbList");
    expect(crumb.itemListElement).toEqual([
      {
        "@type": "ListItem",
        position: 1,
        name: "Miez",
        item: "https://www.miez.news/",
      },
      {
        "@type": "ListItem",
        position: 2,
        name: "MiezBot",
        item: "https://www.miez.news/bot",
      },
    ]);
  });
});

describe("share image meta", () => {
  test("omits og:image:type by default", () => {
    // Head tags merge deepest-route-first, so a type declared at the root
    // would leak onto event pages that override og:image with a publisher
    // photo of a different format.
    const keys = defaultShareImageMeta().map((m) => m.property ?? m.name);
    expect(keys).not.toContain("og:image:type");
  });

  test("includes og:image:type when the page really serves og-image.jpg", () => {
    const meta = defaultShareImageMeta({ includeType: true });
    expect(metaValue(meta, "og:image:type")).toBe("image/jpeg");
  });
});

describe("entity graph", () => {
  test("the publisher node reuses one @id site-wide", () => {
    // Search engines merge JSON-LD nodes by @id; a per-page anonymous
    // Organization would split the entity's signals instead of accumulating
    // them.
    expect(organizationEntity()["@id"]).toBe(ORGANIZATION_ID);
    expect(organizationJsonLd()["@id"]).toBe(ORGANIZATION_ID);
    expect(ORGANIZATION_ID.startsWith(SITE.url)).toBe(true);
  });

  test("the website node points at the publisher by reference", () => {
    const site = websiteJsonLd("desc");
    expect(site["@id"]).toBe(WEBSITE_ID);
    expect(site.publisher).toEqual({ "@id": ORGANIZATION_ID });
  });

  test("the website node advertises no SearchAction", () => {
    // Feed search is client-side with no addressable ?q= URL; advertising one
    // would point crawlers at a route that does not exist.
    expect(websiteJsonLd("desc")).not.toHaveProperty("potentialAction");
  });

  test("sameAs is omitted rather than emitted empty", () => {
    expect(organizationJsonLd()).not.toHaveProperty("sameAs");
  });
});

describe("faqPageJsonLd", () => {
  test("maps each pair to a Question with an accepted answer", () => {
    const faq = faqPageJsonLd(
      [{ question: "Cum?", answer: "Așa." }],
      "/cum-functioneaza",
    );
    expect(faq["@type"]).toBe("FAQPage");
    expect(faq.mainEntity).toEqual([
      {
        "@type": "Question",
        name: "Cum?",
        acceptedAnswer: { "@type": "Answer", text: "Așa." },
      },
    ]);
  });
});

describe("itemListJsonLd", () => {
  test("numbers entries from 1 and resolves each to an absolute URL", () => {
    const list = itemListJsonLd({
      name: "Surse",
      path: "/surse",
      items: [
        { name: "A", path: "/source/a" },
        { name: "B", path: "/source/b" },
      ],
    });
    expect(list.numberOfItems).toBe(2);
    expect(list.itemListElement).toEqual([
      {
        "@type": "ListItem",
        position: 1,
        name: "A",
        url: "https://www.miez.news/source/a",
      },
      {
        "@type": "ListItem",
        position: 2,
        name: "B",
        url: "https://www.miez.news/source/b",
      },
    ]);
  });
});

describe("jsonLdScript", () => {
  test("serialises to a valid application/ld+json payload", () => {
    const script = jsonLdScript(breadcrumbJsonLd([{ name: "X", path: "/" }]));
    expect(script.type).toBe("application/ld+json");
    expect(() => JSON.parse(script.children)).not.toThrow();
  });
});

describe("absoluteSiteUrl", () => {
  test("preserves query strings so archive pages resolve", () => {
    expect(absoluteSiteUrl("/?page=3")).toBe("https://www.miez.news/?page=3");
  });
});

describe("truncateAtWordBoundary", () => {
  test("returns short text untouched, with no ellipsis", () => {
    expect(truncateAtWordBoundary("Scurt.", 155)).toBe("Scurt.");
  });

  test("cuts on a word boundary and strips dangling punctuation", () => {
    const out = truncateAtWordBoundary("alpha beta, gamma delta", 12);
    expect(out).toBe("alpha beta…");
    expect(out).not.toMatch(/[ ,]…$/);
  });

  test("collapses whitespace so a multi-line summary is one meta line", () => {
    expect(truncateAtWordBoundary("a\n\n  b   c", 155)).toBe("a b c");
  });
});

describe("deriveShortTitle", () => {
  test("keeps only the first headline of a concatenated event title", () => {
    expect(deriveShortTitle("Prima știre / A doua știre / A treia")).toBe(
      "Prima știre",
    );
  });

  test("falls back to the whole title when there is no separator", () => {
    expect(deriveShortTitle("O singură știre")).toBe("O singură știre");
  });
});
