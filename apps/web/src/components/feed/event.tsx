import type { Id } from "@news-app/backend/convex/_generated/dataModel";
import { useT } from "@/lib/i18n/LocaleContext";

type EventCardProps = {
  event: {
    _id: Id<"events">;
    slug: string;
    title: string;
    perspectiveSummaries?: {
      neutral?: string;
      reformist?: string;
      suveranist?: string;
    };
    topicIds: Id<"topics">[];
  };
  topicNamesById: Record<string, string>;
};

const EventCard = ({ event, topicNamesById }: EventCardProps) => {
  const t = useT();
  const topics = event.topicIds.map((id) => topicNamesById[id]).filter(Boolean);

  return (
    <div className="rounded-lg border bg-background p-5 shadow-sm">
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        {topics.length > 0 ? (
          topics.map((topic) => (
            <span key={topic} className="rounded-full border px-2 py-0.5">
              {topic}
            </span>
          ))
        ) : (
          <span className="rounded-full border px-2 py-0.5">
            {t("event.general")}
          </span>
        )}
      </div>

      <h2 className="mt-3 text-lg font-semibold leading-snug">{event.title}</h2>

      <p className="mt-2 text-sm text-muted-foreground line-clamp-3">
        {event.perspectiveSummaries?.neutral ?? t("event.summaryPending")}
      </p>
    </div>
  );
};

export default EventCard;
