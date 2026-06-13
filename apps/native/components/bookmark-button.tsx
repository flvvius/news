import { api } from "@news-app/backend/convex/_generated/api";
import type { Id } from "@news-app/backend/convex/_generated/dataModel";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import { useCallback, useRef } from "react";
import { Alert, Platform, Pressable } from "react-native";

import { Icon } from "@/components/ui/icon";
import { useT } from "@/contexts/locale-context";
import { cn } from "@/lib/cn";
import {
  NATIVE_DEVICE_TYPE,
  type InteractionContextSnapshot,
} from "@/lib/interactions";

const BOOKMARK_DEBOUNCE_MS = 800;

type BookmarkButtonProps = {
  eventId: Id<"events">;
  interactionContext?: InteractionContextSnapshot;
  size?: "default" | "sm";
  className?: string;
};

export function BookmarkButton({
  eventId,
  interactionContext,
  size = "default",
  className,
}: BookmarkButtonProps) {
  const router = useRouter();
  const t = useT();
  const { isAuthenticated } = useConvexAuth();
  const lastPressRef = useRef(0);

  const isBookmarked = useQuery(
    api.interactions.isEventBookmarked,
    isAuthenticated ? { eventId } : "skip",
  );

  const toggleBookmark = useMutation(
    api.interactions.toggleBookmark,
  ).withOptimisticUpdate((localStore, args) => {
    const current = localStore.getQuery(api.interactions.isEventBookmarked, {
      eventId: args.eventId,
    });
    if (current !== undefined) {
      localStore.setQuery(
        api.interactions.isEventBookmarked,
        { eventId: args.eventId },
        !current,
      );
    }

    // When unbookmarking, drop the event from the saved list immediately.
    if (current === true) {
      const savedEvents = localStore.getQuery(
        api.interactions.getBookmarkedEvents,
        {},
      );
      if (savedEvents !== undefined) {
        localStore.setQuery(
          api.interactions.getBookmarkedEvents,
          {},
          savedEvents.filter((event) => event._id !== args.eventId),
        );
      }
    }
  });

  const handlePress = useCallback(() => {
    if (!isAuthenticated) {
      router.push("/auth");
      return;
    }

    const now = Date.now();
    if (now - lastPressRef.current < BOOKMARK_DEBOUNCE_MS) return;
    lastPressRef.current = now;

    if (Platform.OS === "ios") {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }

    toggleBookmark({
      eventId,
      context: interactionContext,
      metadata: { deviceType: NATIVE_DEVICE_TYPE },
    }).catch(() => {
      Alert.alert(
        t("native.bookmark.failedTitle"),
        t("native.bookmark.failed"),
      );
    });
  }, [isAuthenticated, router, toggleBookmark, eventId, interactionContext, t]);

  const bookmarked = isBookmarked === true;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={bookmarked ? t("bookmark.remove") : t("bookmark.add")}
      accessibilityState={{ selected: bookmarked }}
      onPress={handlePress}
      hitSlop={8}
      className={cn(
        // Plain icon button — state reads through fill + color, not chrome.
        "size-11 items-center justify-center active:opacity-70",
        className,
      )}
    >
      <Icon
        name={bookmarked ? "bookmark" : "bookmark-outline"}
        size={size === "sm" ? 18 : 20}
        className={bookmarked ? "text-primary" : "text-foreground"}
      />
    </Pressable>
  );
}
