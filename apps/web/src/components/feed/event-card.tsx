import type { Id } from "@news-app/backend/convex/_generated/dataModel";
import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

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
};

const EventCard = ({ event, topicNamesById }: EventCardProps) => {
  const topics = event.topicIds.map((id) => topicNamesById[id]).filter(Boolean);
  const primaryTopic = topics[0] ?? "General";

  return (
    <Link to="/event/$slug" params={{ slug: event.slug }} className="block">
      <Card className="cursor-pointer transition-shadow hover:shadow-md">
        <div className="px-6 pt-6">
          {event.imageUrl ? (
            <div className="overflow-hidden rounded-lg border">
              <img
                src={event.imageUrl}
                alt={event.title}
                className="h-40 w-full object-cover"
                loading="lazy"
              />
            </div>
          ) : (
            <div className="flex h-40 items-center justify-center rounded-lg border bg-muted">
              <span className="text-xs font-medium text-muted-foreground">
                {primaryTopic}
              </span>
            </div>
          )}
        </div>
        <CardHeader className="gap-3">
          <div className="flex flex-wrap items-center gap-2">
            {topics.length > 0 ? (
              topics.map((topic) => (
                <Button
                  key={topic}
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-6 rounded-full px-2 text-xs"
                >
                  {topic}
                </Button>
              ))
            ) : (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-6 rounded-full px-2 text-xs"
              >
                General
              </Button>
            )}
          </div>
          <CardTitle className="text-lg leading-snug">{event.title}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground line-clamp-3">
            {event.perspectiveSummaries.center}
          </p>

          <div className="flex items-center justify-between pt-2 border-t">
            <div className="flex items-center gap-2">
              {event.sources && event.sources.length > 0 && (
                <div className="flex -space-x-2">
                  {event.sources.slice(0, 5).map((source) => (
                    <div
                      key={source._id}
                      className="h-8 w-8 rounded-full border-2 border-background bg-muted overflow-hidden"
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
              )}
            </div>

            {event.articleCount !== undefined && (
              <span className="text-xs text-muted-foreground">
                {event.articleCount}{" "}
                {event.articleCount === 1 ? "article" : "articles"}
              </span>
            )}
          </div>
        </CardContent>
      </Card>
    </Link>
  );
};

export default EventCard;
