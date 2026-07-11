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

  test("non-highlighted feed row keeps a larger reserved image beside the text", () => {
    const { container } = renderCard();
    const row = container.querySelector('[data-slot="event-card-list-row"]');
    const copy = container.querySelector('[data-slot="event-card-list-copy"]');
    const thumbnail = container.querySelector(
      '[data-slot="event-card-list-thumbnail"]',
    );
    const image = thumbnail?.querySelector("img");

    // Stacks on mobile, side-by-side from `sm:` up (responsive row layout);
    // the image keeps a reserved box (sm:h-36 sm:w-48) beside the copy.
    expect(row?.className).toContain("flex flex-col gap-3");
    expect(row?.className).toContain("sm:flex-row");
    expect(copy?.className).toContain("min-w-0 flex-1");
    expect(thumbnail?.className).toContain("shrink-0");
    expect(thumbnail?.className).toContain("sm:h-36 sm:w-48");
    expect(image?.getAttribute("width")).toBe("128");
    expect(image?.getAttribute("height")).toBe("96");
    // Thumbnail renders first in the DOM but displays last (sm:order-last).
    expect(thumbnail?.className).toContain("sm:order-last");
  });

  test("saved page row keeps the same side-by-side thumbnail with bookmark action", () => {
    const { container } = renderCard({ showBookmark: true });
    const row = container.querySelector('[data-slot="event-card-list-row"]');
    const thumbnail = container.querySelector(
      '[data-slot="event-card-list-thumbnail"]',
    );

    expect(screen.getByRole("button", { name: "bookmark" })).toBeTruthy();
    expect(row?.className).toContain("sm:flex-row");
    expect(thumbnail?.className).toContain("sm:h-36 sm:w-48");
  });

  test("feature row keeps the full-width image treatment unchanged", () => {
    const { container } = renderCard({ variant: "feature" });

    expect(
      container.querySelector('[data-slot="event-card-list-thumbnail"]'),
    ).toBeNull();
    expect(container.querySelector(".aspect-3\\/2.w-full")).toBeTruthy();
  });

  test("no card chrome classes on the row", () => {
    const { container } = renderCard();
    expect(container.innerHTML).not.toContain("shadow-lg");
    expect(container.innerHTML).not.toContain("backdrop-blur");
  });
});

describe("EventCard mobile layout guard (BIV-819)", () => {
  test("list rows keep min-width and shrink constraints that prevent mobile overflow", () => {
    const { container } = renderCard({ showBookmark: true });
    const shell = container.firstElementChild;
    const link = container.querySelector("a");
    const copy = container.querySelector('[data-slot="event-card-list-copy"]');
    const thumbnail = container.querySelector(
      '[data-slot="event-card-list-thumbnail"]',
    );

    expect(shell?.className).toContain("flex gap-3");
    expect(link?.className).toContain("min-w-0 flex-1");
    expect(copy?.className).toContain("min-w-0 flex-1");
    expect(thumbnail?.className).toContain("shrink-0");
  });
});
