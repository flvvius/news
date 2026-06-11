import { ScrollView, Text, View } from "react-native";

import { useLocale, useT } from "@/contexts/locale-context";
import { cn } from "@/lib/cn";

export type StreakDay = {
  timestamp: number;
  activityCount: number;
  isToday: boolean;
};

type StreakActivityCalendarProps = {
  days: StreakDay[];
};

function chunkWeeks(days: Array<StreakDay | null>) {
  const weeks: Array<Array<StreakDay | null>> = [];
  for (let index = 0; index < days.length; index += 7) {
    weeks.push(days.slice(index, index + 7));
  }
  return weeks;
}

function getCellClassName(activityCount: number) {
  if (activityCount >= 3) return "bg-primary";
  if (activityCount === 2) return "bg-primary/55";
  if (activityCount === 1) return "bg-primary/25";
  return "bg-muted";
}

/** Native port of the web streak-activity-calendar (apps/web). */
export function StreakActivityCalendar({ days }: StreakActivityCalendarProps) {
  const t = useT();
  const locale = useLocale();
  const intlLocale = locale === "ro" ? "ro-RO" : "en-US";
  const sortedDays = [...days].sort((a, b) => a.timestamp - b.timestamp);
  const firstDay = sortedDays[0];
  const leadingBlankCount = firstDay
    ? (new Date(firstDay.timestamp).getUTCDay() + 6) % 7
    : 0;
  const paddedDays: Array<StreakDay | null> = [
    ...Array.from({ length: leadingBlankCount }, () => null),
    ...sortedDays,
  ];
  const weeks = chunkWeeks(paddedDays);
  const monthFormatter = new Intl.DateTimeFormat(intlLocale, {
    month: "short",
  });
  const fullDateFormatter = new Intl.DateTimeFormat(intlLocale, {
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

  const dayLabel = (day: StreakDay) =>
    `${fullDateFormatter.format(new Date(day.timestamp))}: ${
      day.activityCount === 1
        ? t("calendar.eventsRead.one").replace(
            "{count}",
            String(day.activityCount),
          )
        : t("calendar.eventsRead.many").replace(
            "{count}",
            String(day.activityCount),
          )
    }`;

  return (
    <View className="gap-3">
      <View className="flex-row gap-3">
        <View className="gap-1 pt-5">
          {Array.from({ length: 7 }, (_, index) => (
            <View key={index} className="h-3 items-end justify-center pr-1">
              <Text className="text-[10px] leading-3 text-muted-foreground">
                {index % 2 === 0 ? weekdayRows[index] : ""}
              </Text>
            </View>
          ))}
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <View className="flex-row gap-1 pb-1">
            {weeks.map((week, weekIndex) => (
              <View key={weekIndex} className="gap-1">
                <View className="h-4">
                  <Text className="text-[10px] leading-4 text-muted-foreground">
                    {monthLabels[weekIndex]}
                  </Text>
                </View>
                {week.map((day, dayIndex) =>
                  day ? (
                    <View
                      key={day.timestamp}
                      accessibilityLabel={dayLabel(day)}
                      className={cn(
                        "h-3 w-3 rounded-[3px] border",
                        day.isToday ? "border-primary" : "border-border/50",
                        getCellClassName(day.activityCount),
                      )}
                    />
                  ) : (
                    <View
                      key={`blank-${weekIndex}-${dayIndex}`}
                      accessibilityElementsHidden
                      className="h-3 w-3 rounded-[3px]"
                    />
                  ),
                )}
              </View>
            ))}
          </View>
        </ScrollView>
      </View>

      <View className="flex-row items-center justify-end gap-2">
        <Text className="text-[11px] text-muted-foreground">
          {t("calendar.less")}
        </Text>
        <View className="h-3 w-3 rounded-[3px] bg-muted" />
        <View className="h-3 w-3 rounded-[3px] bg-primary/25" />
        <View className="h-3 w-3 rounded-[3px] bg-primary/55" />
        <View className="h-3 w-3 rounded-[3px] bg-primary" />
        <Text className="text-[11px] text-muted-foreground">
          {t("calendar.more")}
        </Text>
      </View>
    </View>
  );
}
