import { api } from "@news-app/backend/convex/_generated/api";
import { useConvexAuth, useQuery } from "convex/react";
import { useRouter } from "expo-router";
import { useMemo } from "react";
import { FlashList } from "@shopify/flash-list";
import { Text, View } from "react-native";

import { EventCard, type EventCardEvent } from "@/components/event-card";
import { EventCardSkeleton } from "@/components/feed/event-card-skeleton";
import { Screen } from "@/components/screen";
import { QueryBoundary } from "@/components/ui/query-boundary";
import { EmptyState } from "@/components/ui/state-views";

function clampMaxSources(raw: unknown): number {
  const value = Number(raw);
  return Number.isFinite(value)
    ? Math.min(10, Math.max(0, Math.floor(value)))
    : 5;
}

function SavedHeader({ count }: { count?: number }) {
  return (
    <View className="overflow-hidden rounded-[1.6rem] border border-border/70 bg-card/80">
      <View className="gap-3 px-6 py-7">
        <Text className="text-xs font-semibold uppercase tracking-[2.4px] text-muted-foreground">
          Saved
        </Text>
        <Text className="text-3xl font-bold tracking-tight text-foreground">
          Saved events
        </Text>
        <Text className="max-w-[40ch] text-sm leading-relaxed text-muted-foreground">
          {count === undefined
            ? "Events you bookmark stay here so you can come back to every side of the story."
            : count === 1
              ? "1 saved event."
              : `${count} saved events.`}
        </Text>
      </View>
    </View>
  );
}

export default function SavedScreen() {
  return (
    <Screen>
      <QueryBoundary
        title="Couldn't load your saved events"
        body="Something went wrong while loading bookmarks. Try again."
      >
        <SavedContent />
      </QueryBoundary>
    </Screen>
  );
}

function SavedContent() {
  const router = useRouter();
  const { isAuthenticated, isLoading: isAuthLoading } = useConvexAuth();

  if (isAuthLoading) {
    return (
      <View className="flex-1 gap-5 px-4 pt-5">
        <EventCardSkeleton />
        <EventCardSkeleton />
      </View>
    );
  }

  if (!isAuthenticated) {
    return (
      <View className="flex-1 px-4 pt-6">
        <EmptyState
          icon="bookmark-outline"
          title="Save events for later"
          body="Sign in to bookmark events and keep your reading list in sync across devices."
          actionLabel="Sign in"
          onAction={() => router.push("/auth")}
        />
      </View>
    );
  }

  return <SavedList />;
}

function SavedList() {
  const router = useRouter();
  const bookmarks = useQuery(api.interactions.getBookmarkedEvents);
  const topics = useQuery(api.topics.getTopics);
  const runtimeConfig = useQuery(api.config.getPublicRuntimeConfig);
  const maxSources = clampMaxSources(runtimeConfig?.eventCardMaxSources);

  const topicNamesById = useMemo(() => {
    const map: Record<string, string> = {};
    topics?.forEach((topic) => {
      map[topic._id] = topic.displayName;
    });
    return map;
  }, [topics]);

  if (bookmarks === undefined) {
    return (
      <View className="flex-1 gap-5 px-4 pt-5">
        <EventCardSkeleton />
        <EventCardSkeleton />
      </View>
    );
  }

  if (bookmarks.length === 0) {
    return (
      <View className="flex-1 gap-5 px-4 pt-5">
        <SavedHeader count={0} />
        <EmptyState
          icon="bookmark-outline"
          title="Nothing saved yet"
          body="Tap the bookmark on any event to keep it here for later."
          actionLabel="Browse the feed"
          onAction={() => router.push("/")}
        />
      </View>
    );
  }

  return (
    <FlashList
      data={bookmarks}
      keyExtractor={(event: EventCardEvent) => event._id}
      getItemType={() => "event-card"}
      contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 32 }}
      ListHeaderComponent={
        <View className="pb-5 pt-5">
          <SavedHeader count={bookmarks.length} />
        </View>
      }
      ItemSeparatorComponent={() => <View className="h-5" />}
      renderItem={({ item }: { item: EventCardEvent }) => (
        <EventCard
          event={item}
          topicNamesById={topicNamesById}
          maxSources={maxSources}
        />
      )}
    />
  );
}
