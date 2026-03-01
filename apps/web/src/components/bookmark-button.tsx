import type { Id } from "@news-app/backend/convex/_generated/dataModel";
import { api } from "@news-app/backend/convex/_generated/api";
import { useQuery, useConvexAuth } from "convex/react";
import { useMutation } from "@tanstack/react-query";
import { useConvexMutation } from "@convex-dev/react-query";
import { Bookmark } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useRef, useCallback } from "react";

type BookmarkButtonProps = {
  eventId: Id<"events">;
  /** Render a smaller variant (for cards). */
  size?: "default" | "sm";
  className?: string;
};

export default function BookmarkButton({
  eventId,
  size = "default",
  className,
}: BookmarkButtonProps) {
  const { isAuthenticated } = useConvexAuth();

  // Client-side debounce — prevents rapid-fire mutation calls.
  // Value is tunable via the `bookmark_debounce_ms` config key.
  const debounceConfig = useQuery(api.config.get, {
    key: "bookmark_debounce_ms",
  });
  const raw = Number(debounceConfig?.value);
  const debounceMs = Number.isFinite(raw) ? Math.max(1, Math.floor(raw)) : 800;
  const lastClickRef = useRef(0);

  // Reactive bookmark status — returns false for unauthenticated users
  const isBookmarked = useQuery(api.interactions.isEventBookmarked, {
    eventId,
  });

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
              window.location.href = "/dashboard";
            },
          },
        });
        return;
      }

      // Client-side debounce guard
      const now = Date.now();
      if (now - lastClickRef.current < debounceMs) return;
      lastClickRef.current = now;

      toggle.mutate({ eventId });
    },
    [isAuthenticated, toggle, eventId, debounceMs],
  );

  const bookmarked = isBookmarked === true;

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className={cn("shrink-0", bookmarked && "text-primary", className)}
      disabled={toggle.isPending}
      onClick={handleClick}
      aria-label={bookmarked ? "Remove bookmark" : "Bookmark this event"}
      aria-pressed={bookmarked}
    >
      <Bookmark className={cn("size-4", bookmarked && "fill-current")} />
    </Button>
  );
}
