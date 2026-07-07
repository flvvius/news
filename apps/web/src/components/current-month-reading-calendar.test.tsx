import { cleanup, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, test } from "vitest";

import { CurrentMonthReadingCalendar } from "@/components/current-month-reading-calendar";
import { LocaleProvider } from "@/lib/i18n/LocaleContext";

function renderCalendar({
  days = [],
  locale = "ro",
  now,
}: {
  days?: Array<{
    timestamp: number;
    activityCount: number;
    isToday: boolean;
  }>;
  locale?: "ro" | "en";
  now: number;
}) {
  return render(
    <LocaleProvider locale={locale}>
      <CurrentMonthReadingCalendar days={days} now={now} />
    </LocaleProvider>,
  );
}

beforeEach(cleanup);

describe("CurrentMonthReadingCalendar (BIV-820)", () => {
  test("renders the current month with Romanian labels and active reading days", () => {
    const now = Date.UTC(2026, 6, 15, 12);
    const { container } = renderCalendar({
      now,
      days: [
        { timestamp: Date.UTC(2026, 5, 30), activityCount: 9, isToday: false },
        { timestamp: Date.UTC(2026, 6, 1), activityCount: 2, isToday: false },
        { timestamp: Date.UTC(2026, 6, 15), activityCount: 1, isToday: true },
        { timestamp: Date.UTC(2026, 7, 1), activityCount: 3, isToday: false },
      ],
    });

    expect(screen.getByText("Iulie 2026")).toBeTruthy();
    for (const weekday of ["Lun", "Mar", "Mie", "Joi", "Vin", "Sâm", "Dum"]) {
      expect(screen.getByText(weekday)).toBeTruthy();
    }
    expect(
      container.querySelectorAll('[data-current-month-day="true"]'),
    ).toHaveLength(31);
    expect(container.querySelectorAll('[data-active-day="true"]')).toHaveLength(
      2,
    );
    expect(
      container
        .querySelector('[data-day="1"]')
        ?.getAttribute("data-activity-count"),
    ).toBe("2");
    expect(screen.getByLabelText("1 iulie 2026: 2 lecturi")).toBeTruthy();
    expect(screen.getByLabelText("15 iulie 2026: 1 lectură")).toBeTruthy();
  });

  test("renders an empty month with plain legend labels", () => {
    const { container } = renderCalendar({
      now: Date.UTC(2026, 4, 10, 12),
      days: [],
    });

    expect(screen.getByText("Mai 2026")).toBeTruthy();
    expect(container.querySelectorAll('[data-active-day="true"]')).toHaveLength(
      0,
    );
    expect(screen.getAllByText("Fără lectură").length).toBeGreaterThan(0);
    expect(screen.getByText("Zi cu lectură")).toBeTruthy();
  });

  test("handles month boundaries without rendering adjacent-month days", () => {
    const now = Date.UTC(2026, 1, 12, 12);
    const { container } = renderCalendar({
      now,
      days: [
        { timestamp: Date.UTC(2026, 0, 31), activityCount: 4, isToday: false },
        { timestamp: Date.UTC(2026, 2, 1), activityCount: 5, isToday: false },
      ],
    });

    expect(screen.getByText("Februarie 2026")).toBeTruthy();
    expect(
      container.querySelectorAll('[data-current-month-day="true"]'),
    ).toHaveLength(28);
    expect(container.querySelectorAll('[data-active-day="true"]')).toHaveLength(
      0,
    );
    expect(container.querySelectorAll('[data-leading-blank="true"]')).toHaveLength(
      6,
    );
    expect(container.querySelectorAll('[data-calendar-week="true"]')).toHaveLength(
      5,
    );
  });

  test("marks today's cell independently of activity", () => {
    const now = Date.UTC(2026, 3, 20, 12);
    const { container } = renderCalendar({ now, days: [] });

    const today = container.querySelector('[data-day="20"]');
    expect(today?.getAttribute("data-today")).toBe("true");
    expect(today?.getAttribute("data-activity-count")).toBe("0");
  });
});
