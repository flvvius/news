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
