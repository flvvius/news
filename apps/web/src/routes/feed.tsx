import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { api } from "@news-app/backend/convex/_generated/api";
import type { Id } from "@news-app/backend/convex/_generated/dataModel";
import { usePaginatedQuery, useQuery } from "convex/react";
import { CheckIcon, ChevronDownIcon, FilterIcon, XIcon } from "lucide-react";
import EventCard from "@/components/feed/event-card";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "@/components/ui/drawer";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useIsMobile } from "@/components/ui/use-mobile";
import { cn } from "@/lib/utils";
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

function TopicFilterContent({
  topics,
  selectedTopic,
  onSelect,
}: {
  topics: Array<{ _id: Id<"topics">; displayName: string }> | undefined;
  selectedTopic: Id<"topics"> | "all";
  onSelect: (topic: Id<"topics"> | "all") => void;
}) {
  return (
    <Command className="w-full">
      <CommandInput placeholder="Search topics..." />
      <CommandList className="max-h-[300px]">
        <CommandEmpty>No topics found.</CommandEmpty>
        <CommandGroup>
          <CommandItem
            value="all-topics"
            onSelect={() => onSelect("all")}
            className="flex items-center justify-between gap-2"
          >
            <span>All Topics</span>
            {selectedTopic === "all" && (
              <CheckIcon className="size-4 text-primary" />
            )}
          </CommandItem>
          {topics?.map((topic) => (
            <CommandItem
              key={topic._id}
              value={topic.displayName}
              onSelect={() => onSelect(topic._id)}
              className="flex items-center justify-between gap-2"
            >
              <span>{topic.displayName}</span>
              {selectedTopic === topic._id && (
                <CheckIcon className="size-4 text-primary" />
              )}
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </Command>
  );
}

function TopicFilter({
  topics,
  selectedTopic,
  onSelect,
}: {
  topics: Array<{ _id: Id<"topics">; displayName: string }> | undefined;
  selectedTopic: Id<"topics"> | "all";
  onSelect: (topic: Id<"topics"> | "all") => void;
}) {
  const [open, setOpen] = useState(false);
  const isMobile = useIsMobile();

  const selectedLabel = useMemo(() => {
    if (selectedTopic === "all") return "All Topics";
    return topics?.find((t) => t._id === selectedTopic)?.displayName ?? "Topic";
  }, [selectedTopic, topics]);

  const handleSelect = (topic: Id<"topics"> | "all") => {
    onSelect(topic);
    setOpen(false);
  };

  const triggerButton = (
    <Button
      variant="outline"
      size="sm"
      className={cn(
        "min-w-[140px] justify-between gap-2 rounded-full",
        selectedTopic !== "all" && "border-primary/50 bg-primary/5",
      )}
      aria-label="Filter by topic"
    >
      <span className="flex items-center gap-2">
        <FilterIcon className="size-3.5" />
        <span className="max-w-[120px] truncate">{selectedLabel}</span>
      </span>
      <ChevronDownIcon className="size-3.5 opacity-50" />
    </Button>
  );

  if (isMobile) {
    return (
      <div className="flex items-center gap-2">
        <Drawer open={open} onOpenChange={setOpen}>
          <DrawerTrigger asChild>{triggerButton}</DrawerTrigger>
          <DrawerContent>
            <DrawerHeader className="border-b border-border pb-4">
              <div className="flex items-center justify-between">
                <div>
                  <DrawerTitle>Filter by Topic</DrawerTitle>
                  <DrawerDescription>
                    Select a topic to filter stories
                  </DrawerDescription>
                </div>
                <DrawerClose asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-8 rounded-full"
                  >
                    <XIcon className="size-4" />
                    <span className="sr-only">Close</span>
                  </Button>
                </DrawerClose>
              </div>
            </DrawerHeader>
            <div className="p-4">
              <TopicFilterContent
                topics={topics}
                selectedTopic={selectedTopic}
                onSelect={handleSelect}
              />
            </div>
          </DrawerContent>
        </Drawer>

        {selectedTopic !== "all" && (
          <Button
            variant="ghost"
            size="icon"
            className="size-8 rounded-full"
            onClick={() => onSelect("all")}
            aria-label="Clear filter"
          >
            <XIcon className="size-4" />
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>{triggerButton}</PopoverTrigger>
        <PopoverContent className="w-[240px] p-0" align="start">
          <TopicFilterContent
            topics={topics}
            selectedTopic={selectedTopic}
            onSelect={handleSelect}
          />
        </PopoverContent>
      </Popover>

      {selectedTopic !== "all" && (
        <Button
          variant="ghost"
          size="icon"
          className="size-8 rounded-full"
          onClick={() => onSelect("all")}
          aria-label="Clear filter"
        >
          <XIcon className="size-4" />
        </Button>
      )}
    </div>
  );
}

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
            <div className="bg-linear-to-br from-background via-card to-muted/50 px-3 py-4 sm:px-4 sm:py-5">
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs font-semibold uppercase tracking-[0.24em] text-muted-foreground">
                  Biviant Feed
                </p>
                <div className="shrink-0">
                  <TopicFilter
                    topics={topics}
                    selectedTopic={selectedTopic}
                    onSelect={setSelectedTopic}
                  />
                </div>
              </div>
            </div>
          </header>

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
