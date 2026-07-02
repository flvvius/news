import type { Id } from "@news-app/backend/convex/_generated/dataModel";
import { ScrollView, Text, View } from "react-native";

import { PressableScale } from "@/components/ui/pressable-scale";
import { Skeleton } from "@/components/ui/skeleton";
import { useT } from "@/contexts/locale-context";
import { cn } from "@/lib/cn";
import { topicLabelKey } from "@/lib/topic-label";

export type TopicOption = {
  _id: Id<"topics">;
  slug: string;
  displayName: string;
};

type TopicChipsProps = {
  topics: TopicOption[] | undefined;
  selectedTopic: Id<"topics"> | "all";
  onSelect: (topic: Id<"topics"> | "all") => void;
  /** Followed topics — surfaced first (after "All") for one-tap access. */
  pinnedTopicIds?: Id<"topics">[];
};

/**
 * Single horizontal row of topic chips. Switching is instant — chip
 * filters are touched dozens of times a day, so they get press feedback
 * and nothing else (frequency law).
 */
export function TopicChips({
  topics,
  selectedTopic,
  onSelect,
  pinnedTopicIds,
}: TopicChipsProps) {
  const t = useT();

  if (topics === undefined) {
    return (
      <View className="flex-row gap-2 px-5">
        <Skeleton className="h-9 w-16 rounded-md" />
        <Skeleton className="h-9 w-24 rounded-md" />
        <Skeleton className="h-9 w-20 rounded-md" />
      </View>
    );
  }

  // Pinned (followed) topics lead, in the order given; the rest follow in
  // their existing order. Pure reorder — every topic still appears.
  const pinned = pinnedTopicIds ?? [];
  const pinnedSet = new Set(pinned.map(String));
  const orderedTopics = [
    ...pinned
      .map((id) => topics.find((topic) => topic._id === id))
      .filter((topic): topic is TopicOption => topic !== undefined),
    ...topics.filter((topic) => !pinnedSet.has(String(topic._id))),
  ];

  const chips: Array<{ id: Id<"topics"> | "all"; label: string }> = [
    { id: "all", label: t("feed.topic.all") },
    ...orderedTopics.map((topic) => ({
      id: topic._id,
      label: t(topicLabelKey(topic.slug), topic.displayName),
    })),
  ];

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerClassName="flex-row gap-2 px-5"
      accessibilityRole="tablist"
    >
      {chips.map(({ id, label }) => {
        const isActive = selectedTopic === id;
        return (
          <PressableScale
            key={String(id)}
            accessibilityRole="tab"
            accessibilityLabel={label}
            accessibilityState={{ selected: isActive }}
            onPress={() => onSelect(id)}
            hitSlop={{ top: 6, bottom: 6 }}
            contentClassName={cn(
              "h-9 items-center justify-center rounded-md px-3.5",
              isActive ? "bg-primary" : "border border-border bg-background",
            )}
          >
            <Text
              className={cn(
                "text-sm font-medium",
                isActive ? "text-primary-foreground" : "text-foreground",
              )}
            >
              {label}
            </Text>
          </PressableScale>
        );
      })}
    </ScrollView>
  );
}
