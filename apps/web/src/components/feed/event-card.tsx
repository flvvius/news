import type { Id } from "@news-app/backend/convex/_generated/dataModel";
import { Link } from "@tanstack/react-router";
import { Card, CardContent } from "@/components/ui/card";
import BookmarkButton from "@/components/bookmark-button";
import { ArrowUpRight, Newspaper } from "lucide-react";

type EventCardProps = {
  event: {
    _id: Id<"events">;
    slug: string;
    title: string;
    imageUrl?: string;
    perspectiveSummaries: {
      center: string;
    };
    topicIds: Id<"topics">[];
    articleCount?: number;
    sources?: Array<{
      _id: Id<"sources">;
      name: string;
      logoUrl: string;
      baseBias: number;
    }>;
  };
  topicNamesById: Record<string, string>;
  /** Max source logos to display. Pre-validated by the parent. */
  maxSources?: number;
};

const EventCard = ({
  event,
  topicNamesById,
  maxSources = 5,
}: EventCardProps) => {
  const topics = event.topicIds.map((id) => topicNamesById[id]).filter(Boolean);
  const primaryTopic = topics[0] ?? "General";
  const remainingSources = event.sources
    ? Math.max(0, event.sources.length - maxSources)
    : 0;

  return (
    <Link to="/event/$slug" params={{ slug: event.slug }} className="block group">
      <Card className="overflow-hidden border-border hover:border-primary/30 transition-all duration-300 hover:shadow-lg hover:shadow-primary/5">
        <div className="grid md:grid-cols-[280px_1fr] gap-0">
          {/* Image Section */}
          <div className="relative h-48 md:h-full min-h-[200px] overflow-hidden bg-muted">
            {event.imageUrl ? (
              <>
                <img
                  src={event.imageUrl}
                  alt={event.title}
                  className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                  loading="lazy"
                />
                <div className="absolute inset-0 bg-linear-to-t from-card/80 via-transparent to-transparent md:bg-linear-to-r md:from-transparent md:via-transparent md:to-card/10" />
              </>
            ) : (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-muted">
                <Newspaper className="size-10 text-muted-foreground/50" />
                <span className="text-xs font-medium text-muted-foreground">
                  {primaryTopic}
                </span>
              </div>
            )}

            {/* Topic badges - positioned on image */}
            <div className="absolute bottom-3 left-3 flex flex-wrap gap-1.5 md:top-3 md:bottom-auto">
              {topics.length > 0 ? (
                topics.slice(0, 2).map((topic) => (
                  <span
                    key={topic}
                    className="px-2.5 py-1 rounded-full text-xs font-medium bg-background/90 backdrop-blur-sm text-foreground border border-border/50"
                  >
                    {topic}
                  </span>
                ))
              ) : (
                <span className="px-2.5 py-1 rounded-full text-xs font-medium bg-background/90 backdrop-blur-sm text-foreground border border-border/50">
                  General
                </span>
              )}
            </div>
          </div>

          {/* Content Section */}
          <CardContent className="flex flex-col justify-between p-6 gap-4">
            <div className="flex flex-col gap-3">
              {/* Title */}
              <h3 className="text-lg font-semibold leading-snug group-hover:text-primary transition-colors line-clamp-2">
                {event.title}
              </h3>

              {/* Summary */}
              <p className="text-sm text-muted-foreground leading-relaxed line-clamp-3">
                {event.perspectiveSummaries.center}
              </p>
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between pt-4 border-t border-border">
              {/* Sources */}
              <div className="flex items-center gap-3">
                {event.sources && event.sources.length > 0 && (
                  <div className="flex items-center">
                    <div className="flex -space-x-2">
                      {event.sources.slice(0, maxSources).map((source) => (
                        <div
                          key={source._id}
                          className="relative size-8 rounded-full border-2 border-card bg-muted overflow-hidden ring-1 ring-border/50 transition-transform hover:scale-110 hover:z-10"
                          title={source.name}
                        >
                          <img
                            src={source.logoUrl}
                            alt={source.name}
                            className="h-full w-full object-cover"
                          />
                        </div>
                      ))}
                    </div>
                    {remainingSources > 0 && (
                      <span className="ml-2 text-xs text-muted-foreground">
                        +{remainingSources}
                      </span>
                    )}
                  </div>
                )}
              </div>

              {/* Actions */}
              <div className="flex items-center gap-3">
                {event.articleCount !== undefined && (
                  <span className="text-xs text-muted-foreground px-2 py-1 rounded-md bg-muted">
                    {event.articleCount}{" "}
                    {event.articleCount === 1 ? "article" : "articles"}
                  </span>
                )}
                <BookmarkButton eventId={event._id} size="sm" />
                <div className="flex items-center justify-center size-8 rounded-full bg-primary/10 text-primary opacity-0 group-hover:opacity-100 transition-opacity">
                  <ArrowUpRight className="size-4" />
                </div>
              </div>
            </div>
          </CardContent>
        </div>
      </Card>
    </Link>
  );
};

export default EventCard;
