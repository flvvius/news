import { render } from "@testing-library/react";
import { describe, expect, test } from "vitest";

import {
  SECTION_TITLE_CLASSNAME,
  SectionTitle,
} from "@/components/ui/section-title";

describe("SectionTitle (BIV-818)", () => {
  test("renders a normal-case subtitle style", () => {
    const { container, getByText } = render(
      <SectionTitle>Latest stories</SectionTitle>,
    );

    const title = getByText("Latest stories");
    expect(title.tagName).toBe("H2");
    expect(title.className).toContain(SECTION_TITLE_CLASSNAME);
    expect(title.className).not.toContain("uppercase");
    expect(title.className).not.toContain("tracking-[");
    expect(title.className).not.toContain("text-xs");
    expect(title.textContent).toBe("Latest stories");
    expect(container.firstChild).toMatchInlineSnapshot(`
      <h2
        class="text-base font-semibold leading-6 text-foreground"
        data-slot="section-title"
      >
        Latest stories
      </h2>
    `);
  });
});
