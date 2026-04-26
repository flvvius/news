import type { MouseEvent } from "react";
import { Share2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { SITE } from "@/lib/seo";
import { cn } from "@/lib/utils";

type ShareEventButtonProps = {
  slug: string;
  title: string;
  summary?: string;
  size?: "default" | "sm";
  className?: string;
};

export default function ShareEventButton({
  slug,
  title,
  summary,
  size = "default",
  className,
}: ShareEventButtonProps) {
  const shareOrigin = SITE.url || window.location.origin;
  const shareUrl = `${shareOrigin}/event/${slug}`;
  const shareText = summary?.trim() ? `${title} — ${summary.trim()}` : title;
  const iconSize = size === "sm" ? "size-4" : "size-5";
  const buttonSize = size === "sm" ? "size-8" : "size-9";

  const handleClick = async (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    if (navigator.share) {
      try {
        await navigator.share({
          title,
          text: shareText,
          url: shareUrl,
        });
        return;
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }
      }
    }

    try {
      await navigator.clipboard.writeText(shareUrl);
      toast.success("Event link copied");
    } catch (error) {
      console.error("Share failed:", error);
      toast.error("Could not share this event. Please try again.");
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
      aria-label="Share this event"
    >
      <Share2 className={iconSize} />
    </Button>
  );
}
