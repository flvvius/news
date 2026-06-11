import { api } from "@news-app/backend/convex/_generated/api";
import type { Id } from "@news-app/backend/convex/_generated/dataModel";
import { FlashList } from "@shopify/flash-list";
import { usePaginatedQuery, useQuery } from "convex/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Pressable,
  RefreshControl,
  Text,
  TextInput,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";

import { EventCard, type FeedEvent } from "@/components/event-card";
import { EventCardSkeleton } from "@/components/feed/event-card-skeleton";
import { TopicFilter } from "@/components/feed/topic-filter";
import { Screen } from "@/components/screen";
import { Icon, type IconName } from "@/components/ui/icon";
import { QueryBoundary } from "@/components/ui/query-boundary";
import { EmptyState } from "@/components/ui/state-views";
import { useT } from "@/contexts/locale-context";
import { cn } from "@/lib/cn";

type FeedSort = "recent" | "trending";

const MAX_FEED_PAGE_SIZE = 50;
const MAX_EVENT_CARD_SOURCES = 10;

/** Fixed height of the floating feed toolbar (one compact control row). */
const HEADER_HEIGHT = 52;
/** Top padding for list content so it starts below the floating toolbar. */
const LIST_TOP_PADDING = HEADER_HEIGHT + 20;
/** Scroll distance (px) before the toolbar starts hiding/revealing. */
const SCROLL_DIRECTION_THRESHOLD = 6;

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
  const t = useT();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t("native.feed.sortBy").replace("{label}", label)}
      accessibilityState={{ selected: isActive }}
      onPress={onPress}
      className={cn(
        "h-7 flex-row items-center gap-1 rounded-full",
        // Compact segmented control: only the active segment carries its
        // label, so the row width no longer depends on translation length.
        isActive ? "bg-background px-3" : "px-2.5",
      )}
    >
      <Icon
        name={icon}
        size={13}
        className={isActive ? "text-foreground" : "text-muted-foreground"}
      />
      {isActive ? (
        <Text className="text-xs font-medium text-foreground">{label}</Text>
      ) : null}
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
  const t = useT();

  return (
    <Screen>
      <QueryBoundary
        title={t("native.feed.errorTitle")}
        body={t("native.feed.errorBody")}
      >
        <FeedContent />
      </QueryBoundary>
    </Screen>
  );
}

function FeedContent() {
  const t = useT();
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
  const [searchMode, setSearchMode] = useState(false);
  const [searchInput, setSearchInput] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");

  useEffect(() => {
    const timeout = setTimeout(() => {
      setDebouncedSearch(searchInput.trim());
    }, 250);
    return () => clearTimeout(timeout);
  }, [searchInput]);

  const isSearching = searchMode && debouncedSearch.length >= 2;

  // Partially persistent toolbar (NN/g): hide on scroll down, reveal on any
  // scroll up or near the top. Pinned while searching.
  const headerShown = useSharedValue(1);
  const lastOffsetY = useRef(0);
  const searchModeRef = useRef(searchMode);
  searchModeRef.current = searchMode;

  const headerStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: (headerShown.value - 1) * HEADER_HEIGHT }],
    opacity: headerShown.value,
  }));

  const handleListScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const y = event.nativeEvent.contentOffset.y;
      const delta = y - lastOffsetY.current;
      lastOffsetY.current = y;
      if (searchModeRef.current) return;

      if (y <= HEADER_HEIGHT) {
        headerShown.value = withTiming(1, { duration: 250 });
      } else if (delta > SCROLL_DIRECTION_THRESHOLD) {
        headerShown.value = withTiming(0, { duration: 250 });
      } else if (delta < -SCROLL_DIRECTION_THRESHOLD) {
        headerShown.value = withTiming(1, { duration: 250 });
      }
    },
    [headerShown],
  );

  const enterSearchMode = useCallback(() => {
    setSearchMode(true);
    headerShown.value = withTiming(1, { duration: 200 });
  }, [headerShown]);

  const exitSearchMode = useCallback(() => {
    setSearchMode(false);
    setSearchInput("");
    setDebouncedSearch("");
  }, []);

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
      <Animated.View
        style={[{ height: HEADER_HEIGHT }, headerStyle]}
        className="absolute left-0 right-0 top-0 z-10 justify-center border-b border-border/70 bg-card/95 px-4"
      >
        {searchMode ? (
          <View className="flex-row items-center gap-2">
            <View className="h-9 min-w-0 flex-1 flex-row items-center gap-2 rounded-full border border-input bg-background px-3">
              <Icon
                name="search-outline"
                size={15}
                className="text-muted-foreground"
              />
              <TextInput
                value={searchInput}
                onChangeText={setSearchInput}
                placeholder={t("feed.search.placeholder")}
                placeholderTextColorClassName="accent-muted-foreground"
                accessibilityLabel={t("feed.search.label")}
                autoFocus
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="search"
                className="h-9 min-w-0 flex-1 text-base text-foreground"
              />
              {searchInput.length > 0 ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t("feed.search.clear")}
                  onPress={() => setSearchInput("")}
                  hitSlop={8}
                >
                  <Icon
                    name="close-circle"
                    size={16}
                    className="text-muted-foreground"
                  />
                </Pressable>
              ) : null}
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("feed.search.clear")}
              onPress={exitSearchMode}
              hitSlop={8}
              className="size-9 items-center justify-center rounded-full active:bg-muted/60"
            >
              <Icon name="close-outline" size={20} className="text-foreground" />
            </Pressable>
          </View>
        ) : (
          <View className="flex-row items-center gap-2">
            <View className="min-w-0 flex-1">
              <TopicFilter
                topics={topics}
                selectedTopic={selectedTopic}
                onSelect={setSelectedTopic}
              />
            </View>
            <View className="h-9 flex-row items-center rounded-full bg-muted/70 p-1">
              <SortToggleButton
                label={t("feed.sort.recent")}
                icon="time-outline"
                isActive={feedSort === "recent"}
                onPress={() => setFeedSort("recent")}
              />
              <SortToggleButton
                label={t("feed.sort.trending")}
                icon="trending-up-outline"
                isActive={feedSort === "trending"}
                onPress={() => setFeedSort("trending")}
              />
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("feed.search.label")}
              onPress={enterSearchMode}
              className="size-9 items-center justify-center rounded-full border border-border bg-background active:opacity-80"
            >
              <Icon name="search-outline" size={16} className="text-foreground" />
            </Pressable>
          </View>
        )}
      </Animated.View>

      {isSearching ? (
        <SearchResults
          query={debouncedSearch}
          selectedTopic={selectedTopic}
          pageSize={pageSize}
          maxSources={maxSources}
          topicNamesById={topicNamesById}
        />
      ) : (
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
          onScroll={handleListScroll}
        />
      )}
    </View>
  );
}

function SearchResults({
  query,
  selectedTopic,
  pageSize,
  maxSources,
  topicNamesById,
}: {
  query: string;
  selectedTopic: Id<"topics"> | "all";
  pageSize: number;
  maxSources: number;
  topicNamesById: Record<string, string>;
}) {
  const t = useT();
  const results = useQuery(api.events.searchPublishedEvents, {
    query,
    limit: pageSize,
    topicId: selectedTopic === "all" ? undefined : selectedTopic,
  });

  if (results === undefined) {
    return (
      <View
        className="flex-1 gap-5 px-4"
        style={{ paddingTop: LIST_TOP_PADDING }}
      >
        <Text
          accessibilityLiveRegion="polite"
          className="text-sm text-muted-foreground"
        >
          {t("feed.searching")}
        </Text>
        <EventCardSkeleton />
        <EventCardSkeleton />
      </View>
    );
  }

  if (results.length === 0) {
    return (
      <View className="flex-1 px-4" style={{ paddingTop: LIST_TOP_PADDING + 4 }}>
        <EmptyState
          icon="search-outline"
          title={t("native.feed.emptyTitle")}
          body={t("native.feed.searchEmpty").replace("{query}", query)}
        />
      </View>
    );
  }

  const [topResult, ...moreResults] = results;

  return (
    <FlashList
      data={moreResults}
      keyExtractor={(event: FeedEvent) => event._id}
      getItemType={() => "event-card"}
      contentContainerStyle={{
        paddingHorizontal: 16,
        paddingBottom: 32,
        paddingTop: HEADER_HEIGHT,
      }}
      keyboardShouldPersistTaps="handled"
      ListHeaderComponent={
        <View className="gap-4 pb-5 pt-5">
          <View className="gap-1">
            <SectionHeading title={t("feed.topSearch")} />
            <Text className="text-xs text-muted-foreground">
              {t("feed.search.indexed").replace("{query}", query)}
            </Text>
          </View>
          <EventCard
            event={topResult}
            topicNamesById={topicNamesById}
            maxSources={maxSources}
            variant="feature"
          />
          {moreResults.length > 0 ? (
            <View className="pt-2">
              <SectionHeading title={t("feed.moreSearch")} />
            </View>
          ) : null}
        </View>
      }
      ItemSeparatorComponent={() => <View className="h-5" />}
      renderItem={({ item }: { item: FeedEvent }) => (
        <EventCard
          event={item}
          topicNamesById={topicNamesById}
          maxSources={maxSources}
        />
      )}
    />
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
  onScroll,
}: {
  feedSort: FeedSort;
  selectedTopic: Id<"topics"> | "all";
  pageSize: number;
  maxSources: number;
  topicNamesById: Record<string, string>;
  isRefreshing: boolean;
  onRefresh: () => void;
  onFirstPageLoaded: () => void;
  onScroll: (event: NativeSyntheticEvent<NativeScrollEvent>) => void;
}) {
  const t = useT();
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
      <View
        className="flex-1 gap-5 px-4"
        style={{ paddingTop: LIST_TOP_PADDING }}
      >
        <EventCardSkeleton />
        <EventCardSkeleton />
      </View>
    );
  }

  if (events.length === 0) {
    return (
      <View className="flex-1 px-4" style={{ paddingTop: LIST_TOP_PADDING + 4 }}>
        <EmptyState
          title={t("native.feed.emptyTitle")}
          body={
            selectedTopic === "all"
              ? t("native.feed.emptyBody")
              : t("native.feed.emptyBodyTopic")
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
      contentContainerStyle={{
        paddingHorizontal: 16,
        paddingBottom: 32,
        paddingTop: HEADER_HEIGHT,
      }}
      onEndReached={handleEndReached}
      onEndReachedThreshold={1.2}
      onScroll={onScroll}
      scrollEventThrottle={16}
      refreshControl={
        <RefreshControl
          refreshing={isRefreshing}
          onRefresh={onRefresh}
          progressViewOffset={HEADER_HEIGHT}
          tintColorClassName="accent-primary"
          colorsClassName="accent-primary"
        />
      }
      ListHeaderComponent={
        featuredEvent ? (
          <View className="gap-4 pb-5 pt-5">
            <SectionHeading
              title={
                feedSort === "recent"
                  ? t("feed.leadStory")
                  : t("feed.trendingStory")
              }
            />
            <EventCard
              event={featuredEvent}
              topicNamesById={topicNamesById}
              maxSources={maxSources}
              variant="feature"
            />
            {remainingEvents.length > 0 ? (
              <View className="pt-2">
                <SectionHeading title={t("feed.moreEvents")} />
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
              {t("native.feed.loadingMore")}
            </Text>
          </View>
        ) : null
      }
    />
  );
}
