import type { Id } from "@news-app/backend/convex/_generated/dataModel";
import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardTitle } from "@/components/ui/card";
import BookmarkButton from "@/components/bookmark-button";
import { cn } from "@/lib/utils";

type EventCardProps = {
  event: {
    _id: Id<"events">;
    slug: string;
    title: string;
    imageUrl?: string;
    perspectiveSummaries?: {
      center?: string;
    };
    globalImpact?: string;
    topicIds?: Id<"topics">[];
    articleCount?: number;
    sources?: Array<{
      _id: Id<"sources">;
      name: string;
      logoUrl?: string;
      baseBias: number;
      reliabilityScore: number;
      mbfcCategory?: string;
      mbfcFactual?: string;
      mbfcCredibility?: string;
    }>;
  };
  topicNamesById: Record<string, string>;
  /** Max source logos to display. Pre-validated by the parent. */
  maxSources?: number;
  variant?: "default" | "feature";
};

const EventCard = ({
  event,
  topicNamesById,
  maxSources = 5,
  variant = "default",
}: EventCardProps) => {
  const topics = (event.topicIds ?? [])
    .map((id) => topicNamesById[id])
    .filter(Boolean);
  const primaryTopic = topics[0] ?? "General";
  const summaryPreview =
    event.perspectiveSummaries?.center ??
    event.globalImpact ??
    "Coverage grouped from multiple sources. Open the event to compare articles.";
  const isFeature = variant === "feature";

  return (
    <Link to="/event/$slug" params={{ slug: event.slug }} className="group block">
      <Card
        className={cn(
          "overflow-hidden border-border/80 bg-card/95 py-0 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg",
          isFeature
            ? "rounded-[1.4rem]"
            : "rounded-[1.2rem]",
        )}
      >
        <div
          className={cn(
            "overflow-hidden border-b border-border/70 bg-muted/40",
            isFeature ? "aspect-[16/10] sm:aspect-[16/9]" : "aspect-[16/10] lg:aspect-[2.2/1]",
          )}
        >
          {event.imageUrl ? (
            <img
              src={event.imageUrl}
              alt={event.title}
              className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.02]"
              loading="lazy"
            />
          ) : (
            <div className="flex h-full items-center justify-center bg-linear-to-br from-muted to-background">
              <span className="rounded-full border border-border/80 bg-background/85 px-3 py-1 text-xs font-medium text-muted-foreground">
                {primaryTopic}
              </span>
            </div>
          )}
        </div>
        <CardContent className={cn("space-y-5 px-6 py-6", isFeature && "px-6 py-7 sm:px-8 sm:py-8")}>
          <div className="flex flex-wrap items-center gap-2">
            {(topics.length > 0 ? topics : ["General"]).slice(0, isFeature ? 3 : 2).map((topic) => (
              <Button
                key={topic}
                type="button"
                variant="outline"
                size="sm"
                className="h-7 rounded-full border-border/80 bg-background/70 px-3 text-xs"
              >
                {topic}
              </Button>
            ))}
          </div>

          <div className="flex items-start justify-between gap-4">
            <CardTitle
              className={cn(
                "leading-tight tracking-tight text-card-foreground",
                isFeature ? "text-2xl sm:text-3xl" : "text-xl sm:text-2xl",
              )}
            >
              {event.title}
            </CardTitle>
            <BookmarkButton
              eventId={event._id}
              size="sm"
              className="mt-0.5 rounded-full border border-border/80 bg-background/80"
            />
          </div>

          <p
            className={cn(
              "max-w-[65ch] text-muted-foreground",
              isFeature ? "text-base" : "text-sm line-clamp-3",
            )}
          >
            {summaryPreview}
          </p>

          <div className="flex flex-wrap items-center justify-between gap-4 border-t border-border/70 pt-4">
            <div className="flex items-center gap-3">
              {event.sources && event.sources.length > 0 && (
                <div className="flex -space-x-3">
                  {event.sources.slice(0, maxSources).map((source) => (
                    <div
                      key={source._id}
                      className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-full border-2 border-background bg-background shadow-sm"
                      title={source.name}
                    >
                      {source.logoUrl ? (
                        <img
                          src={source.logoUrl}
                          alt={source.name}
                          className="h-full w-full object-contain p-1.5"
                        />
                      ) : (
                        <span className="flex h-full w-full items-center justify-center text-xs font-medium text-foreground">
                          {source.name.charAt(0)}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              )}
              <div className="min-w-0">
                <p className="text-sm font-medium text-card-foreground">
                  {event.sources?.length ?? 0} sources
                </p>
                <p className="text-xs text-muted-foreground">
                  {event.articleCount !== undefined
                    ? `${event.articleCount} ${event.articleCount === 1 ? "article" : "articles"}`
                    : "Follow the event"}
                </p>
              </div>
            </div>
            <span className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
              Open event
            </span>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
};

export default EventCard;
