// BIV-803: every footer page renders real, non-placeholder Romanian content;
// business-identity placeholders follow the {{TODO: …}} pattern and every one
// of them is mirrored in FOOTER_TODO.md at the repo root.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { beforeEach } from "vitest";
import type { ComponentType, ReactElement } from "react";

import { DesprePage } from "./despre";
import { ContactPage } from "./contact";
import { ParteneriPage } from "./parteneri";
import { CumFunctioneazaPage } from "./cum-functioneaza";
import { SurseleNoastrePage } from "./sursele-noastre";
import { PoliticaConfidentialitatePage } from "./politica-confidentialitate";
import { TermeniPage } from "./termeni";

// The page components only use <Link>, which needs a router context in
// strict mode — mock it with a plain anchor for content assertions.
import { vi } from "vitest";
vi.mock("@tanstack/react-router", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@tanstack/react-router")>();
  return {
    ...original,
    Link: ({ to, children, className }: { to: string; children: unknown; className?: string }) =>
      (
        <a href={to} className={className}>
          {children as ReactElement}
        </a>
      ),
  };
});

const FOOTER_PAGES: Array<[string, ComponentType]> = [
  ["/despre", DesprePage],
  ["/contact", ContactPage],
  ["/parteneri", ParteneriPage],
  ["/cum-functioneaza", CumFunctioneazaPage],
  ["/sursele-noastre", SurseleNoastrePage],
  ["/politica-confidentialitate", PoliticaConfidentialitatePage],
  ["/termeni", TermeniPage],
];

const TODO_PATTERN = /\{\{TODO: [^}]+\}\}/g;

// vitest runs with cwd = apps/web; FOOTER_TODO.md lives at the repo root.
const footerTodoMd = readFileSync(
  resolve(process.cwd(), "../../FOOTER_TODO.md"),
  "utf8",
);

function renderPageText(Page: ComponentType): string {
  const { container } = render(<Page />);
  return container.textContent ?? "";
}

beforeEach(cleanup);

describe("footer pages (BIV-803)", () => {
  test.each(FOOTER_PAGES)(
    "%s renders substantial non-placeholder content",
    (_path, Page) => {
      const text = renderPageText(Page);
      expect(text.length).toBeGreaterThan(500);
      expect(text.toLowerCase()).not.toContain("lorem");
      expect(text).not.toContain("Pagina este în lucru");
      expect(text).toContain("Biviant");
    },
  );

  test("every {{TODO}} placeholder in the pages is listed in FOOTER_TODO.md", () => {
    const seen = new Set<string>();
    for (const [, Page] of FOOTER_PAGES) {
      for (const token of renderPageText(Page).match(TODO_PATTERN) ?? []) {
        seen.add(token);
      }
    }
    expect(seen.size).toBeGreaterThan(0);
    for (const token of seen) {
      expect(footerTodoMd, `${token} missing from FOOTER_TODO.md`).toContain(
        token,
      );
    }
  });

  test("every placeholder listed in FOOTER_TODO.md still exists in a page", () => {
    const pagesText = FOOTER_PAGES.map(([, Page]) =>
      renderPageText(Page),
    ).join("\n");
    // Only table rows list concrete placeholders; the intro's generic
    // "{{TODO: …}}" mention is not a token.
    const listed = new Set(
      [...footerTodoMd.matchAll(/^\| `(\{\{TODO: [^}]+\}\})`/gm)].map(
        (m) => m[1],
      ),
    );
    expect(listed.size).toBeGreaterThan(0);
    for (const token of listed) {
      expect(pagesText, `${token} listed but absent from pages`).toContain(
        token,
      );
    }
  });

  test("no fabricated business identity: identity fields only appear as TODO placeholders", () => {
    for (const [path, Page] of FOOTER_PAGES) {
      const text = renderPageText(Page);
      // No invented registration numbers or phone numbers.
      expect(text, `${path} contains a CUI/J-number`).not.toMatch(
        /\bJ\d{2}\/|\bCUI\b|\bRO\d{6,}/,
      );
      expect(text, `${path} contains a phone number`).not.toMatch(
        /\+40\s?\d|\b07\d{8}\b/,
      );
      // No asserted @biviant.com mailbox (must stay a TODO until provisioned).
      expect(text, `${path} asserts an email address`).not.toMatch(
        /[a-z0-9._%+-]+@biviant\.com/i,
      );
    }
  });
});
