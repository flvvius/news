import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { api } from "@news-app/backend/convex/_generated/api";
import type { Id } from "@news-app/backend/convex/_generated/dataModel";
import { usePaginatedQuery, useQuery } from "convex/react";
import EventCard from "@/components/feed/event-card";
import { Button } from "@/components/ui/button";
import { SITE } from "@/lib/seo";
import { Loader2, Newspaper, SlidersHorizontal } from "lucide-react";

export const Route = createFileRoute("/feed")({
  head: () => ({
    meta: [
      { title: `News Feed — ${SITE.name}` },
      {
        name: "description",
        content:
          "Browse today's top stories from multiple political perspectives. Filter by topic and track the same story across sources.",
      },
      { property: "og:title", content: `News Feed — ${SITE.name}` },
      {
        property: "og:description",
        content:
          "Browse today's top stories from multiple political perspectives.",
      },
      { property: "og:url", content: `${SITE.url}/feed` },
    ],
    links: [{ rel: "canonical", href: `${SITE.url}/feed` }],
  }),
  component: FeedComponent,
});

function FeedComponent() {
  const topics = useQuery(api.topics.getTopics);
  const pageSizeConfig = useQuery(api.config.get, { key: "feed_page_size" });
  const rawPageSize = Number(pageSizeConfig?.value);
  const MAX_FEED_PAGE_SIZE = 50;
  const pageSize = Number.isFinite(rawPageSize)
    ? Math.min(MAX_FEED_PAGE_SIZE, Math.max(1, Math.floor(rawPageSize)))
    : 6;

  const maxSourcesConfig = useQuery(api.config.get, {
    key: "event_card_max_sources",
  });
  const rawMaxSources = Number(maxSourcesConfig?.value);
  const MAX_EVENT_CARD_SOURCES = 10;
  const maxSources = Number.isFinite(rawMaxSources)
    ? Math.min(MAX_EVENT_CARD_SOURCES, Math.max(0, Math.floor(rawMaxSources)))
    : 5;

  const [selectedTopic, setSelectedTopic] = useState<Id<"topics"> | "all">(
    "all"
  );

  const {
    results: events,
    status,
    loadMore,
  } = usePaginatedQuery(
    api.events.getPublishedEvents,
    selectedTopic === "all" ? {} : { topicId: selectedTopic },
    { initialNumItems: pageSize }
  );

  const topicNamesById = useMemo(() => {
    const map: Record<string, string> = {};
    topics?.forEach((topic) => {
      map[topic._id] = topic.displayName;
    });
    return map;
  }, [topics]);

  return (
    <div className="min-h-[calc(100vh-4rem)]">
      {/* Page Header */}
      <div className="border-b border-border bg-muted/20">
        <div className="container mx-auto max-w-5xl px-4 py-8">
          <div className="flex flex-col gap-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h1 className="text-3xl font-bold tracking-tight mb-2">
                  Today&apos;s Events
                </h1>
                <p className="text-muted-foreground">
                  Track the same story across perspectives
                </p>
              </div>
              <div className="hidden md:flex items-center gap-2 text-sm text-muted-foreground">
                <SlidersHorizontal className="size-4" />
                Filter by topic
              </div>
            </div>

            {/* Topic filters */}
            <div className="flex flex-wrap items-center gap-2 pt-2">
              <Button
                type="button"
                onClick={() => setSelectedTopic("all")}
                variant={selectedTopic === "all" ? "default" : "outline"}
                aria-pressed={selectedTopic === "all"}
                size="sm"
                className="rounded-full h-9 px-4"
              >
                All topics
              </Button>
              {topics?.map((topic) => (
                <Button
                  key={topic._id}
                  type="button"
                  onClick={() => setSelectedTopic(topic._id)}
                  variant={selectedTopic === topic._id ? "default" : "outline"}
                  aria-pressed={selectedTopic === topic._id}
                  size="sm"
                  className="rounded-full h-9 px-4"
                >
                  {topic.displayName}
                </Button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Feed Content */}
      <div className="container mx-auto max-w-5xl px-4 py-8">
        <div className="flex flex-col gap-6">
          {/* Loading state */}
          {status === "LoadingFirstPage" && (
            <div className="flex flex-col items-center justify-center py-20 gap-4">
              <Loader2 className="size-8 text-primary animate-spin" />
              <p className="text-sm text-muted-foreground">
                Loading events...
              </p>
            </div>
          )}

          {/* Events grid */}
          {events && events.length > 0 && (
            <div className="grid gap-6">
              {events.map((event) => (
                <EventCard
                  key={event._id}
                  event={event}
                  topicNamesById={topicNamesById}
                  maxSources={maxSources}
                />
              ))}
            </div>
          )}

          {/* Empty state */}
          {status !== "LoadingFirstPage" &&
            (!events || events.length === 0) && (
              <div className="flex flex-col items-center justify-center py-20 gap-4">
                <div className="flex items-center justify-center size-16 rounded-2xl bg-muted">
                  <Newspaper className="size-8 text-muted-foreground" />
                </div>
                <div className="text-center">
                  <h3 className="font-semibold mb-1">No events found</h3>
                  <p className="text-sm text-muted-foreground">
                    {selectedTopic !== "all"
                      ? "Try selecting a different topic or check back later."
                      : "Check back later for new stories."}
                  </p>
                </div>
                {selectedTopic !== "all" && (
                  <Button
                    variant="outline"
                    onClick={() => setSelectedTopic("all")}
                    className="mt-2"
                  >
                    View all topics
                  </Button>
                )}
              </div>
            )}

          {/* Load more */}
          {status === "CanLoadMore" && (
            <div className="flex justify-center pt-4">
              <Button
                type="button"
                onClick={() => loadMore(pageSize)}
                variant="outline"
                size="lg"
                className="min-w-[200px]"
              >
                Load more events
              </Button>
            </div>
          )}

          {/* Loading more indicator */}
          {status === "LoadingMore" && (
            <div className="flex justify-center pt-4">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" />
                Loading more...
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
