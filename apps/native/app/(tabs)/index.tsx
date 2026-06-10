import { api } from "@news-app/backend/convex/_generated/api";
import type { Id } from "@news-app/backend/convex/_generated/dataModel";
import { FlashList } from "@shopify/flash-list";
import { usePaginatedQuery, useQuery } from "convex/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, RefreshControl, Text, View } from "react-native";

import { EventCard, type FeedEvent } from "@/components/event-card";
import { EventCardSkeleton } from "@/components/feed/event-card-skeleton";
import { TopicFilter } from "@/components/feed/topic-filter";
import { Screen } from "@/components/screen";
import { Icon, type IconName } from "@/components/ui/icon";
import { QueryBoundary } from "@/components/ui/query-boundary";
import { EmptyState } from "@/components/ui/state-views";
import { cn } from "@/lib/cn";

type FeedSort = "recent" | "trending";

const MAX_FEED_PAGE_SIZE = 50;
const MAX_EVENT_CARD_SOURCES = 10;

function clampConfigNumber(
  raw: unknown,
  fallback: number,
  min: number,
  max: number,
): number {
  const value = Number(raw);
  return Number.isFinite(value)
    ? Math.min(max, Math.max(min, Math.floor(value)))
    : fallback;
}

function SortToggleButton({
  label,
  icon,
  isActive,
  onPress,
}: {
  label: string;
  icon: IconName;
  isActive: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Sort by ${label}`}
      accessibilityState={{ selected: isActive }}
      onPress={onPress}
      className={cn(
        "h-7 flex-row items-center gap-1 rounded-full px-3",
        isActive && "bg-background",
      )}
    >
      <Icon
        name={icon}
        size={13}
        className={isActive ? "text-foreground" : "text-muted-foreground"}
      />
      <Text
        className={cn(
          "text-xs font-medium",
          isActive ? "text-foreground" : "text-muted-foreground",
        )}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function SectionHeading({ title }: { title: string }) {
  return (
    <Text className="text-lg font-semibold tracking-tight text-foreground">
      {title}
    </Text>
  );
}

export default function FeedScreen() {
  return (
    <Screen>
      <QueryBoundary
        title="Couldn't load the feed"
        body="Something went wrong while loading events. Pull to retry or check your connection."
      >
        <FeedContent />
      </QueryBoundary>
    </Screen>
  );
}

function FeedContent() {
  const topics = useQuery(api.topics.getTopics);
  const runtimeConfig = useQuery(api.config.getPublicRuntimeConfig);

  const pageSize = clampConfigNumber(
    runtimeConfig?.feedPageSize,
    6,
    1,
    MAX_FEED_PAGE_SIZE,
  );
  const maxSources = clampConfigNumber(
    runtimeConfig?.eventCardMaxSources,
    5,
    0,
    MAX_EVENT_CARD_SOURCES,
  );

  const [selectedTopic, setSelectedTopic] = useState<Id<"topics"> | "all">(
    "all",
  );
  const [feedSort, setFeedSort] = useState<FeedSort>("trending");
  const [refreshKey, setRefreshKey] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const topicNamesById = useMemo(() => {
    const map: Record<string, string> = {};
    topics?.forEach((topic) => {
      map[topic._id] = topic.displayName;
    });
    return map;
  }, [topics]);

  const handleRefresh = useCallback(() => {
    setIsRefreshing(true);
    // Convex queries are live; pull-to-refresh resets pagination to page one
    // by remounting the paginated subtree (no manual refetching).
    setRefreshKey((key) => key + 1);
  }, []);

  return (
    <View className="flex-1">
      <View className="gap-2.5 border-b border-border/70 bg-card/90 px-4 pb-3 pt-2">
        <View className="flex-row items-center justify-between gap-2">
          <View className="min-w-0 shrink">
            <TopicFilter
              topics={topics}
              selectedTopic={selectedTopic}
              onSelect={setSelectedTopic}
            />
          </View>
          <View className="h-9 flex-row items-center rounded-full bg-muted/70 p-1">
            <SortToggleButton
              label="Recent"
              icon="time-outline"
              isActive={feedSort === "recent"}
              onPress={() => setFeedSort("recent")}
            />
            <SortToggleButton
              label="Trending"
              icon="trending-up-outline"
              isActive={feedSort === "trending"}
              onPress={() => setFeedSort("trending")}
            />
          </View>
        </View>
      </View>

      <FeedList
        key={`${refreshKey}:${feedSort}:${String(selectedTopic)}`}
        feedSort={feedSort}
        selectedTopic={selectedTopic}
        pageSize={pageSize}
        maxSources={maxSources}
        topicNamesById={topicNamesById}
        isRefreshing={isRefreshing}
        onRefresh={handleRefresh}
        onFirstPageLoaded={() => setIsRefreshing(false)}
      />
    </View>
  );
}

function FeedList({
  feedSort,
  selectedTopic,
  pageSize,
  maxSources,
  topicNamesById,
  isRefreshing,
  onRefresh,
  onFirstPageLoaded,
}: {
  feedSort: FeedSort;
  selectedTopic: Id<"topics"> | "all";
  pageSize: number;
  maxSources: number;
  topicNamesById: Record<string, string>;
  isRefreshing: boolean;
  onRefresh: () => void;
  onFirstPageLoaded: () => void;
}) {
  const {
    results: events,
    status,
    loadMore,
  } = usePaginatedQuery(
    api.events.getPublishedEvents,
    selectedTopic === "all"
      ? { sort: feedSort }
      : { topicId: selectedTopic, sort: feedSort },
    { initialNumItems: pageSize },
  );

  useEffect(() => {
    if (status !== "LoadingFirstPage") {
      onFirstPageLoaded();
    }
  }, [status, onFirstPageLoaded]);

  const featuredEvent = events[0];
  const remainingEvents = useMemo(() => events.slice(1), [events]);

  const handleEndReached = useCallback(() => {
    if (status === "CanLoadMore") {
      loadMore(pageSize);
    }
  }, [status, loadMore, pageSize]);

  if (status === "LoadingFirstPage") {
    return (
      <View className="flex-1 gap-5 px-4 pt-5">
        <EventCardSkeleton />
        <EventCardSkeleton />
      </View>
    );
  }

  if (events.length === 0) {
    return (
      <View className="flex-1 px-4 pt-6">
        <EmptyState
          title="No events yet"
          body={
            selectedTopic === "all"
              ? "Published events will show up here as soon as coverage lands."
              : "No published events for this topic yet. Try another topic."
          }
        />
      </View>
    );
  }

  return (
    <FlashList
      data={remainingEvents}
      keyExtractor={(event: FeedEvent) => event._id}
      getItemType={() => "event-card"}
      contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 32 }}
      onEndReached={handleEndReached}
      onEndReachedThreshold={1.2}
      refreshControl={
        <RefreshControl
          refreshing={isRefreshing}
          onRefresh={onRefresh}
          tintColorClassName="accent-primary"
          colorsClassName="accent-primary"
        />
      }
      ListHeaderComponent={
        featuredEvent ? (
          <View className="gap-4 pb-5 pt-5">
            <SectionHeading
              title={feedSort === "recent" ? "Lead story" : "Trending story"}
            />
            <EventCard
              event={featuredEvent}
              topicNamesById={topicNamesById}
              maxSources={maxSources}
              variant="feature"
            />
            {remainingEvents.length > 0 ? (
              <View className="pt-2">
                <SectionHeading title="More events" />
              </View>
            ) : null}
          </View>
        ) : null
      }
      ItemSeparatorComponent={() => <View className="h-5" />}
      renderItem={({ item }: { item: FeedEvent }) => (
        <EventCard
          event={item}
          topicNamesById={topicNamesById}
          maxSources={maxSources}
        />
      )}
      ListFooterComponent={
        status === "LoadingMore" ? (
          <View className="items-center py-6">
            <Text
              accessibilityLiveRegion="polite"
              className="text-sm text-muted-foreground"
            >
              Loading more events…
            </Text>
          </View>
        ) : null
      }
    />
  );
}
