import type { Id } from "@news-app/backend/convex/_generated/dataModel";
import { api } from "@news-app/backend/convex/_generated/api";
import { useQuery, useConvexAuth } from "convex/react";
import { useMutation } from "@tanstack/react-query";
import { useConvexMutation } from "@convex-dev/react-query";
import { Bookmark } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { AuthRedirectPath } from "@/lib/auth-redirect";
import type { InteractionContextSnapshot } from "@/lib/interaction-tracking";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useRef, useCallback } from "react";
import { getClientDeviceType } from "@/lib/interaction-tracking";

const BOOKMARK_DEBOUNCE_MS = 800;

type BookmarkButtonProps = {
  eventId: Id<"events">;
  interactionContext?: InteractionContextSnapshot;
  /** Render a smaller variant (for cards). */
  size?: "default" | "sm";
  className?: string;
  redirectTo?: AuthRedirectPath;
};

export default function BookmarkButton({
  eventId,
  interactionContext,
  size = "default",
  className,
  redirectTo = "/feed",
}: BookmarkButtonProps) {
  const { isAuthenticated } = useConvexAuth();

  const lastClickRef = useRef(0);

  // Reactive bookmark status — returns false for unauthenticated users
  const isBookmarked = useQuery(
    api.interactions.isEventBookmarked,
    isAuthenticated ? { eventId } : "skip",
  );

  const toggle = useMutation({
    mutationFn: useConvexMutation(api.interactions.toggleBookmark),
    onSuccess: (data) => {
      if (data.bookmarked) {
        toast.success("Bookmarked");
      } else {
        toast("Bookmark removed");
      }
    },
    onError: (error) => {
      console.error("Bookmark toggle failed:", error);
      toast.error("Something went wrong. Please try again.");
    },
  });

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      // Prevent navigation when inside a Link
      e.preventDefault();
      e.stopPropagation();

      if (!isAuthenticated) {
        toast("Sign in to bookmark events", {
          action: {
            label: "Sign in",
            onClick: () => {
              window.location.href = `/dashboard?mode=signin&redirect=${encodeURIComponent(redirectTo)}`;
            },
          },
        });
        return;
      }

      // Client-side debounce guard
      const now = Date.now();
      if (now - lastClickRef.current < BOOKMARK_DEBOUNCE_MS) return;
      lastClickRef.current = now;

      toggle.mutate({
        eventId,
        context: interactionContext,
        metadata: {
          deviceType: getClientDeviceType(),
        },
      });
    },
    [isAuthenticated, toggle, eventId, interactionContext, redirectTo],
  );

  const bookmarked = isBookmarked === true;
  const iconSize = size === "sm" ? "size-4" : "size-5";
  const buttonSize = size === "sm" ? "size-8" : "size-9";

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className={cn(
        "shrink-0 rounded-full transition-all",
        buttonSize,
        bookmarked
          ? "text-primary bg-primary/10 hover:bg-primary/20"
          : "text-muted-foreground hover:text-primary hover:bg-primary/10",
        className
      )}
      disabled={toggle.isPending}
      onClick={handleClick}
      aria-label={bookmarked ? "Remove bookmark" : "Bookmark this event"}
      aria-pressed={bookmarked}
    >
      <Bookmark
        className={cn(
          iconSize,
          "transition-transform",
          bookmarked && "fill-current scale-110",
          toggle.isPending && "animate-pulse"
        )}
      />
    </Button>
  );
}
