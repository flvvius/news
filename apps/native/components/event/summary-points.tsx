import { Text, View } from "react-native";

import { toSummaryPoints } from "@news-app/backend/convex/lib/summaryText";

/**
 * A summary rendered for scanning rather than for reading straight through
 * (BIV-820) — the native half of the web `SummaryBody`.
 *
 * Prompt v9 asks the model for short one-fact sentences; this splits them back
 * out into an opening line plus one bullet per remaining fact. Texts under
 * three sentences stay a plain paragraph, where a list would be more chrome
 * than help. The stored value is untouched prose, so share images, SEO and the
 * grounding record keep seeing exactly what the model wrote.
 */
export function SummaryPoints({
  text,
  leadCount = 1,
  tone = "foreground",
}: {
  text: string;
  /** 0 = every sentence becomes a bullet (used by the impact section). */
  leadCount?: number;
  tone?: "foreground" | "muted";
}) {
  const { lead, points } = toSummaryPoints(text, { leadCount });
  const textClass =
    tone === "muted"
      ? "max-w-[455px] text-base leading-relaxed text-muted-foreground"
      : "max-w-[455px] text-base leading-relaxed text-foreground";

  if (points.length === 0) {
    return <Text className={textClass}>{lead}</Text>;
  }

  return (
    <View className="gap-3">
      {lead ? <Text className={textClass}>{lead}</Text> : null}
      <View className="gap-2">
        {points.map((point, index) => (
          <View key={index} className="max-w-[455px] flex-row gap-2.5">
            <View className="mt-2.5 size-1.5 rounded-full bg-muted-foreground/50" />
            <Text className="min-w-0 flex-1 text-base leading-relaxed text-foreground">
              {point}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}
