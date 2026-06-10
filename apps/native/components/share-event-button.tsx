import { api } from "@news-app/backend/convex/_generated/api";
import type { Id } from "@news-app/backend/convex/_generated/dataModel";
import { useConvexAuth, useMutation } from "convex/react";
import { useCallback } from "react";
import { Pressable, Share } from "react-native";

import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/cn";
import {
  NATIVE_DEVICE_TYPE,
  type InteractionContextSnapshot,
} from "@/lib/interactions";
import { eventShareUrl } from "@/lib/site";

type ShareEventButtonProps = {
  eventId: Id<"events">;
  slug: string;
  title: string;
  interactionContext?: InteractionContextSnapshot;
  size?: "default" | "sm";
  className?: string;
};

export function ShareEventButton({
  eventId,
  slug,
  title,
  interactionContext,
  size = "default",
  className,
}: ShareEventButtonProps) {
  const { isAuthenticated } = useConvexAuth();
  const logInteraction = useMutation(api.interactions.logInteraction);

  const handlePress = useCallback(async () => {
    const url = eventShareUrl(slug);
    try {
      const result = await Share.share(
        { title, message: `${title}\n${url}`, url },
        { dialogTitle: title },
      );
      if (result.action === Share.sharedAction && isAuthenticated) {
        logInteraction({
          eventId,
          type: "share",
          context: interactionContext,
          metadata: { deviceType: NATIVE_DEVICE_TYPE },
        }).catch(() => {
          // Analytics logging must never surface to the user.
        });
      }
    } catch {
      // User dismissed the share sheet or sharing is unavailable.
    }
  }, [slug, title, isAuthenticated, logInteraction, eventId, interactionContext]);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Share event"
      onPress={() => void handlePress()}
      hitSlop={8}
      className={cn(
        "items-center justify-center rounded-full border border-border bg-background/80 active:opacity-70",
        size === "sm" ? "size-9" : "size-11",
        className,
      )}
    >
      <Icon
        name="share-outline"
        size={size === "sm" ? 16 : 20}
        className="text-muted-foreground"
      />
    </Pressable>
  );
}
