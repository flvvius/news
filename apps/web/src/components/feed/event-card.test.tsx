// BIV-807 feed surface: the editorial row anatomy (kicker → title → bias bar
// → meta), no per-row card chrome or share/bookmark actions by default.
import { beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { Id } from "@news-app/backend/convex/_generated/dataModel";
import type { ReactElement } from "react";

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@tanstack/react-router")>();
  return {
    ...original,
    Link: ({ children, className }: { children: unknown; className?: string }) => (
      <a href="#" className={className}>
        {children as ReactElement}
      </a>
    ),
  };
});

vi.mock("@/components/bookmark-button", () => ({
  default: () => <button type="button">bookmark</button>,
}));

import EventCard from "./event-card";
import { LocaleProvider } from "@/lib/i18n/LocaleContext";

const baseEvent = {
  _id: "event1" as Id<"events">,
  slug: "test-event",
  title: "Guvernul a adoptat bugetul pe 2027",
  firstPublishedAt: Date.now() - 3_600_000,
  lastUpdatedAt: Date.now() - 1_800_000,
  topicIds: ["topic1" as Id<"topics">],
  articleCount: 12,
  sourceCount: 5,
  sourceBiasCounts: { left: 2, center: 2, right: 1 },
  imageUrl: "https://example.com/image.jpg",
  perspectiveSummaries: { neutral: "Rezumat neutru al evenimentului." },
};

const topicNamesById = { topic1: "Politică" };

function renderCard(props: Partial<Parameters<typeof EventCard>[0]> = {}) {
  return render(
    <LocaleProvider locale="ro">
      <EventCard
        event={baseEvent}
        topicNamesById={topicNamesById}
        {...props}
      />
    </LocaleProvider>,
  );
}

beforeEach(cleanup);

describe("EventCard editorial row (BIV-807)", () => {
  test("row anatomy: kicker, title, bias bar, meta", () => {
    renderCard();
    expect(screen.getByText("Politică")).toBeTruthy();
    expect(
      screen.getByText("Guvernul a adoptat bugetul pe 2027"),
    ).toBeTruthy();
    // 4px distribution bar carries the localized aria description.
    expect(screen.getByRole("img")).toBeTruthy();
    // Meta line: sources · articles · relative time, joined typographically.
    expect(screen.getByText(/5 surse · 12 articole ·/)).toBeTruthy();
  });

  test("no per-row actions by default — the feed is for reading", () => {
    renderCard();
    expect(screen.queryByRole("button")).toBeNull();
  });

  test("saved page opts into the bookmark action", () => {
    renderCard({ showBookmark: true });
    expect(screen.getByRole("button", { name: "bookmark" })).toBeTruthy();
  });

  test("feature (lead) row shows the neutral summary", () => {
    renderCard({ variant: "feature" });
    expect(
      screen.getByText("Rezumat neutru al evenimentului."),
    ).toBeTruthy();
  });

  test("no card chrome classes on the row", () => {
    const { container } = renderCard();
    expect(container.innerHTML).not.toContain("shadow-lg");
    expect(container.innerHTML).not.toContain("backdrop-blur");
  });
});
