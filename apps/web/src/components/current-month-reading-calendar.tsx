import { cn } from "@/lib/utils";
import { useLocale, useT } from "@/lib/i18n/LocaleContext";

const DAY_MS = 24 * 60 * 60 * 1000;

export type ReadingCalendarDay = {
  timestamp: number;
  activityCount: number;
  isToday: boolean;
};

type CalendarCell =
  | { kind: "blank"; key: string; position: "leading" | "trailing" }
  | {
      kind: "day";
      timestamp: number;
      dayOfMonth: number;
      activityCount: number;
      isToday: boolean;
    };

type CurrentMonthReadingCalendarProps = {
  days: ReadingCalendarDay[];
  now?: number;
  className?: string;
};

function startOfUtcDay(timestamp: number) {
  return Math.floor(timestamp / DAY_MS) * DAY_MS;
}

function capitalize(value: string) {
  return value.charAt(0).toLocaleUpperCase() + value.slice(1);
}

function chunkWeeks(cells: CalendarCell[]) {
  const weeks: CalendarCell[][] = [];
  for (let index = 0; index < cells.length; index += 7) {
    weeks.push(cells.slice(index, index + 7));
  }
  return weeks;
}

function getActivityLabel(
  t: ReturnType<typeof useT>,
  activityCount: number,
) {
  if (activityCount <= 0) return t("calendar.noReading");
  const key =
    activityCount === 1
      ? "calendar.readingActivity.one"
      : "calendar.readingActivity.many";
  return t(key).replace("{count}", String(activityCount));
}

export function CurrentMonthReadingCalendar({
  days,
  now = Date.now(),
  className,
}: CurrentMonthReadingCalendarProps) {
  const locale = useLocale();
  const t = useT();
  const currentDate = new Date(now);
  const year = currentDate.getUTCFullYear();
  const month = currentDate.getUTCMonth();
  const monthStart = Date.UTC(year, month, 1);
  const nextMonthStart = Date.UTC(year, month + 1, 1);
  const dayCount = Math.round((nextMonthStart - monthStart) / DAY_MS);
  const today = startOfUtcDay(now);
  const activityByDay = new Map(
    days.map((day) => [startOfUtcDay(day.timestamp), day]),
  );

  const leadingBlankCount = (new Date(monthStart).getUTCDay() + 6) % 7;
  const monthCells: CalendarCell[] = Array.from(
    { length: dayCount },
    (_, index) => {
      const timestamp = monthStart + index * DAY_MS;
      const sourceDay = activityByDay.get(timestamp);
      return {
        kind: "day",
        timestamp,
        dayOfMonth: index + 1,
        activityCount: sourceDay?.activityCount ?? 0,
        isToday: sourceDay?.isToday ?? timestamp === today,
      };
    },
  );
  const trailingBlankCount =
    (7 - ((leadingBlankCount + monthCells.length) % 7)) % 7;
  const weeks = chunkWeeks([
    ...Array.from({ length: leadingBlankCount }, (_, index) => ({
      kind: "blank" as const,
      key: `leading-${index}`,
      position: "leading" as const,
    })),
    ...monthCells,
    ...Array.from({ length: trailingBlankCount }, (_, index) => ({
      kind: "blank" as const,
      key: `trailing-${index}`,
      position: "trailing" as const,
    })),
  ]);

  const monthTitle = capitalize(
    new Intl.DateTimeFormat(locale, {
      month: "long",
      timeZone: "UTC",
      year: "numeric",
    }).format(new Date(monthStart)),
  );
  const dateFormatter = new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "long",
    timeZone: "UTC",
    year: "numeric",
  });
  const weekdayLabels = [
    t("calendar.weekday.mon"),
    t("calendar.weekday.tue"),
    t("calendar.weekday.wed"),
    t("calendar.weekday.thu"),
    t("calendar.weekday.fri"),
    t("calendar.weekday.sat"),
    t("calendar.weekday.sun"),
  ];

  return (
    <div className={cn("space-y-4", className)}>
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-base font-semibold text-foreground">
          {monthTitle}
        </h3>
        <span className="text-sm text-muted-foreground">
          {t("activity.currentMonthReading")}
        </span>
      </div>

      <div
        role="grid"
        aria-label={monthTitle}
        className="space-y-2"
        data-calendar-month={month + 1}
        data-calendar-year={year}
      >
        <div
          role="row"
          className="grid grid-cols-7 gap-1 text-center text-xs font-medium text-muted-foreground"
        >
          {weekdayLabels.map((label) => (
            <div key={label} role="columnheader" className="py-1">
              {label}
            </div>
          ))}
        </div>

        {weeks.map((week, weekIndex) => (
          <div
            key={weekIndex}
            role="row"
            className="grid grid-cols-7 gap-1"
            data-calendar-week="true"
          >
            {week.map((cell) => {
              if (cell.kind === "blank") {
                return (
                  <div
                    key={cell.key}
                    role="gridcell"
                    aria-hidden="true"
                    className="aspect-square rounded-md"
                    data-leading-blank={cell.position === "leading"}
                    data-trailing-blank={cell.position === "trailing"}
                  />
                );
              }

              const isActive = cell.activityCount > 0;
              const label = `${dateFormatter.format(new Date(cell.timestamp))}: ${getActivityLabel(
                t,
                cell.activityCount,
              )}`;

              return (
                <div
                  key={cell.timestamp}
                  role="gridcell"
                  aria-label={label}
                  className={cn(
                    "flex aspect-square min-h-10 flex-col items-center justify-center rounded-md border text-sm tabular-nums",
                    isActive
                      ? "border-primary/30 bg-primary/15 text-foreground"
                      : "border-border bg-muted/35 text-muted-foreground",
                    cell.isToday &&
                      "ring-2 ring-ring ring-offset-2 ring-offset-background",
                  )}
                  data-active-day={isActive}
                  data-activity-count={cell.activityCount}
                  data-current-month-day="true"
                  data-day={cell.dayOfMonth}
                  data-today={cell.isToday}
                >
                  <span>{cell.dayOfMonth}</span>
                  <span
                    className={cn(
                      "mt-1 size-1.5 rounded-full",
                      isActive ? "bg-primary" : "bg-transparent",
                    )}
                    aria-hidden="true"
                  />
                </div>
              );
            })}
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center justify-end gap-3 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <span className="size-3 rounded-sm border border-border bg-muted/35" />
          {t("calendar.legend.emptyDay")}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="size-3 rounded-sm border border-primary/30 bg-primary/15" />
          {t("calendar.legend.readingDay")}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="size-3 rounded-sm border border-border ring-2 ring-ring ring-offset-1 ring-offset-background" />
          {t("calendar.today")}
        </span>
      </div>
    </div>
  );
}
