// L2 (Art. 94¹): render-time guard — a 500-char stored description must
// never reach the DOM beyond MAX_SNIPPET_CHARS, and the ceiling must match
// the backend's single source of truth.
import { describe, expect, test, beforeEach } from "vitest";
import { cleanup, render } from "@testing-library/react";

import { MAX_SNIPPET_CHARS as BACKEND_MAX } from "@news-app/backend/convex/lib/compliance";
import { MAX_SNIPPET_CHARS, truncateSnippetForDisplay } from "@/lib/snippet";
import { Snippet } from "./snippet";

const LONG_TEXT = "cuvânt ".repeat(80).trim(); // ~560 chars

beforeEach(cleanup);

describe("Snippet render guard (L2)", () => {
  test("web ceiling matches the backend single source of truth", () => {
    expect(MAX_SNIPPET_CHARS).toBe(BACKEND_MAX);
  });

  test("a 500-char description renders truncated to the ceiling", () => {
    expect(LONG_TEXT.length).toBeGreaterThan(400);
    const { container } = render(<Snippet text={LONG_TEXT} />);
    const rendered = container.querySelector("[data-third-party-snippet]");
    expect(rendered).not.toBeNull();
    expect(rendered!.textContent!.length).toBeLessThanOrEqual(
      MAX_SNIPPET_CHARS,
    );
    expect(rendered!.textContent!.endsWith("…")).toBe(true);
  });

  test("renders nothing for empty text and passes short text through", () => {
    const empty = render(<Snippet text="  " />);
    expect(
      empty.container.querySelector("[data-third-party-snippet]"),
    ).toBeNull();
    cleanup();

    const short = render(<Snippet text="Un fragment scurt." />);
    expect(
      short.container.querySelector("[data-third-party-snippet]")!.textContent,
    ).toBe("Un fragment scurt.");
  });

  test("renders the adjacent canonical link when provided", () => {
    const { container } = render(
      <Snippet
        text="Fragment."
        canonicalLink={<a href="https://example.ro/articol">Original</a>}
      />,
    );
    expect(
      container.querySelector('a[href="https://example.ro/articol"]'),
    ).not.toBeNull();
  });

  test("truncateSnippetForDisplay never exceeds the ceiling for any input", () => {
    for (const input of [LONG_TEXT, "a".repeat(500), "scurt", ""]) {
      const out = truncateSnippetForDisplay(input);
      if (out !== undefined) {
        expect(out.length).toBeLessThanOrEqual(MAX_SNIPPET_CHARS);
      }
    }
  });
});
