import { useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { api } from "@news-app/backend/convex/_generated/api";
import type { Id } from "@news-app/backend/convex/_generated/dataModel";
import { useConvexAuth, usePaginatedQuery, useQuery } from "convex/react";
import { buildFeedQueryArgs } from "@/lib/feed-query";
import {
  BrainCircuitIcon,
  CheckIcon,
  ChevronDownIcon,
  ClockIcon,
  FilterIcon,
  TrendingUpIcon,
  XIcon,
} from "lucide-react";
import AuthPromptBanner from "@/components/auth-prompt-banner";
import EventCard from "@/components/feed/event-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { useScrollVisibility } from "@/hooks/use-scroll-visibility";
import { getLocaleFromMatches } from "@/lib/i18n/getLocaleFromMatches";
import { useT } from "@/lib/i18n/LocaleContext";
import { getString } from "@/lib/i18n/strings";
import { cn } from "@/lib/utils";
import { SITE, absoluteSiteUrl } from "@/lib/seo";

export const Route = createFileRoute("/feed")({
  head: ({ matches }) => {
    const locale = getLocaleFromMatches(matches);
    const title = getString(locale, "feed.meta.title");
    const description = getString(locale, "feed.meta.description");

    return {
      meta: [
        { title },
        { name: "description", content: description },
        { property: "og:title", content: title },
        { property: "og:description", content: description },
        { property: "og:site_name", content: SITE.name },
        { name: "twitter:title", content: title },
        { name: "twitter:description", content: description },
        { property: "og:image", content: SITE.ogImage },
        { name: "twitter:image", content: SITE.ogImage },
        { property: "og:url", content: absoluteSiteUrl("/feed") },
        { property: "og:type", content: "website" },
        { name: "twitter:card", content: "summary_large_image" },
        { property: "og:locale", content: locale === "ro" ? "ro_RO" : "en_US" },
      ],
      links: [{ rel: "canonical", href: absoluteSiteUrl("/feed") }],
    };
  },
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
  const t = useT();

  return (
    <Command className="w-full">
      <CommandInput
        aria-label={t("feed.topic.search")}
        placeholder={t("feed.topic.search")}
      />
      <CommandList className="max-h-75">
        <CommandEmpty>{t("feed.topic.empty")}</CommandEmpty>
        <CommandGroup>
          <CommandItem
            value="all-topics"
            onSelect={() => onSelect("all")}
            className="flex items-center justify-between gap-2"
          >
            <span>{t("feed.topic.all")}</span>
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
  const t = useT();
  const [open, setOpen] = useState(false);
  const isMobile = useIsMobile();

  const selectedLabel = useMemo(() => {
    if (selectedTopic === "all") return t("feed.topic.all");
    return (
      topics?.find((topic) => topic._id === selectedTopic)?.displayName ??
      t("feed.topic.single")
    );
  }, [selectedTopic, t, topics]);

  const handleSelect = (topic: Id<"topics"> | "all") => {
    onSelect(topic);
    setOpen(false);
  };

  const triggerButton = (
    <Button
      variant="outline"
      size="sm"
      className={cn(
        "w-full max-w-52 min-w-0 justify-between gap-1.5 rounded-full px-3 sm:max-w-60 md:min-w-35 md:max-w-64 md:gap-2",
        selectedTopic !== "all" && "border-primary/50 bg-primary/5",
      )}
      aria-label={t("feed.topic.filter")}
    >
      <span className="flex min-w-0 flex-1 items-center gap-2">
        <FilterIcon className="size-3.5 shrink-0" />
        <span className="truncate">{selectedLabel}</span>
      </span>
      <ChevronDownIcon className="size-3.5 shrink-0 opacity-50" />
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
                  <DrawerTitle>{t("feed.topic.drawerTitle")}</DrawerTitle>
                  <DrawerDescription>
                    {t("feed.topic.drawerBody")}
                  </DrawerDescription>
                </div>
                <DrawerClose asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-8 rounded-full"
                    aria-label={t("feed.close")}
                  >
                    <XIcon className="size-4" />
                    <span className="sr-only">{t("feed.close")}</span>
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
            aria-label={t("feed.filter.clear")}
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
        <PopoverContent className="w-60 p-0" align="start">
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
          aria-label={t("feed.filter.clear")}
        >
          <XIcon className="size-4" />
        </Button>
      )}
    </div>
  );
}

function FeedComponent() {
  return <FeedContent />;
}

function FeedContent() {
  const t = useT();
  const isMobile = useIsMobile();
  const { isAuthenticated } = useConvexAuth();
  const topics = useQuery(api.topics.getTopics);
  const currentUser = useQuery(
    api.user.getCurrentUser,
    isAuthenticated ? {} : "skip",
  );
  const runtimeConfig = useQuery(api.config.getPublicRuntimeConfig);
  const rawPageSize = Number(runtimeConfig?.feedPageSize);
  const MAX_FEED_PAGE_SIZE = 50;
  const pageSize = Number.isFinite(rawPageSize)
    ? Math.min(MAX_FEED_PAGE_SIZE, Math.max(1, Math.floor(rawPageSize)))
    : 6;

  const rawMaxSources = Number(runtimeConfig?.eventCardMaxSources);
  const MAX_EVENT_CARD_SOURCES = 10;
  const maxSources = Number.isFinite(rawMaxSources)
    ? Math.min(MAX_EVENT_CARD_SOURCES, Math.max(0, Math.floor(rawMaxSources)))
    : 5;

  const [selectedTopic, setSelectedTopic] = useState<Id<"topics"> | "all">(
    "all",
  );
  const [feedSort, setFeedSort] = useState<"recent" | "trending">("trending");
  const [searchInput, setSearchInput] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const isSearching = debouncedSearch.length >= 2;
  const [isSearchFocused, setIsSearchFocused] = useState(false);
  const [recentSearches, setRecentSearches] = useState<string[]>([]);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const controlsRef = useRef<HTMLElement | null>(null);
  const loadMoreTriggerRef = useRef<HTMLDivElement | null>(null);
  const isLoadingMoreRef = useRef(false);
  const areControlsVisible = useScrollVisibility();
  const [controlsHeight, setControlsHeight] = useState(0);
  const hiddenControlsOffset = controlsHeight + (isMobile ? 12 : 80);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem("biviant-recent-event-searches");
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        setRecentSearches(
          parsed
            .filter((value): value is string => typeof value === "string")
            .slice(0, 5),
        );
      }
    } catch {
      // Ignore malformed localStorage.
    }
  }, []);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setDebouncedSearch(searchInput.trim());
    }, 250);

    return () => window.clearTimeout(timeout);
  }, [searchInput]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "/") return;
      if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) {
        return;
      }

      const target = event.target as HTMLElement | null;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target?.isContentEditable
      ) {
        return;
      }

      event.preventDefault();
      searchInputRef.current?.focus();
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    const element = controlsRef.current;
    if (!element) {
      return;
    }

    const updateHeight = () => {
      const nextHeight = Math.round(element.getBoundingClientRect().height);
      setControlsHeight((currentHeight) =>
        currentHeight === nextHeight ? currentHeight : nextHeight,
      );
    };

    updateHeight();

    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", updateHeight);
      return () => {
        window.removeEventListener("resize", updateHeight);
      };
    }

    const observer = new ResizeObserver(() => {
      updateHeight();
    });
    observer.observe(element);

    return () => {
      observer.disconnect();
    };
  }, [
    isSearchFocused,
    recentSearches.length,
    searchInput.length,
    selectedTopic,
    feedSort,
    isSearching,
  ]);

  const {
    results: events,
    status,
    loadMore,
  } = usePaginatedQuery(
    api.events.getPublishedEvents,
    buildFeedQueryArgs(selectedTopic, feedSort),
    { initialNumItems: pageSize },
  );
  const searchResults = useQuery(
    api.events.searchPublishedEvents,
    isSearching
      ? {
          query: debouncedSearch,
          limit: pageSize,
          topicId: selectedTopic === "all" ? undefined : selectedTopic,
        }
      : "skip",
  );
  const canLoadMore = !isSearching && status === "CanLoadMore";
  const isLoadingMore = !isSearching && status === "LoadingMore";
  const loadMoreRef = useRef(loadMore);

  const preferredTopicIds = useMemo(() => {
    if (!topics || !currentUser?.privateContext?.interests?.length) {
      return [];
    }

    const preferredNames = currentUser.privateContext.interests.map(
      (interest) => interest.trim().toLowerCase(),
    );

    return topics
      .filter((topic) => {
        const candidates = [topic.displayName, ...(topic.aliases ?? [])].map(
          (value) => value.trim().toLowerCase(),
        );
        return candidates.some((candidate) =>
          preferredNames.includes(candidate),
        );
      })
      .map((topic) => topic._id);
  }, [currentUser?.privateContext?.interests, topics]);

  const fallbackEvents = useQuery(
    api.events.getPublishedEventsByTopicIds,
    isSearching &&
      searchResults !== undefined &&
      searchResults.length === 0 &&
      preferredTopicIds.length > 0
      ? { topicIds: preferredTopicIds, limit: 5 }
      : "skip",
  );

  useEffect(() => {
    loadMoreRef.current = loadMore;
  }, [loadMore]);

  useEffect(() => {
    if (status !== "LoadingMore") {
      isLoadingMoreRef.current = false;
    }
  }, [status]);

  useEffect(() => {
    if (!canLoadMore) {
      return;
    }

    const target = loadMoreTriggerRef.current;
    if (!target) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (!entry?.isIntersecting || isLoadingMoreRef.current) {
          return;
        }

        isLoadingMoreRef.current = true;
        loadMoreRef.current(pageSize);
      },
      {
        rootMargin: "1200px 0px",
      },
    );

    observer.observe(target);

    return () => observer.disconnect();
  }, [canLoadMore, pageSize]);

  useEffect(() => {
    if (
      debouncedSearch.length < 2 ||
      searchResults === undefined ||
      searchResults.length === 0
    ) {
      return;
    }

    const next = [
      debouncedSearch,
      ...recentSearches.filter(
        (entry) => entry.toLowerCase() !== debouncedSearch.toLowerCase(),
      ),
    ].slice(0, 5);
    const isUnchanged =
      next.length === recentSearches.length &&
      next.every((value, index) => value === recentSearches[index]);
    if (isUnchanged) {
      return;
    }
    setRecentSearches(() => next);
    window.localStorage.setItem(
      "biviant-recent-event-searches",
      JSON.stringify(next),
    );
  }, [debouncedSearch, recentSearches, searchResults]);

  const topicNamesById = useMemo(() => {
    const map: Record<string, string> = {};
    topics?.forEach((topic) => {
      map[topic._id] = topic.displayName;
    });
    return map;
  }, [topics]);

  const featuredEvent = events?.[0];
  const remainingEvents = featuredEvent ? events.slice(1) : events;
  const featuredSearchEvent = searchResults?.[0];
  const remainingSearchEvents = featuredSearchEvent
    ? searchResults.slice(1)
    : searchResults;
  const shouldShowThresholdHint =
    isSearchFocused && searchInput.trim().length < 2;
  const shouldShowRecentSearches =
    isSearchFocused &&
    searchInput.trim().length === 0 &&
    recentSearches.length > 0;

  return (
    <div className="bg-linear-to-b from-background via-background to-muted/35">
      <div className="container mx-auto max-w-4xl px-4 py-6 sm:py-10">
        <div className="flex flex-col gap-6 sm:gap-8">
          <div
            aria-hidden="true"
            className="shrink-0"
            style={{
              height: controlsHeight > 0 ? `${controlsHeight}px` : undefined,
            }}
          />

          <div
            className="fixed inset-x-0 top-0 z-40 px-4 pt-3 transition-transform duration-300 ease-out md:top-16 md:pt-4"
            style={{
              transform: areControlsVisible
                ? "translateY(0)"
                : `translateY(-${Math.max(hiddenControlsOffset, 0)}px)`,
            }}
          >
            <div className="mx-auto max-w-4xl">
              <header
                ref={controlsRef}
                className="overflow-hidden rounded-[1.35rem] border border-border/70 bg-card/88 shadow-lg shadow-foreground/5 backdrop-blur-xl sm:rounded-[1.6rem]"
              >
                <div className="bg-linear-to-br from-background via-card to-muted/50 px-3 py-3 sm:px-4 sm:py-5">
                  <div className="flex flex-col gap-2.5 sm:gap-3">
                    <div className="flex flex-col gap-3">
                      <div className="relative flex-1">
                        <Input
                          ref={searchInputRef}
                          type="search"
                          value={searchInput}
                          onChange={(event) =>
                            setSearchInput(event.target.value)
                          }
                          onFocus={() => setIsSearchFocused(true)}
                          onBlur={() => {
                            window.setTimeout(
                              () => setIsSearchFocused(false),
                              100,
                            );
                          }}
                          placeholder={t("feed.search.placeholder")}
                          className="h-10 rounded-full border-border/80 bg-background/75 pr-11 text-base sm:h-11 sm:pr-12"
                          aria-label={t("feed.search.label")}
                        />
                        {searchInput.length > 0 && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="absolute right-1 top-1 size-8 rounded-full sm:size-9"
                            onClick={() => {
                              setSearchInput("");
                              setDebouncedSearch("");
                            }}
                            aria-label={t("feed.search.clear")}
                          >
                            <XIcon className="size-4" />
                          </Button>
                        )}
                      </div>
                    </div>
                    <div className="border-t border-border/60 pt-2.5 sm:pt-3">
                      <div className="flex items-center gap-2 sm:gap-3">
                        <div className="min-w-0 w-full max-w-52 sm:max-w-60 md:max-w-64">
                          <TopicFilter
                            topics={topics}
                            selectedTopic={selectedTopic}
                            onSelect={setSelectedTopic}
                          />
                        </div>
                        {!isSearching && (
                          <div className="inline-grid h-8 shrink-0 grid-cols-2 rounded-full bg-muted/70 p-1 sm:h-9">
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className={cn(
                                "h-6 rounded-full px-2 text-xs sm:h-7 sm:px-3",
                                feedSort === "recent" &&
                                  "bg-background text-foreground shadow-sm",
                              )}
                              onClick={() => setFeedSort("recent")}
                              aria-pressed={feedSort === "recent"}
                            >
                              <ClockIcon className="size-3.5" />
                              {t("feed.sort.recent")}
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className={cn(
                                "h-6 rounded-full px-2 text-xs sm:h-7 sm:px-3",
                                feedSort === "trending" &&
                                  "bg-background text-foreground shadow-sm",
                              )}
                              onClick={() => setFeedSort("trending")}
                              aria-pressed={feedSort === "trending"}
                            >
                              <TrendingUpIcon className="size-3.5" />
                              {t("feed.sort.trending")}
                            </Button>
                          </div>
                        )}
                      </div>
                    </div>
                    {shouldShowThresholdHint && (
                      <p className="text-xs text-muted-foreground">
                        {t("feed.search.threshold")}
                      </p>
                    )}
                    {shouldShowRecentSearches && (
                      <div className="flex flex-wrap gap-2">
                        {recentSearches.map((recentSearch) => (
                          <Button
                            key={recentSearch}
                            type="button"
                            variant="outline"
                            size="sm"
                            className="rounded-full"
                            onMouseDown={(event) => event.preventDefault()}
                            onClick={() => {
                              setSearchInput(recentSearch);
                              setDebouncedSearch(recentSearch);
                              searchInputRef.current?.focus();
                            }}
                          >
                            {recentSearch}
                          </Button>
                        ))}
                      </div>
                    )}
                    {isSearching && (
                      <p
                        className="text-xs text-muted-foreground"
                        role="status"
                        aria-live="polite"
                        aria-atomic="true"
                      >
                        {t("feed.search.indexed").replace(
                          "{query}",
                          debouncedSearch,
                        )}
                      </p>
                    )}
                  </div>
                </div>
              </header>
            </div>
          </div>

          {!isAuthenticated && (
            <AuthPromptBanner
              redirectTo="/feed"
              compact
              title={t("feed.authTitle")}
            />
          )}

          {!isSearching && (
            <section className="flex flex-col gap-3 rounded-xl border border-border bg-card/90 px-4 py-4 shadow-sm sm:flex-row sm:items-center sm:justify-between sm:px-5">
              <div className="flex items-start gap-3">
                <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <BrainCircuitIcon className="size-5" />
                </div>
                <div>
                  <h2 className="text-sm font-semibold">
                    {t("quiz.cta.feedTitle")}
                  </h2>
                  <p className="text-sm text-muted-foreground">
                    {t("quiz.cta.feedBody")}
                  </p>
                </div>
              </div>
              <Button asChild size="sm" className="shrink-0">
                <Link to="/quiz">{t("quiz.cta.action")}</Link>
              </Button>
            </section>
          )}

          <div className="grid gap-6">
            {isSearching && searchResults === undefined && (
              <div
                role="status"
                aria-live="polite"
                className="rounded-[1.2rem] border border-border/70 bg-card/70 px-5 py-8 text-sm text-muted-foreground"
              >
                {t("feed.searching")}
              </div>
            )}
            {status === "LoadingFirstPage" && (
              <div
                role="status"
                aria-live="polite"
                className="rounded-[1.2rem] border border-border/70 bg-card/70 px-5 py-8 text-sm text-muted-foreground"
              >
                {t("feed.loading")}
              </div>
            )}

            {!isSearching && featuredEvent ? (
              <section className="flex flex-col gap-4">
                <div className="flex items-center justify-between gap-4">
                  <h2 className="text-lg font-semibold tracking-tight text-foreground">
                    {feedSort === "recent"
                      ? t("feed.leadStory")
                      : t("feed.trendingStory")}
                  </h2>
                </div>
                <EventCard
                  event={featuredEvent}
                  topicNamesById={topicNamesById}
                  maxSources={maxSources}
                  variant="feature"
                  returnToFeed
                />
              </section>
            ) : null}

            {isSearching && featuredSearchEvent ? (
              <section className="flex flex-col gap-4">
                <div className="flex items-center justify-between gap-4">
                  <h2 className="text-lg font-semibold tracking-tight text-foreground">
                    {t("feed.topSearch")}
                  </h2>
                  <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
                    {t("feed.searchTag")}
                  </p>
                </div>
                <EventCard
                  event={featuredSearchEvent}
                  topicNamesById={topicNamesById}
                  maxSources={maxSources}
                  variant="feature"
                  searchQuery={debouncedSearch}
                  returnToFeed
                />
              </section>
            ) : null}

            {(!isSearching && remainingEvents && remainingEvents.length > 0) ||
            (isSearching &&
              remainingSearchEvents &&
              remainingSearchEvents.length > 0) ? (
              <section className="flex flex-col gap-4">
                <div className="flex items-center justify-between gap-4">
                  <h2 className="text-lg font-semibold tracking-tight text-foreground">
                    {isSearching ? t("feed.moreSearch") : t("feed.moreEvents")}
                  </h2>
                  {isSearching ? (
                    <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
                      {t("feed.bestMatches")}
                    </p>
                  ) : null}
                </div>
                <div className="grid gap-5">
                  {(isSearching ? remainingSearchEvents : remainingEvents)?.map(
                    (event) => (
                      <EventCard
                        key={event._id}
                        event={event}
                        topicNamesById={topicNamesById}
                        maxSources={maxSources}
                        searchQuery={isSearching ? debouncedSearch : undefined}
                        returnToFeed
                      />
                    ),
                  )}
                </div>
              </section>
            ) : null}

            {isSearching && searchResults?.length === 0 && (
              <section className="flex flex-col gap-4">
                <div className="rounded-[1.2rem] border border-border/70 bg-card/70 px-5 py-8 text-sm text-muted-foreground">
                  <p>{t("feed.noMatch").replace("{query}", debouncedSearch)}</p>
                  <p className="mt-2">{t("feed.tryFewer")}</p>
                </div>
                {fallbackEvents && fallbackEvents.length > 0 && (
                  <div className="flex flex-col gap-4">
                    <div className="flex items-center justify-between gap-4">
                      <h2 className="text-lg font-semibold tracking-tight text-foreground">
                        {t("feed.preferredTopics")}
                      </h2>
                      <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
                        {t("feed.latestFive")}
                      </p>
                    </div>
                    <div className="grid gap-5">
                      {fallbackEvents.map((event) => (
                        <EventCard
                          key={event._id}
                          event={event}
                          topicNamesById={topicNamesById}
                          maxSources={maxSources}
                          returnToFeed
                        />
                      ))}
                    </div>
                  </div>
                )}
              </section>
            )}

            {!isSearching &&
              status !== "LoadingFirstPage" &&
              (!events || events.length === 0) && (
                <div className="rounded-[1.2rem] border border-border/70 bg-card/70 px-5 py-8 text-sm text-muted-foreground">
                  {t("feed.none")}
                </div>
              )}
          </div>

          {!isSearching && (canLoadMore || isLoadingMore) && (
            <div className="flex flex-col items-center gap-3 py-2">
              <div
                ref={loadMoreTriggerRef}
                aria-hidden="true"
                className="h-px w-full"
              />
              {isLoadingMore && (
                <div
                  role="status"
                  aria-live="polite"
                  className="text-sm text-muted-foreground"
                >
                  {t("feed.loading")}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
