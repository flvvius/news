import { api } from "@news-app/backend/convex/_generated/api";
import type { Id } from "@news-app/backend/convex/_generated/dataModel";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import { useCallback, useRef } from "react";
import { Alert, Platform, Pressable } from "react-native";

import { Icon } from "@/components/ui/icon";
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
        "Bookmark failed",
        "We couldn't update this bookmark. Please try again.",
      );
    });
  }, [isAuthenticated, router, toggleBookmark, eventId, interactionContext]);

  const bookmarked = isBookmarked === true;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={bookmarked ? "Remove bookmark" : "Add bookmark"}
      accessibilityState={{ selected: bookmarked }}
      onPress={handlePress}
      hitSlop={8}
      className={cn(
        "items-center justify-center rounded-full border border-border bg-background/80 active:opacity-70",
        size === "sm" ? "size-9" : "size-11",
        bookmarked && "bg-primary/10",
        className,
      )}
    >
      <Icon
        name={bookmarked ? "bookmark" : "bookmark-outline"}
        size={size === "sm" ? 16 : 20}
        className={bookmarked ? "text-primary" : "text-muted-foreground"}
      />
    </Pressable>
  );
}
