import { api } from "@news-app/backend/convex/_generated/api";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { FlashList } from "@shopify/flash-list";
import { Platform, Text, View } from "react-native";

import { EventRow, type EventRowEvent } from "@/components/event-row";
import { EventRowSkeleton } from "@/components/feed/event-row-skeleton";
import { Screen } from "@/components/screen";
import { QueryBoundary } from "@/components/ui/query-boundary";
import { EmptyState } from "@/components/ui/state-views";
import { SwipeToRemoveRow } from "@/components/ui/swipe-to-remove-row";
import { Toast } from "@/components/ui/toast";
import { useT } from "@/contexts/locale-context";
import { NATIVE_DEVICE_TYPE } from "@/lib/interactions";

function RowSeparator() {
  return <View className="h-px bg-border" />;
}

function SavedHeader({ count }: { count: number }) {
  const t = useT();

  return (
    <View className="gap-1 pb-4 pt-5">
      <Text className="text-3xl font-semibold tracking-tight text-foreground">
        {t("saved.heading")}
      </Text>
      <Text className="text-xs text-muted-foreground">
        {count === 0
          ? t("saved.summary.empty")
          : count === 1
            ? t("saved.summary.one")
            : t("saved.summary.many").replace("{count}", String(count))}
      </Text>
    </View>
  );
}

function SavedLoadingRows() {
  return (
    <View className="flex-1 px-5 pt-5">
      <EventRowSkeleton />
      <RowSeparator />
      <EventRowSkeleton />
      <RowSeparator />
      <EventRowSkeleton />
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
    return <SavedLoadingRows />;
  }

  if (!isAuthenticated) {
    return (
      <View className="flex-1 px-5">
        <EmptyState
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
  const [removedEvent, setRemovedEvent] = useState<EventRowEvent | null>(null);

  const toggleBookmark = useMutation(
    api.interactions.toggleBookmark,
  ).withOptimisticUpdate((localStore, args) => {
    // Swipe removal must be instant; the undo round-trips to the server.
    const savedEvents = localStore.getQuery(
      api.interactions.getBookmarkedEvents,
      {},
    );
    if (
      savedEvents !== undefined &&
      savedEvents.some((event) => event._id === args.eventId)
    ) {
      localStore.setQuery(
        api.interactions.getBookmarkedEvents,
        {},
        savedEvents.filter((event) => event._id !== args.eventId),
      );
    }
  });

  const topicNamesById = useMemo(() => {
    const map: Record<string, string> = {};
    topics?.forEach((topic) => {
      map[topic._id] = topic.displayName;
    });
    return map;
  }, [topics]);

  const handleRemove = useCallback(
    (event: EventRowEvent) => {
      if (Platform.OS === "ios") {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      }
      setRemovedEvent(event);
      toggleBookmark({
        eventId: event._id,
        metadata: { deviceType: NATIVE_DEVICE_TYPE },
      }).catch(() => setRemovedEvent(null));
    },
    [toggleBookmark],
  );

  const handleUndo = useCallback(() => {
    if (!removedEvent) return;
    setRemovedEvent(null);
    toggleBookmark({
      eventId: removedEvent._id,
      metadata: { deviceType: NATIVE_DEVICE_TYPE },
    }).catch(() => {
      // The bookmark list is live — a failed undo simply leaves it removed.
    });
  }, [removedEvent, toggleBookmark]);

  const dismissToast = useCallback(() => setRemovedEvent(null), []);

  if (bookmarks === undefined) {
    return <SavedLoadingRows />;
  }

  if (bookmarks.length === 0) {
    return (
      <View className="flex-1 px-5">
        <SavedHeader count={0} />
        <EmptyState
          title={t("saved.none")}
          body={t("saved.noneBody")}
          actionLabel={t("saved.browseFeed")}
          onAction={() => router.push("/")}
        />
      </View>
    );
  }

  return (
    <View className="flex-1">
      <FlashList
        data={bookmarks}
        keyExtractor={(event: EventRowEvent) => event._id}
        getItemType={() => "event-row"}
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 24 }}
        ListHeaderComponent={<SavedHeader count={bookmarks.length} />}
        ItemSeparatorComponent={RowSeparator}
        renderItem={({ item }: { item: EventRowEvent }) => (
          <SwipeToRemoveRow
            resetKey={item._id}
            actionLabel={t("native.saved.removeAction")}
            onRemove={() => handleRemove(item)}
          >
            <EventRow event={item} topicNamesById={topicNamesById} />
          </SwipeToRemoveRow>
        )}
      />
      {removedEvent ? (
        <Toast
          key={removedEvent._id}
          message={t("native.saved.removedToast")}
          actionLabel={t("native.saved.undo")}
          onAction={handleUndo}
          onDismiss={dismissToast}
        />
      ) : null}
    </View>
  );
}
