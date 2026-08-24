// BIV-804: the "Analiza afirmațiilor" (claims) tab must not ship while claim
// analysis is paused; the remaining perspective tabs must render and switch.
// MIEZ: the centre (neutral) tab is relabelled "Miezul".
import { describe, expect, test } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach } from "vitest";
import type { Id } from "@news-app/backend/convex/_generated/dataModel";

import { EventDetailTabs } from "./event-detail-tabs";
import { FEATURE_FLAGS } from "@/lib/feature-flags";
import { LocaleProvider } from "@/lib/i18n/LocaleContext";
import { getString } from "@/lib/i18n/strings";

const eventId = "event123" as Id<"events">;

function renderTabs(
  perspectiveSummaries: Parameters<
    typeof EventDetailTabs
  >[0]["perspectiveSummaries"],
  perspectiveApplicable?: boolean,
) {
  return render(
    <LocaleProvider locale="ro">
      <EventDetailTabs
        eventId={eventId}
        perspectiveSummaries={perspectiveSummaries}
        perspectiveApplicable={perspectiveApplicable}
        globalImpact={null}
        articles={[]}
      />
    </LocaleProvider>,
  );
}

beforeEach(cleanup);

describe("EventDetailTabs (BIV-804)", () => {
  test("claim analysis flag is off for launch", () => {
    expect(FEATURE_FLAGS.claimAnalysis).toBe(false);
  });

  test("does not render the claims tab or panel", () => {
    renderTabs({
      neutral: "Rezumat neutru",
      reformist: "Perspectiva reformistă",
      suveranist: "Perspectiva suveranistă",
    });

    const claimsLabel = getString("ro", "event.claimBreakdown");
    expect(screen.queryByText(claimsLabel)).toBeNull();
    // No leftover single-tab outer chrome either: the only tablist is the
    // perspectives one.
    expect(screen.getAllByRole("tablist")).toHaveLength(1);
  });

  test("perspective tabs render, with the centre tab labelled Miezul", () => {
    renderTabs({
      neutral: "Rezumat neutru",
      reformist: "Perspectiva reformistă",
      suveranist: "Perspectiva suveranistă",
    });

    const tabs = screen.getAllByRole("tab");
    expect(tabs).toHaveLength(3);
    // Centre tab is now "Miezul", flanked by the reformist/suveranist tabs.
    expect(
      screen.getByRole("tab", { name: getString("ro", "event.core") }),
    ).toBeTruthy();
    expect(
      screen.getByRole("tab", { name: getString("ro", "event.left") }),
    ).toBeTruthy();
    expect(
      screen.getByRole("tab", { name: getString("ro", "event.right") }),
    ).toBeTruthy();
  });

  test("tabs switch correctly, centre active by default", () => {
    renderTabs({
      neutral: "Rezumat neutru",
      reformist: "Perspectiva reformistă",
      suveranist: "Perspectiva suveranistă",
    });

    const panelFor = (text: string) => {
      const panel = screen.getByText(text).closest('[role="tabpanel"]');
      if (!panel) throw new Error(`No tabpanel for "${text}"`);
      return panel as HTMLElement;
    };
    const stateOf = (text: string) => panelFor(text).getAttribute("data-state");

    // All panels are force-mounted for SSR/crawlers; only the selected one may
    // be active, and each must carry the hide class.
    for (const text of [
      "Rezumat neutru",
      "Perspectiva reformistă",
      "Perspectiva suveranistă",
    ]) {
      expect(panelFor(text).className).toContain(
        "data-[state=inactive]:hidden",
      );
    }

    // Miezul (centre) is the default active panel.
    expect(stateOf("Rezumat neutru")).toBe("active");
    expect(stateOf("Perspectiva reformistă")).toBe("inactive");
    expect(stateOf("Perspectiva suveranistă")).toBe("inactive");

    // Radix tab triggers activate on mousedown, not click.
    fireEvent.mouseDown(screen.getByText(getString("ro", "event.left")));
    expect(stateOf("Perspectiva reformistă")).toBe("active");
    expect(stateOf("Rezumat neutru")).toBe("inactive");

    fireEvent.mouseDown(screen.getByText(getString("ro", "event.right")));
    expect(stateOf("Perspectiva suveranistă")).toBe("active");
    expect(stateOf("Perspectiva reformistă")).toBe("inactive");
  });

  test("tab layout stays intentional with fewer perspectives", () => {
    renderTabs({ neutral: "Doar rezumat" });

    // With no reformist/suveranist summaries there is no tab bar at all —
    // just the summary card.
    expect(screen.queryAllByRole("tablist")).toHaveLength(0);
    expect(screen.getByText("Doar rezumat")).toBeTruthy();
  });

  test("CASE D (perspectiveApplicable=false) shows the no-axis note instead of tabs", () => {
    // Directional summaries present on purpose: the guard must suppress the
    // tab bar even when hasPerspectives would otherwise be true.
    renderTabs(
      {
        neutral: "Rezumat apolitic",
        reformist: "Perspectiva reformistă",
        suveranist: "Perspectiva suveranistă",
      },
      false,
    );

    expect(screen.queryAllByRole("tablist")).toHaveLength(0);
    expect(screen.getByText("Rezumat apolitic")).toBeTruthy();
    expect(screen.queryByText("Perspectiva reformistă")).toBeNull();
    expect(screen.queryByText("Perspectiva suveranistă")).toBeNull();
    expect(
      screen.getByText(getString("ro", "event.noPoliticalAxis")),
    ).toBeTruthy();
  });

  test("legacy events (perspectiveApplicable undefined) show no note", () => {
    renderTabs({ neutral: "Doar rezumat" });

    expect(
      screen.queryByText(getString("ro", "event.noPoliticalAxis")),
    ).toBeNull();
  });

  test("global impact renders as its own section", () => {
    render(
      <LocaleProvider locale="ro">
        <EventDetailTabs
          eventId={eventId}
          perspectiveSummaries={{ neutral: "Rezumat neutru" }}
          globalImpact="Impactul global al acestei știri."
          articles={[]}
        />
      </LocaleProvider>,
    );

    expect(screen.getByText(getString("ro", "event.meaning"))).toBeTruthy();
    expect(
      screen.getByText("Impactul global al acestei știri."),
    ).toBeTruthy();
  });
});

// BIV-820 — readability. A production sample of 40 events averaged 23 words
// per sentence in one unbroken block, and 35% of the rendered "Ce înseamnă
// asta" sections were the "no impact stated" fallback under a heading that
// promised the opposite.
describe("EventDetailTabs readability (BIV-820)", () => {
  const longNeutral =
    "Guvernul a amânat consultările pe legea salarizării. Partidele au cerut mai mult timp. Legea trebuie adoptată până la 31 august. Valoarea de referință scade cu 100 de lei.";

  function renderWithImpact(globalImpact: string | null) {
    return render(
      <LocaleProvider locale="ro">
        <EventDetailTabs
          eventId={eventId}
          perspectiveSummaries={{ neutral: longNeutral }}
          perspectiveApplicable={false}
          globalImpact={globalImpact}
          articles={[]}
        />
      </LocaleProvider>,
    );
  }

  test("the core summary renders as a lead line plus one bullet per fact", () => {
    renderWithImpact(null);

    // Lead sentence stays a paragraph; the remaining facts become list items.
    expect(
      screen.getByText("Guvernul a amânat consultările pe legea salarizării."),
    ).toBeTruthy();
    const points = screen.getAllByRole("listitem");
    expect(points).toHaveLength(3);
    expect(points[0]!.textContent).toBe("Partidele au cerut mai mult timp.");
    // Nothing the model wrote is dropped on the way to the list.
    expect(
      points.map((item) => item.textContent).join(" "),
    ).toBe(
      "Partidele au cerut mai mult timp. Legea trebuie adoptată până la 31 august. Valoarea de referință scade cu 100 de lei.",
    );
  });

  test("a two-sentence summary stays a paragraph, with no list chrome", () => {
    render(
      <LocaleProvider locale="ro">
        <EventDetailTabs
          eventId={eventId}
          perspectiveSummaries={{
            neutral: "Guvernul a amânat votul. Partidele au cerut timp.",
          }}
          perspectiveApplicable={false}
          globalImpact={null}
          articles={[]}
        />
      </LocaleProvider>,
    );
    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
  });

  test("a real impact renders under its heading, every line a bullet", () => {
    renderWithImpact(
      "Angajaţii din sistemul public riscă salarii îngheţate din septembrie. România pierde 770 de milioane de euro din PNRR. Bugetul pe 2027 rămâne fără finanţarea tranşei.",
    );

    expect(screen.getByText(getString("ro", "event.meaning"))).toBeTruthy();
    // leadCount 0 — the impact section is a pure list of consequences.
    expect(
      screen
        .getAllByRole("listitem")
        .some((item) =>
          item.textContent?.startsWith("Angajaţii din sistemul public"),
        ),
    ).toBe(true);
  });

  test("the 'no impact stated' fallback drops the whole section", () => {
    renderWithImpact("Impactul concret nu este precizat în articolele furnizate.");

    expect(screen.queryByText(getString("ro", "event.meaning"))).toBeNull();
    expect(
      screen.queryByText(/Impactul concret nu este precizat/),
    ).toBeNull();
  });

  test("a qualified variant of the fallback is dropped too", () => {
    renderWithImpact(
      "Impactul concret nu este precizat în articolele furnizate în ceea ce privește eventuale restricții de circulație.",
    );

    expect(screen.queryByText(getString("ro", "event.meaning"))).toBeNull();
  });

  test("per-sentence source attribution survives the bulleting", () => {
    render(
      <LocaleProvider locale="ro">
        <EventDetailTabs
          eventId={eventId}
          perspectiveSummaries={{ neutral: longNeutral }}
          perspectiveApplicable={false}
          globalImpact={null}
          articles={[]}
          grounding={{
            results: [
              {
                field: "neutral",
                sentence: "Partidele au cerut mai mult timp.",
                supportingSources: ["Digi24", "Adevărul"],
              },
            ],
          }}
        />
      </LocaleProvider>,
    );

    expect(
      screen.getByTitle("Susținut de: Digi24, Adevărul").textContent,
    ).toBe("Partidele au cerut mai mult timp.");
  });
});
