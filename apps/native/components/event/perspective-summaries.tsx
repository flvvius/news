import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import Animated, { FadeIn } from "react-native-reanimated";

import { useT } from "@/contexts/locale-context";
import { cn } from "@/lib/cn";
import type { EventDetail } from "@/lib/event-types";

type Perspective = "reformist" | "neutral" | "suveranist";

const PERSPECTIVE_LABEL_KEY = {
  reformist: "event.left",
  neutral: "event.centerTab",
  suveranist: "event.right",
} as const;

/** Bias token underline for the active segment — labels carry the meaning. */
const PERSPECTIVE_BAR: Record<Perspective, string> = {
  reformist: "bg-bias-left",
  neutral: "bg-bias-center",
  suveranist: "bg-bias-right",
};

type PerspectiveSummariesProps = {
  perspectiveSummaries: EventDetail["event"]["perspectiveSummaries"];
  // false = the summarizer judged the story has no reformist/suveranist axis
  // (CASE D) — show a note instead of the segmented control. undefined =
  // legacy events, rendered exactly as before.
  perspectiveApplicable?: EventDetail["event"]["perspectiveApplicable"];
};

/**
 * Per-perspective summaries as a quiet segmented control. The neutral
 * (center) summary is already shown in the Summary zone above, so this
 * section opens on the first directional perspective to avoid repeating
 * the same paragraph twice at rest.
 */
export function PerspectiveSummaries({
  perspectiveSummaries,
  perspectiveApplicable,
}: PerspectiveSummariesProps) {
  const t = useT();

  const available: Perspective[] = (
    ["reformist", "neutral", "suveranist"] as Perspective[]
  ).filter((perspective) => Boolean(perspectiveSummaries?.[perspective]));
  const initial =
    available.find((perspective) => perspective !== "neutral") ?? "neutral";
  const [active, setActive] = useState<Perspective>(initial);

  if (perspectiveApplicable === false) {
    return (
      <View className="gap-4">
        <Text className="text-sm font-semibold uppercase tracking-[1.2px] text-muted-foreground">
          {t("event.multiplePerspectives")}
        </Text>
        <Text className="max-w-[455px] text-base leading-relaxed text-muted-foreground">
          {t("event.noPoliticalAxis")}
        </Text>
      </View>
    );
  }

  // Without at least one directional summary there is nothing to compare.
  if (!available.some((perspective) => perspective !== "neutral")) {
    return null;
  }

  const activeText =
    perspectiveSummaries?.[active] ?? t("event.summaryPending");

  return (
    <View className="gap-4">
      <Text className="text-sm font-semibold uppercase tracking-[1.2px] text-muted-foreground">
        {t("event.multiplePerspectives")}
      </Text>

      <View className="flex-row border-b border-border">
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
              className="min-h-11 flex-1 items-center justify-center active:opacity-70"
            >
              <Text
                className={cn(
                  "text-base",
                  isActive
                    ? "font-semibold text-foreground"
                    : "font-medium text-muted-foreground",
                )}
              >
                {label}
              </Text>
              <View
                className={cn(
                  "absolute bottom-0 left-3 right-3 h-0.5 rounded-full",
                  isActive ? PERSPECTIVE_BAR[perspective] : "bg-transparent",
                )}
              />
            </Pressable>
          );
        })}
      </View>

      <Animated.View key={active} entering={FadeIn.duration(150)}>
        <Text className="max-w-[455px] text-base leading-relaxed text-foreground">
          {activeText}
        </Text>
      </Animated.View>
    </View>
  );
}
