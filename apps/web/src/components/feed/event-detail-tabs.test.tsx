// MIEZ-3: the restructured story view — "Miezul" (neutral) core block on top,
// two equal-weight crusts (Coaja reformistă / Coaja suveranistă) below, sources
// beneath. BIV-804: the "Analiza afirmațiilor" claims tab must stay off.
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

const CORE = getString("ro", "event.core");
const CRUST_REFORMIST = getString("ro", "event.crustReformist");
const CRUST_SUVERANIST = getString("ro", "event.crustSuveranist");

describe("EventDetailTabs — Miezul + crusts (MIEZ-3)", () => {
  beforeEach(cleanup);

  test("claim analysis flag is off for launch", () => {
    expect(FEATURE_FLAGS.claimAnalysis).toBe(false);
  });

  test("promotes the neutral summary to the Miezul core block", () => {
    renderTabs({
      neutral: "Rezumat neutru",
      reformist: "Perspectiva reformistă",
      suveranist: "Perspectiva suveranistă",
    });

    // The core heading and neutral text render outside any tabpanel — the
    // neutral summary is no longer a tab.
    expect(screen.getByText(CORE)).toBeTruthy();
    const core = screen.getByText("Rezumat neutru");
    expect(core.closest('[role="tabpanel"]')).toBeNull();

    // No claims tab.
    expect(
      screen.queryByText(getString("ro", "event.claimBreakdown")),
    ).toBeNull();
  });

  test("renders both crusts, equal weight, both in the DOM at once", () => {
    renderTabs({
      neutral: "Rezumat neutru",
      reformist: "Perspectiva reformistă",
      suveranist: "Perspectiva suveranistă",
    });

    // Both crust bodies are present at once (forceMount for crawlers).
    expect(screen.getByText("Perspectiva reformistă")).toBeTruthy();
    expect(screen.getByText("Perspectiva suveranistă")).toBeTruthy();

    // Exactly one tablist (the mobile crust switcher) with two tabs, each
    // labelled by its camp.
    expect(screen.getAllByRole("tablist")).toHaveLength(1);
    expect(screen.getAllByRole("tab")).toHaveLength(2);
    expect(screen.getByRole("tab", { name: CRUST_REFORMIST })).toBeTruthy();
    expect(screen.getByRole("tab", { name: CRUST_SUVERANIST })).toBeTruthy();

    // The two crust panels carry the mobile-hide class but stay on desktop.
    const panel = screen
      .getByText("Perspectiva reformistă")
      .closest('[role="tabpanel"]');
    expect(panel?.className).toContain("data-[state=inactive]:hidden");
    expect(panel?.className).toContain("md:data-[state=inactive]:block");
  });

  test("mobile crust tabs switch the active panel", () => {
    renderTabs({
      neutral: "Rezumat neutru",
      reformist: "Perspectiva reformistă",
      suveranist: "Perspectiva suveranistă",
    });

    const panelState = (text: string) =>
      screen
        .getByText(text)
        .closest('[role="tabpanel"]')
        ?.getAttribute("data-state");

    // Switching to a crust makes its panel active and the other inactive
    // (Radix triggers activate on mousedown). This holds regardless of the
    // per-session random default.
    fireEvent.mouseDown(screen.getByRole("tab", { name: CRUST_SUVERANIST }));
    expect(panelState("Perspectiva suveranistă")).toBe("active");
    expect(panelState("Perspectiva reformistă")).toBe("inactive");

    fireEvent.mouseDown(screen.getByRole("tab", { name: CRUST_REFORMIST }));
    expect(panelState("Perspectiva reformistă")).toBe("active");
    expect(panelState("Perspectiva suveranistă")).toBe("inactive");
  });

  test("a single diverging crust renders full width, no tab bar", () => {
    renderTabs({
      neutral: "Rezumat neutru",
      reformist: "Doar reformistă",
    });

    expect(screen.queryAllByRole("tablist")).toHaveLength(0);
    expect(screen.getByText("Doar reformistă")).toBeTruthy();
    expect(screen.queryByText(CRUST_SUVERANIST)).toBeNull();
  });

  test("no crusts: just the Miezul core block, no tab bar", () => {
    renderTabs({ neutral: "Doar rezumat" });

    expect(screen.queryAllByRole("tablist")).toHaveLength(0);
    expect(screen.getByText(CORE)).toBeTruthy();
    expect(screen.getByText("Doar rezumat")).toBeTruthy();
    expect(screen.queryByText(CRUST_REFORMIST)).toBeNull();
  });

  test("CASE D (perspectiveApplicable=false) suppresses the crusts + notes it", () => {
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
});
