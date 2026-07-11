// L1 (AI Act art. 50(4)): the AI-generation disclosure renders visibly next
// to every summary, names the source count, and links to the report path.
import { describe, expect, test, beforeEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import { LocaleProvider } from "@/lib/i18n/LocaleContext";
import { AiDisclosureLabel } from "./ai-disclosure-label";

beforeEach(cleanup);

describe("AiDisclosureLabel (L1)", () => {
  test("renders the Romanian disclosure with the source count", () => {
    render(
      <LocaleProvider locale="ro">
        <AiDisclosureLabel sourceCount={4} />
      </LocaleProvider>,
    );
    const label = document.querySelector("[data-ai-disclosure]");
    expect(label?.textContent).toContain("Rezumat generat de AI din 4 surse");
    expect(label?.textContent).toContain("Neverificat independent");
    expect(screen.getByRole("link").textContent).toContain(
      "Raportează o eroare",
    );
  });

  test("renders the English disclosure and singular form", () => {
    render(
      <LocaleProvider locale="en">
        <AiDisclosureLabel sourceCount={1} />
      </LocaleProvider>,
    );
    const label = document.querySelector("[data-ai-disclosure]");
    expect(label?.textContent).toContain(
      "AI-generated summary from 1 source",
    );
    expect(label?.textContent).toContain("Not independently human-reviewed");
  });

  test("report link honours anchor targets for the on-page report form", () => {
    render(
      <LocaleProvider locale="ro">
        <AiDisclosureLabel sourceCount={2} reportHref="#raporteaza" />
      </LocaleProvider>,
    );
    expect(screen.getByRole("link").getAttribute("href")).toBe("#raporteaza");
  });
});
