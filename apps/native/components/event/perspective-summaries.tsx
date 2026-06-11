import { useState } from "react";
import { Pressable, Text, View } from "react-native";

import { SectionCard } from "@/components/ui/section-card";
import { useT } from "@/contexts/locale-context";
import { cn } from "@/lib/cn";
import type { EventDetail } from "@/lib/event-types";

type Perspective = "left" | "center" | "right";

const PERSPECTIVE_LABEL_KEY = {
  left: "event.left",
  center: "event.centerTab",
  right: "event.right",
} as const;

/** Bias-token dot shown on each perspective tab — never red/blue. */
const PERSPECTIVE_DOT: Record<Perspective, string> = {
  left: "bg-bias-left",
  center: "bg-bias-center",
  right: "bg-bias-right",
};

type PerspectiveSummariesProps = {
  perspectiveSummaries: EventDetail["event"]["perspectiveSummaries"];
};

export function PerspectiveSummaries({
  perspectiveSummaries,
}: PerspectiveSummariesProps) {
  const t = useT();
  const [active, setActive] = useState<Perspective>("center");

  const available: Perspective[] = (
    ["left", "center", "right"] as Perspective[]
  ).filter(
    (perspective) =>
      perspective === "center" || Boolean(perspectiveSummaries?.[perspective]),
  );
  const hasPerspectives = available.length > 1;

  if (!hasPerspectives) {
    return (
      <SectionCard title={t("event.summary")}>
        <Text className="max-w-[455px] text-base leading-relaxed text-card-foreground">
          {perspectiveSummaries?.center ?? t("event.compareOriginal")}
        </Text>
      </SectionCard>
    );
  }

  const activeText = perspectiveSummaries?.[active] ?? t("event.summaryPending");

  return (
    <SectionCard title={t("event.multiplePerspectives")}>
      <View className="gap-5">
        <View className="flex-row rounded-lg bg-muted p-1">
          {available.map((perspective) => {
            const isActive = perspective === active;
            const label = t(PERSPECTIVE_LABEL_KEY[perspective]);
            return (
              <Pressable
                key={perspective}
                accessibilityRole="tab"
                accessibilityLabel={label}
                accessibilityState={{ selected: isActive }}
                onPress={() => setActive(perspective)}
                className={cn(
                  "h-9 flex-1 flex-row items-center justify-center gap-1.5 rounded-md",
                  isActive && "bg-background",
                )}
              >
                <View
                  className={cn(
                    "size-2 rounded-full",
                    PERSPECTIVE_DOT[perspective],
                  )}
                />
                <Text
                  className={cn(
                    "text-base font-medium",
                    isActive ? "text-foreground" : "text-muted-foreground",
                  )}
                >
                  {label}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <Text className="max-w-[455px] text-base leading-relaxed text-card-foreground">
          {activeText}
        </Text>
      </View>
    </SectionCard>
  );
}
