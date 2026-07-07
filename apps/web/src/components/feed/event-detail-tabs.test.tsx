// BIV-804: the "Analiza afirmațiilor" (claims) tab must not ship while claim
// analysis is paused; the remaining perspective tabs must render and switch.
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
) {
  return render(
    <LocaleProvider locale="ro">
      <EventDetailTabs
        eventId={eventId}
        perspectiveSummaries={perspectiveSummaries}
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

  test("remaining perspective tabs render and switch correctly", () => {
    renderTabs({
      neutral: "Rezumat neutru",
      reformist: "Perspectiva reformistă",
      suveranist: "Perspectiva suveranistă",
    });

    const tabs = screen.getAllByRole("tab");
    expect(tabs).toHaveLength(3);

    // Neutral (center) is the default visible panel.
    expect(screen.getByText("Rezumat neutru")).toBeTruthy();

    // Radix tab triggers activate on mousedown, not click.
    fireEvent.mouseDown(screen.getByText(getString("ro", "event.left")));
    expect(screen.getByText("Perspectiva reformistă")).toBeTruthy();

    fireEvent.mouseDown(screen.getByText(getString("ro", "event.right")));
    expect(screen.getByText("Perspectiva suveranistă")).toBeTruthy();
  });

  test("tab layout stays intentional with fewer perspectives", () => {
    renderTabs({ neutral: "Doar rezumat" });

    // With no reformist/suveranist summaries there is no tab bar at all —
    // just the summary card.
    expect(screen.queryAllByRole("tablist")).toHaveLength(0);
    expect(screen.getByText("Doar rezumat")).toBeTruthy();
  });
});
