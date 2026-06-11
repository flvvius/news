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
import { useT } from "@/contexts/locale-context";

function clampMaxSources(raw: unknown): number {
  const value = Number(raw);
  return Number.isFinite(value)
    ? Math.min(10, Math.max(0, Math.floor(value)))
    : 5;
}

function SavedHeader({ count }: { count: number }) {
  const t = useT();

  return (
    <View className="overflow-hidden rounded-[1.6rem] border border-border/70 bg-card/80">
      <View className="gap-3 px-6 py-7">
        <Text className="text-xs font-semibold uppercase tracking-[2.4px] text-muted-foreground">
          {t("saved.section")}
        </Text>
        <Text className="text-3xl font-bold tracking-tight text-foreground">
          {t("saved.heading")}
        </Text>
        <Text className="max-w-[40ch] text-sm leading-relaxed text-muted-foreground">
          {count === 0
            ? t("saved.summary.empty")
            : count === 1
              ? t("saved.summary.one")
              : t("saved.summary.many").replace("{count}", String(count))}
        </Text>
      </View>
    </View>
  );
}

export default function SavedScreen() {
  const t = useT();

  return (
    <Screen>
      <QueryBoundary
        title={t("native.saved.errorTitle")}
        body={t("native.saved.errorBody")}
      >
        <SavedContent />
      </QueryBoundary>
    </Screen>
  );
}

function SavedContent() {
  const router = useRouter();
  const t = useT();
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
          title={t("saved.empty.title")}
          body={t("native.saved.signInBody")}
          actionLabel={t("auth.signIn")}
          onAction={() => router.push("/auth")}
        />
      </View>
    );
  }

  return <SavedList />;
}

function SavedList() {
  const router = useRouter();
  const t = useT();
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
          title={t("saved.none")}
          body={t("saved.noneBody")}
          actionLabel={t("saved.browseFeed")}
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
