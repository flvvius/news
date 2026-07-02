import type { Id } from "@news-app/backend/convex/_generated/dataModel";
import { Text, View } from "react-native";

import { PressableScale } from "@/components/ui/pressable-scale";
import { Skeleton } from "@/components/ui/skeleton";
import { useT } from "@/contexts/locale-context";
import { cn } from "@/lib/cn";
import { topicLabelKey } from "@/lib/topic-label";

export type PickerTopic = {
  _id: Id<"topics">;
  slug: string;
  displayName: string;
};

type TopicPickerGridProps = {
  topics: PickerTopic[] | undefined;
  selectedIds: ReadonlySet<string>;
  onToggle: (topicId: Id<"topics">) => void;
};

/**
 * Multi-select topic grid for onboarding (Screen B). Reuses the feed chip's
 * visual language — same height, radius, and selected/idle token treatment —
 * but wraps into a grid and toggles a multi-selection. Press feedback only;
 * no entrance animation (these are tapped rapidly while choosing).
 */
export function TopicPickerGrid({
  topics,
  selectedIds,
  onToggle,
}: TopicPickerGridProps) {
  if (topics === undefined) {
    return (
      <View className="flex-row flex-wrap gap-2">
        {Array.from({ length: 12 }).map((_, index) => (
          <Skeleton key={index} className="h-10 w-24 rounded-md" />
        ))}
      </View>
    );
  }

  return (
    <View className="flex-row flex-wrap gap-2" accessibilityRole="list">
      {topics.map((topic) => (
        <TopicChip
          key={topic._id}
          topic={topic}
          selected={selectedIds.has(String(topic._id))}
          onToggle={onToggle}
        />
      ))}
    </View>
  );
}

function TopicChip({
  topic,
  selected,
  onToggle,
}: {
  topic: PickerTopic;
  selected: boolean;
  onToggle: (topicId: Id<"topics">) => void;
}) {
  const t = useT();
  const label = t(topicLabelKey(topic.slug), topic.displayName);

  return (
    <PressableScale
      accessibilityRole="checkbox"
      accessibilityLabel={label}
      accessibilityState={{ checked: selected }}
      onPress={() => onToggle(topic._id)}
      hitSlop={{ top: 4, bottom: 4 }}
      contentClassName={cn(
        "h-10 items-center justify-center rounded-md px-4",
        selected ? "bg-primary" : "border border-border bg-background",
      )}
    >
      <Text
        className={cn(
          "text-sm font-medium",
          selected ? "text-primary-foreground" : "text-foreground",
        )}
      >
        {label}
      </Text>
    </PressableScale>
  );
}
