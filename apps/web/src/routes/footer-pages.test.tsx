// BIV-803: every footer page renders real, non-placeholder Romanian content.
// The former {{TODO: …}} contact-email placeholders have been removed; the
// pages now route users to the „Raportează o eroare" complaint form and the
// /contact page. This test guards that no {{TODO}} placeholder is reintroduced.
import { describe, expect, test } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { beforeEach } from "vitest";
import type { ComponentType, ReactElement } from "react";

import { BRAND_NAME } from "@/lib/i18n/strings";
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
// /contact embeds the ContactForm, which calls useMutation — stub it so the
// page renders without a Convex provider (we assert content, not submission).
vi.mock("convex/react", () => ({
  useMutation: () => vi.fn(),
}));
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
      expect(text).toContain(BRAND_NAME);
    },
  );

  test.each(FOOTER_PAGES)(
    "%s has no {{TODO}} placeholder",
    (path, Page) => {
      const matches = renderPageText(Page).match(TODO_PATTERN) ?? [];
      expect(matches, `${path} still has: ${matches.join(", ")}`).toHaveLength(
        0,
      );
    },
  );
});
