import { api } from "@news-app/backend/convex/_generated/api";
import type { Id } from "@news-app/backend/convex/_generated/dataModel";
import { useConvexAuth, useMutation } from "convex/react";
import { useCallback } from "react";
import { Pressable, Share, Text } from "react-native";

import { Icon } from "@/components/ui/icon";
import { useT } from "@/contexts/locale-context";
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
  /** Renders a quiet icon+text row instead of the circular icon button. */
  label?: string;
  className?: string;
};

export function ShareEventButton({
  eventId,
  slug,
  title,
  interactionContext,
  size = "default",
  label,
  className,
}: ShareEventButtonProps) {
  const t = useT();
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
        }).catch((error) => {
          if (__DEV__) {
            console.warn("[ShareEventButton] Failed to log share", error);
          }
          // Analytics logging must never surface to the user.
        });
      }
    } catch (error) {
      if (__DEV__) {
        console.warn("[ShareEventButton] Share sheet failed", error);
      }
      // User dismissed the share sheet or sharing is unavailable.
    }
  }, [slug, title, isAuthenticated, logInteraction, eventId, interactionContext]);

  if (label) {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t("share.label")}
        onPress={() => void handlePress()}
        hitSlop={8}
        className={cn(
          "min-h-11 flex-row items-center gap-1.5 active:opacity-70",
          className,
        )}
      >
        <Icon
          name="share-outline"
          size={15}
          className="text-muted-foreground"
        />
        <Text className="text-sm font-medium text-muted-foreground">
          {label}
        </Text>
      </Pressable>
    );
  }

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t("share.label")}
      onPress={() => void handlePress()}
      hitSlop={8}
      className={cn(
        // Plain icon button — no circle chrome in the reading header.
        "size-11 items-center justify-center active:opacity-70",
        className,
      )}
    >
      <Icon
        name="share-outline"
        size={size === "sm" ? 18 : 20}
        className="text-foreground"
      />
    </Pressable>
  );
}
