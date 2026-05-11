import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n/LocaleContext";

type StreakDay = {
  timestamp: number;
  readCount: number;
  isToday: boolean;
};

type StreakActivityCalendarProps = {
  days: StreakDay[];
  className?: string;
};

function chunkWeeks(days: Array<StreakDay | null>) {
  const weeks: Array<Array<StreakDay | null>> = [];
  for (let index = 0; index < days.length; index += 7) {
    weeks.push(days.slice(index, index + 7));
  }
  return weeks;
}

function getCellClassName(readCount: number) {
  if (readCount >= 3) return "bg-primary";
  if (readCount === 2) return "bg-primary/55";
  if (readCount === 1) return "bg-primary/25";
  return "bg-muted";
}

export default function StreakActivityCalendar({
  days,
  className,
}: StreakActivityCalendarProps) {
  const t = useT();
  const sortedDays = [...days].sort((a, b) => a.timestamp - b.timestamp);
  const firstDay = sortedDays[0];
  const leadingBlankCount = firstDay
    ? (new Date(firstDay.timestamp).getUTCDay() + 6) % 7
    : 0;
  const paddedDays = [
    ...Array.from({ length: leadingBlankCount }, () => null),
    ...sortedDays,
  ];
  const weeks = chunkWeeks(paddedDays);
  const monthFormatter = new Intl.DateTimeFormat(undefined, { month: "short" });
  const fullDateFormatter = new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
  });
  const weekdayRows = [
    t("calendar.weekday.mon"),
    t("calendar.weekday.tue"),
    t("calendar.weekday.wed"),
    t("calendar.weekday.thu"),
    t("calendar.weekday.fri"),
    t("calendar.weekday.sat"),
    t("calendar.weekday.sun"),
  ];
  const monthLabels = weeks.map((week, index) => {
    const firstRealDay = week.find((day) => day !== null);
    if (!firstRealDay) return "";

    const label = monthFormatter.format(new Date(firstRealDay.timestamp));
    if (index === 0) return label;

    const previousFirstRealDay = weeks[index - 1]?.find((day) => day !== null);
    if (!previousFirstRealDay) return label;

    const previousMonth = new Date(previousFirstRealDay.timestamp).getMonth();
    const currentMonth = new Date(firstRealDay.timestamp).getMonth();
    return previousMonth === currentMonth ? "" : label;
  });

  return (
    <div className={cn("space-y-3", className)}>
      <div className="flex gap-3 overflow-x-auto pb-1">
        <div className="grid grid-rows-7 gap-1 pt-5 text-[10px] text-muted-foreground">
          {Array.from({ length: 7 }, (_, index) => (
            <div key={index} className="flex h-3 items-center justify-end pr-1">
              {index % 2 === 0 ? weekdayRows[index] : ""}
            </div>
          ))}
        </div>

        <div className="flex gap-1">
          {weeks.map((week, weekIndex) => (
            <div key={weekIndex} className="space-y-1">
              <div className="h-4 text-[10px] text-muted-foreground">
                {monthLabels[weekIndex]}
              </div>
              <div className="grid grid-rows-7 gap-1">
                {week.map((day, dayIndex) =>
                  day ? (
                    <div
                      key={day.timestamp}
                      className={cn(
                        "h-3 w-3 rounded-[3px] border border-border/50",
                        getCellClassName(day.readCount),
                        day.isToday &&
                          "ring-1 ring-primary ring-offset-1 ring-offset-background",
                      )}
                      title={`${fullDateFormatter.format(new Date(day.timestamp))}: ${
                        day.readCount === 1
                          ? t("calendar.eventsRead.one").replace(
                              "{count}",
                              String(day.readCount),
                            )
                          : t("calendar.eventsRead.many").replace(
                              "{count}",
                              String(day.readCount),
                            )
                      }`}
                      aria-label={`${fullDateFormatter.format(new Date(day.timestamp))}: ${
                        day.readCount === 1
                          ? t("calendar.eventsRead.one").replace(
                              "{count}",
                              String(day.readCount),
                            )
                          : t("calendar.eventsRead.many").replace(
                              "{count}",
                              String(day.readCount),
                            )
                      }`}
                    />
                  ) : (
                    <div
                      key={`blank-${weekIndex}-${dayIndex}`}
                      className="h-3 w-3 rounded-[3px] bg-transparent"
                      aria-hidden="true"
                    />
                  ),
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="flex items-center justify-end gap-2 text-[11px] text-muted-foreground">
        <span>{t("calendar.less")}</span>
        <span className="h-3 w-3 rounded-[3px] bg-muted" />
        <span className="h-3 w-3 rounded-[3px] bg-primary/25" />
        <span className="h-3 w-3 rounded-[3px] bg-primary/55" />
        <span className="h-3 w-3 rounded-[3px] bg-primary" />
        <span>{t("calendar.more")}</span>
      </div>
    </div>
  );
}
