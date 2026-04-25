import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { api } from "@news-app/backend/convex/_generated/api";
import type { Id } from "@news-app/backend/convex/_generated/dataModel";
import { usePaginatedQuery, useQuery } from "convex/react";
import EventCard from "@/components/feed/event-card";
import { Button } from "@/components/ui/button";
import { SITE } from "@/lib/seo";

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
    "all",
  );

  const {
    results: events,
    status,
    loadMore,
  } = usePaginatedQuery(
    api.events.getPublishedEvents,
    selectedTopic === "all" ? {} : { topicId: selectedTopic },
    { initialNumItems: pageSize },
  );

  const topicNamesById = useMemo(() => {
    const map: Record<string, string> = {};
    topics?.forEach((topic) => {
      map[topic._id] = topic.displayName;
    });
    return map;
  }, [topics]);

  const featuredEvent = events?.[0];
  const remainingEvents = featuredEvent ? events.slice(1) : events;

  return (
    <div className="bg-linear-to-b from-background via-background to-muted/35">
      <div className="container mx-auto max-w-4xl px-4 py-8 sm:py-10">
        <div className="flex flex-col gap-8">
          <header className="overflow-hidden rounded-[1.6rem] border border-border/70 bg-card/80 shadow-sm">
            <div className="bg-linear-to-br from-background via-card to-muted/50 px-6 py-8 sm:px-8 sm:py-10">
              <div className="flex flex-col gap-4">
                <p className="text-xs font-semibold uppercase tracking-[0.24em] text-muted-foreground">
                  Biviant Feed
                </p>
                <div className="flex max-w-[65ch] flex-col gap-3">
                  <h1 className="text-4xl font-bold tracking-tight text-foreground sm:text-5xl">
                    See the day’s biggest stories with the image front and center.
                  </h1>
                  <p className="max-w-[55ch] text-sm text-muted-foreground sm:text-base">
                    Follow the same event across outlets, open the story page, and compare the underlying reporting without losing visual context.
                  </p>
                </div>
              </div>
            </div>
          </header>

          <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            onClick={() => setSelectedTopic("all")}
            variant={selectedTopic === "all" ? "default" : "outline"}
            aria-pressed={selectedTopic === "all"}
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
              aria-pressed={selectedTopic === topic._id}
              size="sm"
              className="rounded-full"
            >
              {topic.displayName}
            </Button>
          ))}
          </div>

          <div className="grid gap-6">
            {status === "LoadingFirstPage" && (
              <div className="rounded-[1.2rem] border border-border/70 bg-card/70 px-5 py-8 text-sm text-muted-foreground">
                Loading…
              </div>
            )}

            {featuredEvent ? (
              <section className="flex flex-col gap-4">
                <div className="flex items-center justify-between gap-4">
                  <h2 className="text-lg font-semibold tracking-tight text-foreground">
                    Lead Story
                  </h2>
                  <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
                    Featured
                  </p>
                </div>
                <EventCard
                  event={featuredEvent}
                  topicNamesById={topicNamesById}
                  maxSources={maxSources}
                  variant="feature"
                />
              </section>
            ) : null}

            {remainingEvents && remainingEvents.length > 0 ? (
              <section className="flex flex-col gap-4">
                <div className="flex items-center justify-between gap-4">
                  <h2 className="text-lg font-semibold tracking-tight text-foreground">
                    More Events
                  </h2>
                  <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
                    Latest coverage
                  </p>
                </div>
                <div className="grid gap-5">
                  {remainingEvents.map((event) => (
                    <EventCard
                      key={event._id}
                      event={event}
                      topicNamesById={topicNamesById}
                      maxSources={maxSources}
                    />
                  ))}
                </div>
              </section>
            ) : null}

            {status !== "LoadingFirstPage" &&
              (!events || events.length === 0) && (
                <div className="rounded-[1.2rem] border border-border/70 bg-card/70 px-5 py-8 text-sm text-muted-foreground">
                  No events found.
                </div>
              )}
          </div>

          {status === "CanLoadMore" && (
            <div>
              <Button
                type="button"
                onClick={() => loadMore(pageSize)}
                variant="outline"
                className="rounded-full"
              >
                Load more
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
