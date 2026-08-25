import type { Id } from "@news-app/backend/convex/_generated/dataModel";
import { api } from "@news-app/backend/convex/_generated/api";
import { useConvexAuth } from "convex/react";
import { useMutation } from "@tanstack/react-query";
import { useConvexMutation } from "@convex-dev/react-query";
import type { MouseEvent } from "react";
import { Share2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import type { InteractionContextSnapshot } from "@/lib/interaction-tracking";
import { getClientDeviceType } from "@/lib/interaction-tracking";
import { SITE } from "@/lib/seo";
import { useT } from "@/lib/i18n/LocaleContext";
import { cn } from "@/lib/utils";

type ShareEventButtonProps = {
  eventId?: Id<"events">;
  interactionContext?: InteractionContextSnapshot;
  slug: string;
  title: string;
  size?: "default" | "sm";
  className?: string;
};

export default function ShareEventButton({
  eventId,
  interactionContext,
  slug,
  title,
  size = "default",
  className,
}: ShareEventButtonProps) {
  const t = useT();
  const { isAuthenticated } = useConvexAuth();
  const shareOrigin = SITE.url || window.location.origin;
  const shareUrl = `${shareOrigin}/event/${slug}`;
  const iconSize = size === "sm" ? "size-4" : "size-5";
  const buttonSize = size === "sm" ? "size-8" : "size-9";
  const logInteraction = useMutation({
    mutationFn: useConvexMutation(api.interactions.logInteraction),
  });

  const logShare = () => {
    if (!isAuthenticated || !eventId) return;
    logInteraction.mutate({
      eventId,
      type: "share",
      context: interactionContext,
      metadata: {
        deviceType: getClientDeviceType(),
      },
    });
  };

  const handleClick = async (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    if (navigator.share) {
      try {
        await navigator.share({
          title,
          url: shareUrl,
        });
        logShare();
        return;
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }
      }
    }

    try {
      await navigator.clipboard.writeText(shareUrl);
      logShare();
      toast.success(t("share.copied"));
    } catch (error) {
      console.error("Share failed:", error);
      toast.error(t("share.failed"));
    }
  };

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className={cn(
        "shrink-0 rounded-full text-muted-foreground transition-all hover:text-foreground hover:bg-background/90",
        buttonSize,
        className,
      )}
      onClick={handleClick}
      aria-label={t("share.label")}
    >
      <Share2 className={iconSize} />
    </Button>
  );
}
