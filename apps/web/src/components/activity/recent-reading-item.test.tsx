// BIV-821: recent-reading items show title, thumbnail, and timestamp · sources
// only — time spent and scroll depth stay in the interaction metadata but are
// never rendered.
import { beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactElement } from "react";

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@tanstack/react-router")>();
  return {
    ...original,
    Link: ({
      children,
      className,
      ...rest
    }: {
      children: unknown;
      className?: string;
    }) => (
      <a
        href="#"
        className={className}
        data-slot={(rest as Record<string, string>)["data-slot"]}
      >
        {children as ReactElement}
      </a>
    ),
  };
});

import {
  RecentReadingItem,
  type RecentReadingEntry,
} from "./recent-reading-item";
import { LocaleProvider } from "@/lib/i18n/LocaleContext";

const baseEntry: RecentReadingEntry = {
  event: {
    slug: "test-event",
    title: "Guvernul a adoptat bugetul pe 2027",
    imageUrl: "https://example.com/image.jpg",
    sourceCount: 5,
  },
  lastViewedAt: Date.now() - 3_600_000,
  metadata: {
    timeSpentSeconds: 300,
    scrollDepthPercentage: 0.8,
    deviceType: "mobile",
  },
};

function renderItem(entry: RecentReadingEntry = baseEntry) {
  return render(
    <LocaleProvider locale="ro">
      <RecentReadingItem entry={entry} />
    </LocaleProvider>,
  );
}

beforeEach(cleanup);

describe("RecentReadingItem (BIV-821)", () => {
  test("never shows time spent or scroll depth, even when metadata has them", () => {
    renderItem();

    // timeSpentSeconds: 300 would have formatted as "5 min";
    // scrollDepthPercentage: 0.8 as "80% derulat".
    expect(screen.queryByText(/min\b/)).toBeNull();
    expect(screen.queryByText(/derulat/)).toBeNull();
    expect(screen.queryByText(/%/)).toBeNull();
  });

  test("keeps title, thumbnail, and timestamp · sources meta", () => {
    const { container } = renderItem();

    expect(
      screen.getByText("Guvernul a adoptat bugetul pe 2027"),
    ).toBeTruthy();
    expect(screen.getByText("5 surse")).toBeTruthy();
    const image = container.querySelector(
      '[data-slot="recent-reading-thumbnail"] img',
    );
    expect(image?.getAttribute("src")).toBe("https://example.com/image.jpg");
  });

  test("layout stays a side-by-side row without the removed fields", () => {
    const { container } = renderItem();
    const row = container.querySelector('[data-slot="recent-reading-item"]');
    const thumbnail = container.querySelector(
      '[data-slot="recent-reading-thumbnail"]',
    );
    const copy = container.querySelector('[data-slot="recent-reading-copy"]');

    expect(row?.className).toContain("flex gap-3");
    expect(thumbnail?.className).toContain("shrink-0");
    expect(copy?.className).toContain("min-w-0 flex-1");
  });

  test("falls back to a placeholder icon without an image and one source", () => {
    const { container } = renderItem({
      ...baseEntry,
      event: { ...baseEntry.event, imageUrl: undefined, sourceCount: 1 },
      metadata: undefined,
    });

    expect(
      container.querySelector('[data-slot="recent-reading-thumbnail"] img'),
    ).toBeNull();
    expect(
      container.querySelector('[data-slot="recent-reading-thumbnail"] svg'),
    ).toBeTruthy();
    expect(screen.getByText("1 sursă")).toBeTruthy();
  });
});
