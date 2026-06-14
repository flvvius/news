import { api } from "@news-app/backend/convex/_generated/api";
import type { Id } from "@news-app/backend/convex/_generated/dataModel";
import { FlashList } from "@shopify/flash-list";
import { usePaginatedQuery, useQuery } from "convex/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, RefreshControl, Text, TextInput, View } from "react-native";

import { EventRow, type FeedEvent } from "@/components/event-row";
import { EventRowSkeleton } from "@/components/feed/event-row-skeleton";
import { StreakTeaserBanner } from "@/components/feed/streak-teaser-banner";
import { TopicChips } from "@/components/feed/topic-chips";
import { Screen } from "@/components/screen";
import { Icon } from "@/components/ui/icon";
import { QueryBoundary } from "@/components/ui/query-boundary";
import { EmptyState } from "@/components/ui/state-views";
import { useAnalytics } from "@/contexts/analytics-context";
import { useFollowedTopics } from "@/contexts/followed-topics-context";
import { useT } from "@/contexts/locale-context";
import { markFiredOncePerSession } from "@/lib/analytics-session";
import { cn } from "@/lib/cn";
import { stableTopicBoost } from "@/lib/feed-boost";
import { topicLabelKey } from "@/lib/topic-label";

type FeedSort = "recent" | "trending";

const MAX_FEED_PAGE_SIZE = 50;

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

/** Hairline between rows — the only separator the feed uses. */
function RowSeparator() {
  return <View className="h-px bg-border" />;
}

function FeedLoadingRows() {
  return (
    <View className="flex-1 px-5">
      <EventRowSkeleton lead />
      <RowSeparator />
      <EventRowSkeleton />
      <RowSeparator />
      <EventRowSkeleton />
    </View>
  );
}

/**
 * Plain-text segmented control: state reads through weight and color,
 * not pills. Switching is instant (frequency law).
 */
function SortTextControl({
  value,
  onChange,
}: {
  value: FeedSort;
  onChange: (sort: FeedSort) => void;
}) {
  const t = useT();
  const options: Array<{ value: FeedSort; label: string }> = [
    { value: "trending", label: t("feed.sort.trending") },
    { value: "recent", label: t("feed.sort.recent") },
  ];

  return (
    <View className="flex-row gap-6" accessibilityRole="tablist">
      {options.map((option) => {
        const isActive = option.value === value;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="tab"
            accessibilityLabel={t("native.feed.sortBy").replace(
              "{label}",
              option.label,
            )}
            accessibilityState={{ selected: isActive }}
            onPress={() => onChange(option.value)}
            hitSlop={8}
            className="min-h-11 justify-center active:opacity-70"
          >
            <Text
              className={cn(
                "text-sm",
                isActive
                  ? "font-semibold text-foreground"
                  : "font-medium text-muted-foreground",
              )}
            >
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
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
  const { track } = useAnalytics();
  const { followedTopicIds } = useFollowedTopics();
  const topics = useQuery(api.topics.getTopics);
  const runtimeConfig = useQuery(api.config.getPublicRuntimeConfig);

  const pageSize = clampConfigNumber(
    runtimeConfig?.feedPageSize,
    6,
    1,
    MAX_FEED_PAGE_SIZE,
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

  const exitSearchMode = useCallback(() => {
    setSearchMode(false);
    setSearchInput("");
    setDebouncedSearch("");
  }, []);

  const topicNamesById = useMemo(() => {
    const map: Record<string, string> = {};
    topics?.forEach((topic) => {
      map[topic._id] = t(topicLabelKey(topic.slug), topic.displayName);
    });
    return map;
  }, [topics, t]);

  const handleRefresh = useCallback(() => {
    setIsRefreshing(true);
    // Convex queries are live; pull-to-refresh resets pagination to page one
    // by remounting the paginated subtree (no manual refetching).
    setRefreshKey((key) => key + 1);
  }, []);

  // Fire `first_feed_render` once per SESSION (Ticket 16), not once per mount —
  // remounting the feed tab must not re-fire the impression.
  const handleFirstPageLoaded = useCallback(() => {
    setIsRefreshing(false);
    if (markFiredOncePerSession("first_feed_render")) {
      track({ name: "first_feed_render" });
    }
  }, [track]);

  return (
    <View className="flex-1">
      {/* Static masthead — no hide-on-scroll: the feed is read dozens of
          times a day, so its chrome holds still. */}
      <View className="gap-3 border-b border-border pb-3">
        {searchMode ? (
          <View className="flex-row items-center gap-3 px-5 pt-2">
            <View className="h-11 min-w-0 flex-1 flex-row items-center gap-2 rounded-md border border-input bg-background px-3">
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
                className="h-11 min-w-0 flex-1 text-base text-foreground"
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
              className="min-h-11 justify-center active:opacity-70"
            >
              <Text className="text-base font-medium text-foreground">
                {t("native.feed.searchCancel")}
              </Text>
            </Pressable>
          </View>
        ) : (
          <>
            <View className="flex-row items-center justify-between px-5 pt-2">
              <Text className="text-3xl font-semibold tracking-tight text-foreground">
                Biviant
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t("feed.search.label")}
                onPress={() => setSearchMode(true)}
                hitSlop={6}
                className="size-11 items-center justify-center active:opacity-70"
              >
                <Icon
                  name="search-outline"
                  size={20}
                  className="text-foreground"
                />
              </Pressable>
            </View>
            <TopicChips
              topics={topics}
              selectedTopic={selectedTopic}
              onSelect={setSelectedTopic}
              pinnedTopicIds={followedTopicIds}
            />
            <View className="px-5">
              <SortTextControl value={feedSort} onChange={setFeedSort} />
            </View>
          </>
        )}
      </View>

      {isSearching ? (
        <SearchResults
          query={debouncedSearch}
          selectedTopic={selectedTopic}
          pageSize={pageSize}
          topicNamesById={topicNamesById}
        />
      ) : (
        <>
          {/* Guest streak teaser — inline, self-hiding (renders nothing unless
              a guest is on their 2nd–3rd reading day and hasn't dismissed). */}
          <StreakTeaserBanner />
          <FeedList
          key={`${refreshKey}:${feedSort}:${String(selectedTopic)}`}
          feedSort={feedSort}
          selectedTopic={selectedTopic}
          followedTopicIds={followedTopicIds}
          pageSize={pageSize}
          topicNamesById={topicNamesById}
          isRefreshing={isRefreshing}
          onRefresh={handleRefresh}
          onFirstPageLoaded={handleFirstPageLoaded}
          />
        </>
      )}
    </View>
  );
}

function SearchResults({
  query,
  selectedTopic,
  pageSize,
  topicNamesById,
}: {
  query: string;
  selectedTopic: Id<"topics"> | "all";
  pageSize: number;
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
      <View className="flex-1 gap-2 px-5 pt-4">
        <Text
          accessibilityLiveRegion="polite"
          className="text-sm text-muted-foreground"
        >
          {t("feed.searching")}
        </Text>
        <EventRowSkeleton />
        <RowSeparator />
        <EventRowSkeleton />
      </View>
    );
  }

  if (results.length === 0) {
    return (
      <View className="flex-1 px-5">
        <EmptyState
          title={t("native.feed.emptyTitle")}
          body={t("native.feed.searchEmpty").replace("{query}", query)}
        />
      </View>
    );
  }

  return (
    <FlashList
      data={results}
      keyExtractor={(event: FeedEvent) => event._id}
      getItemType={() => "event-row"}
      contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 24 }}
      keyboardShouldPersistTaps="handled"
      ListHeaderComponent={
        <Text className="pt-4 text-[11px] font-semibold uppercase tracking-[1.6px] text-muted-foreground">
          {t("feed.search.indexed").replace("{query}", query)}
        </Text>
      }
      ItemSeparatorComponent={RowSeparator}
      renderItem={({ item }: { item: FeedEvent }) => (
        <EventRow event={item} topicNamesById={topicNamesById} />
      )}
    />
  );
}

function FeedList({
  feedSort,
  selectedTopic,
  followedTopicIds,
  pageSize,
  topicNamesById,
  isRefreshing,
  onRefresh,
  onFirstPageLoaded,
}: {
  feedSort: FeedSort;
  selectedTopic: Id<"topics"> | "all";
  followedTopicIds: Id<"topics">[];
  pageSize: number;
  topicNamesById: Record<string, string>;
  isRefreshing: boolean;
  onRefresh: () => void;
  onFirstPageLoaded: () => void;
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

  const followedSet = useMemo(
    () => new Set(followedTopicIds.map(String)),
    [followedTopicIds],
  );

  // HARD GUARANTEE (topic boost, layer 1): the rank-1 global cluster — the
  // day's biggest story — is always the lead and is NEVER displaced, demoted,
  // or filtered out by topic selection. The boost below only reorders what
  // comes after it.
  const leadEvent = events[0];

  const remainingEvents = useMemo(() => {
    const rest = events.slice(1);
    // Boost (layer 2) applies only to the unfiltered "all" view and only as a
    // STABLE reorder: followed-topic stories rise above the rest, but every
    // story still appears — this is a boost, never a filter. A specific topic
    // chip uses the existing single-topic query instead.
    if (selectedTopic !== "all" || followedSet.size === 0) {
      return rest;
    }
    // Ticket 12: freeze the FIRST page's boosted order and append later pages in
    // natural order, so loading more never reorders rows already on screen. The
    // lead (events[0]) is excluded from `rest` and always stays position 1. The
    // first page contributed `pageSize - 1` items to `rest` (the lead took one).
    return stableTopicBoost(rest, pageSize - 1, (event) =>
      (event.topicIds ?? []).some((id) => followedSet.has(String(id))),
    );
  }, [events, selectedTopic, followedSet, pageSize]);

  const handleEndReached = useCallback(() => {
    if (status === "CanLoadMore") {
      loadMore(pageSize);
    }
  }, [status, loadMore, pageSize]);

  if (status === "LoadingFirstPage") {
    return <FeedLoadingRows />;
  }

  if (events.length === 0) {
    return (
      <View className="flex-1 px-5">
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
      getItemType={() => "event-row"}
      contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 24 }}
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
        leadEvent ? (
          <View>
            <EventRow
              event={leadEvent}
              topicNamesById={topicNamesById}
              variant="lead"
            />
            {remainingEvents.length > 0 ? <RowSeparator /> : null}
          </View>
        ) : null
      }
      ItemSeparatorComponent={RowSeparator}
      renderItem={({ item }: { item: FeedEvent }) => (
        <EventRow event={item} topicNamesById={topicNamesById} />
      )}
      ListFooterComponent={
        status === "LoadingMore" ? (
          <View accessibilityLiveRegion="polite">
            <RowSeparator />
            <EventRowSkeleton />
          </View>
        ) : null
      }
    />
  );
}
