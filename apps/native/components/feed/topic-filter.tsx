import {
  BottomSheetBackdrop,
  BottomSheetFlatList,
  BottomSheetModal,
  type BottomSheetBackdropProps,
} from "@gorhom/bottom-sheet";
import type { Id } from "@news-app/backend/convex/_generated/dataModel";
import { useCallback, useMemo, useRef, useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { Icon } from "@/components/ui/icon";
import { useT } from "@/contexts/locale-context";
import { cn } from "@/lib/cn";
import { useTokenColor } from "@/lib/use-token-color";

export type TopicOption = {
  _id: Id<"topics">;
  displayName: string;
};

type TopicFilterProps = {
  topics: TopicOption[] | undefined;
  selectedTopic: Id<"topics"> | "all";
  onSelect: (topic: Id<"topics"> | "all") => void;
};

type TopicRow = { id: Id<"topics"> | "all"; label: string };

/**
 * Web mobile renders the topic picker in a Drawer with a searchable list;
 * the native equivalent is a bottom sheet with the same content.
 */
export function TopicFilter({ topics, selectedTopic, onSelect }: TopicFilterProps) {
  const t = useT();
  const sheetRef = useRef<BottomSheetModal>(null);
  const [search, setSearch] = useState("");
  const cardColor = useTokenColor("--color-card");
  const mutedForeground = useTokenColor("--color-muted-foreground");

  const allTopicsLabel = t("feed.topic.all");
  const selectedLabel =
    selectedTopic === "all"
      ? allTopicsLabel
      : (topics?.find((topic) => topic._id === selectedTopic)?.displayName ??
        t("feed.topic.single"));

  const rows = useMemo<TopicRow[]>(() => {
    const normalized = search.trim().toLowerCase();
    const allRow: TopicRow = { id: "all", label: allTopicsLabel };
    const topicRows: TopicRow[] = (topics ?? []).map((topic) => ({
      id: topic._id,
      label: topic.displayName,
    }));
    if (normalized.length === 0) return [allRow, ...topicRows];
    return [allRow, ...topicRows].filter((row) =>
      row.label.toLowerCase().includes(normalized),
    );
  }, [topics, search, allTopicsLabel]);

  const handleSelect = useCallback(
    (id: Id<"topics"> | "all") => {
      onSelect(id);
      setSearch("");
      sheetRef.current?.dismiss();
    },
    [onSelect],
  );

  const renderBackdrop = useCallback(
    (props: BottomSheetBackdropProps) => (
      <BottomSheetBackdrop
        {...props}
        appearsOnIndex={0}
        disappearsOnIndex={-1}
      />
    ),
    [],
  );

  return (
    <View className="flex-row items-center gap-2">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t("feed.topic.filter")}
        onPress={() => sheetRef.current?.present()}
        className={cn(
          "h-9 max-w-52 flex-row items-center justify-between gap-1.5 rounded-full border border-border bg-background px-3 active:opacity-80",
          selectedTopic !== "all" && "border-primary/50 bg-primary/5",
        )}
      >
        <View className="min-w-0 flex-1 flex-row items-center gap-2">
          <Icon name="filter-outline" size={14} className="text-foreground" />
          <Text
            numberOfLines={1}
            className="shrink text-sm font-medium text-foreground"
          >
            {selectedLabel}
          </Text>
        </View>
        <Icon
          name="chevron-down-outline"
          size={14}
          className="text-muted-foreground"
        />
      </Pressable>

      {selectedTopic !== "all" ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("feed.filter.clear")}
          onPress={() => onSelect("all")}
          hitSlop={8}
          className="size-9 items-center justify-center rounded-full active:opacity-70"
        >
          <Icon name="close-outline" size={16} className="text-foreground" />
        </Pressable>
      ) : null}

      <BottomSheetModal
        ref={sheetRef}
        snapPoints={["60%"]}
        enableDynamicSizing={false}
        backdropComponent={renderBackdrop}
        backgroundStyle={{ backgroundColor: cardColor }}
        handleIndicatorStyle={{ backgroundColor: mutedForeground }}
        onDismiss={() => setSearch("")}
      >
        <View className="border-b border-border px-4 pb-4">
          <Text className="text-base font-semibold text-foreground">
            {t("feed.topic.drawerTitle")}
          </Text>
          <Text className="mt-0.5 text-sm text-muted-foreground">
            {t("feed.topic.drawerBody")}
          </Text>
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder={t("feed.topic.search")}
            placeholderTextColorClassName="accent-muted-foreground"
            accessibilityLabel={t("feed.topic.search")}
            autoCapitalize="none"
            autoCorrect={false}
            className="mt-3 h-11 rounded-full border border-input bg-background px-4 text-base text-foreground"
          />
        </View>
        <BottomSheetFlatList
          data={rows}
          keyExtractor={(row: TopicRow) => String(row.id)}
          ListEmptyComponent={
            <Text className="px-4 py-6 text-center text-sm text-muted-foreground">
              {t("feed.topic.empty")}
            </Text>
          }
          renderItem={({ item }: { item: TopicRow }) => {
            const isSelected = selectedTopic === item.id;
            return (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={item.label}
                accessibilityState={{ selected: isSelected }}
                onPress={() => handleSelect(item.id)}
                className="min-h-11 flex-row items-center justify-between gap-2 px-4 py-3 active:bg-accent"
              >
                <Text className="text-base text-foreground">{item.label}</Text>
                {isSelected ? (
                  <Icon
                    name="checkmark-outline"
                    size={16}
                    className="text-primary"
                  />
                ) : null}
              </Pressable>
            );
          }}
        />
      </BottomSheetModal>
    </View>
  );
}
