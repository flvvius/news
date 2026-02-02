import type { Id } from "@news-app/backend/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type EventCardProps = {
  event: {
    _id: Id<"events">;
    slug: string;
    title: string;
    perspectiveSummaries: {
      center: string;
    };
    topicIds: Id<"topics">[];
  };
  topicNamesById: Record<string, string>;
};

const EventCard = ({ event, topicNamesById }: EventCardProps) => {
  const topics = event.topicIds.map((id) => topicNamesById[id]).filter(Boolean);

  return (
    <Card>
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
      <CardContent>
        <p className="text-sm text-muted-foreground line-clamp-3">
          {event.perspectiveSummaries.center}
        </p>
      </CardContent>
    </Card>
  );
};

export default EventCard;
