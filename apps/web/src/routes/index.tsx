import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { api } from "@news-app/backend/convex/_generated/api";
import type { Id } from "@news-app/backend/convex/_generated/dataModel";
import { usePaginatedQuery, useQuery } from "convex/react";
import EventCard from "@/components/feed/event-card";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/")({
  component: HomeComponent,
});

function HomeComponent() {
  const topics = useQuery(api.topics.getTopics);
  const [selectedTopic, setSelectedTopic] = useState<Id<"topics"> | "all">(
    "all",
  );

  const {
    results: events,
    status,
    loadMore,
  } = usePaginatedQuery(
    api.events.getPublishedEvents,
    {},
    { initialNumItems: 6 },
  );

  const topicNamesById = useMemo(() => {
    const map: Record<string, string> = {};
    topics?.forEach((topic) => {
      map[topic._id] = topic.displayName;
    });
    return map;
  }, [topics]);

  const filteredEvents = useMemo(() => {
    if (!events) return [];
    if (selectedTopic === "all") return events;
    return events.filter((event) => event.topicIds.includes(selectedTopic));
  }, [events, selectedTopic]);

  return (
    <div className="container mx-auto max-w-4xl px-4 py-8">
      <div className="flex flex-col gap-6">
        <header className="flex flex-col gap-2">
          <h1 className="text-2xl font-semibold">Today’s Events</h1>
          <p className="text-sm text-muted-foreground">
            Track the same story across perspectives.
          </p>
        </header>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            onClick={() => setSelectedTopic("all")}
            variant={selectedTopic === "all" ? "default" : "outline"}
            size="sm"
            className="rounded-full"
          >
            All topics
          </Button>
          {topics?.map((topic) => (
            <Button
              key={topic._id}
              type="button"
              onClick={() => setSelectedTopic(topic._id)}
              variant={selectedTopic === topic._id ? "default" : "outline"}
              size="sm"
              className="rounded-full"
            >
              {topic.displayName}
            </Button>
          ))}
        </div>

        <div className="grid gap-4">
          {status === "LoadingFirstPage" && (
            <div className="text-sm text-muted-foreground">Loading…</div>
          )}

          {filteredEvents.map((event) => (
            <EventCard
              key={event._id}
              event={event}
              topicNamesById={topicNamesById}
            />
          ))}

          {status !== "LoadingFirstPage" && filteredEvents.length === 0 && (
            <div className="text-sm text-muted-foreground">
              No events found.
            </div>
          )}
        </div>

        {status === "CanLoadMore" && (
          <div>
            <Button type="button" onClick={() => loadMore(6)} variant="outline">
              Load more
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
