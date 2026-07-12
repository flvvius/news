import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
} from "react";
import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { z } from "zod";
import { api } from "@news-app/backend/convex/_generated/api";
import type { Id } from "@news-app/backend/convex/_generated/dataModel";
import { useConvexAuth, usePaginatedQuery, useQuery } from "convex/react";
import { buildFeedQueryArgs } from "@/lib/feed-query";
import { CheckIcon, ChevronDownIcon, FilterIcon, XIcon } from "lucide-react";
import { QuizCta } from "@/components/quiz-cta";
import EventCard from "@/components/feed/event-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SectionTitle } from "@/components/ui/section-title";
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
import { getLocaleFromMatches } from "@/lib/i18n/getLocaleFromMatches";
import { useT } from "@/lib/i18n/LocaleContext";
import { getString } from "@/lib/i18n/strings";
import { cn } from "@/lib/utils";
import {
  SITE,
  absoluteSiteUrl,
  jsonLdScript,
  organizationJsonLd,
  softwareApplicationJsonLd,
} from "@/lib/seo";

// The event shape EventCard consumes. Loader/query results feed straight
// into it; annotating the .map callbacks explicitly keeps the typecheck
// stable even when the generated loader types resolve loosely in CI.
type FeedEventCardData = ComponentProps<typeof EventCard>["event"];

// Crawl archive: fixed pages behind ?page=N so a no-JS crawler can reach
// every published event through real anchors (Googlebot does not scroll).
const ARCHIVE_PAGE_SIZE = 20;
// Matches the client-side default page size so hydration swaps the SSR list
// for the live subscription without a visible jump.
const SSR_FEED_PAGE_SIZE = 6;

const feedSearchSchema = z.object({
  page: z.coerce.number().int().min(1).optional().catch(undefined),
});

export const Route = createFileRoute("/")({
  validateSearch: feedSearchSchema,
  loaderDeps: ({ search }) => ({ page: search.page }),
  loader: async ({ context, deps }) => {
    const client =
      context.convexQueryClient.serverHttpClient ?? context.convexClient;

    if (deps.page !== undefined) {
      let archive;
      try {
        archive = await client.query(api.events.getPublishedEventsArchivePage, {
          page: deps.page,
          pageSize: ARCHIVE_PAGE_SIZE,
        });
      } catch (error) {
        console.error(
          `[Route loader] Failed to load feed archive page ${deps.page}:`,
          error,
        );
        return { archive: null };
      }
      if (archive.events.length === 0 && deps.page > 1) {
        // Out-of-range page numbers must 404, not mirror another page.
        throw notFound();
      }
      return { archive };
    }

    // Interactive feed: server-render the first page of events so the feed
    // is not a loading shell for crawlers; the live subscription takes over
    // after hydration. The anonymous trending snapshot keeps this cheap.
    try {
      const first = await client.query(api.events.getPublishedEvents, {
        ...buildFeedQueryArgs("all", "trending"),
        paginationOpts: { numItems: SSR_FEED_PAGE_SIZE, cursor: null },
      });
      return { initialEvents: first.page };
    } catch (error) {
      console.error("[Route loader] Failed to load initial feed page:", error);
      return { initialEvents: [] };
    }
  },
  head: ({ matches, loaderData }) => {
    const locale = getLocaleFromMatches(matches);
    const archivePage =
      loaderData && "archive" in loaderData
        ? (loaderData.archive?.page ?? null)
        : null;
    const baseTitle = getString(locale, "feed.meta.title");
    const title = archivePage
      ? `${baseTitle} — ${getString(locale, "feed.archive.page").replace("{page}", String(archivePage))}`
      : baseTitle;
    const description = getString(locale, "feed.meta.description");
    // The feed is served at the root URL; paginated archive pages
    // self-canonicalize to /?page=N.
    const canonicalPath = archivePage ? `/?page=${archivePage}` : "/";

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
        { property: "og:image:alt", content: SITE.ogImageAlt },
        { name: "twitter:image", content: SITE.ogImage },
        { property: "og:url", content: absoluteSiteUrl(canonicalPath) },
        { property: "og:type", content: "website" },
        { name: "twitter:card", content: "summary_large_image" },
        { property: "og:locale", content: locale === "ro" ? "ro_RO" : "en_US" },
      ],
      links: [{ rel: "canonical", href: absoluteSiteUrl(canonicalPath) }],
      // Org + app schema only on the landing page (the feed root), not on
      // every paginated archive page.
      scripts: archivePage
        ? []
        : [
            jsonLdScript(organizationJsonLd()),
            jsonLdScript(softwareApplicationJsonLd(description)),
          ],
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

function useTopicNamesById() {
  const topics = useQuery(api.topics.getTopics);
  const topicNamesById = useMemo(() => {
    const map: Record<string, string> = {};
    topics?.forEach((topic) => {
      map[topic._id] = topic.displayName;
    });
    return map;
  }, [topics]);
  return { topics, topicNamesById };
}

function FeedComponent() {
  const { page } = Route.useSearch();
  if (page !== undefined) {
    return <FeedArchive />;
  }
  return <FeedContent />;
}

/**
 * Static, crawlable slice of the feed (/?page=N): server-rendered event
 * list in stable recent order with real previous/next anchors. Infinite
 * scroll on / stays the interactive experience layered on top.
 */
function FeedArchive() {
  const t = useT();
  const loaderData = Route.useLoaderData();
  const { topicNamesById } = useTopicNamesById();
  const archive =
    loaderData && "archive" in loaderData ? loaderData.archive : null;

  if (!archive) {
    return (
      <div className="container mx-auto max-w-4xl px-4 py-8">
        <p
          role="status"
          aria-live="polite"
          className="text-sm text-muted-foreground"
        >
          {t("feed.loading")}
        </p>
      </div>
    );
  }

  return (
    <div className="bg-background">
      <div className="container mx-auto max-w-4xl px-4 py-6 sm:py-10">
        <div className="flex flex-col gap-6">
          <header className="flex flex-col gap-2 border-b border-border pb-4">
            <SectionTitle>{t("feed.archive.title")}</SectionTitle>
            <p className="text-sm text-muted-foreground">
              {t("feed.archive.page").replace("{page}", String(archive.page))}
            </p>
            <Link
              to="/"
              className="text-sm text-muted-foreground underline hover:text-foreground"
            >
              {t("feed.archive.backToFeed")}
            </Link>
          </header>

          {archive.events.length === 0 ? (
            <p className="py-8 text-sm text-muted-foreground">
              {t("feed.archive.empty")}
            </p>
          ) : (
            <div className="flex flex-col divide-y divide-border">
              {archive.events.map((event: FeedEventCardData) => (
                <div key={event._id} className="py-5">
                  <EventCard event={event} topicNamesById={topicNamesById} />
                </div>
              ))}
            </div>
          )}

          <nav
            aria-label={t("feed.archive.title")}
            className="flex items-center justify-between border-t border-border pt-4 text-sm"
          >
            {archive.page > 1 ? (
              <Link
                to="/"
                search={{ page: archive.page - 1 }}
                className="text-muted-foreground underline hover:text-foreground"
              >
                ← {t("feed.archive.prev")}
              </Link>
            ) : (
              <Link
                to="/"
                className="text-muted-foreground underline hover:text-foreground"
              >
                ← {t("feed.archive.backToFeed")}
              </Link>
            )}
            {archive.hasMore && (
              <Link
                to="/"
                search={{ page: archive.page + 1 }}
                className="text-muted-foreground underline hover:text-foreground"
              >
                {t("feed.archive.next")} →
              </Link>
            )}
          </nav>
        </div>
      </div>
    </div>
  );
}

function FeedContent() {
  const t = useT();
  const loaderData = Route.useLoaderData();
  const initialEvents =
    loaderData && "initialEvents" in loaderData ? loaderData.initialEvents : [];
  const { isAuthenticated } = useConvexAuth();
  const { topics, topicNamesById } = useTopicNamesById();
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
  const loadMoreTriggerRef = useRef<HTMLDivElement | null>(null);
  const isLoadingMoreRef = useRef(false);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem("miez-recent-event-searches");
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

  const {
    results: liveEvents,
    status,
    loadMore,
  } = usePaginatedQuery(
    api.events.getPublishedEvents,
    buildFeedQueryArgs(selectedTopic, feedSort),
    { initialNumItems: pageSize },
  );
  // Until the live subscription delivers its first page, fall back to the
  // loader's server-fetched events so the initial (and crawler-visible)
  // HTML contains real content instead of a loading shell.
  const events =
    status === "LoadingFirstPage" && liveEvents.length === 0
      ? initialEvents
      : liveEvents;
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
      "miez-recent-event-searches",
      JSON.stringify(next),
    );
  }, [debouncedSearch, recentSearches, searchResults]);

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
    <div className="bg-background">
      <div className="container mx-auto max-w-4xl px-4 py-6 sm:py-10">
        <div className="flex flex-col gap-6 sm:gap-8">
          {/* Feed controls: flat, in-flow — no floating glass, no
              scroll-linked motion (BIV-807, native DESIGN_LOG). */}
          <header className="flex flex-col gap-3 border-b border-border pb-4">
            <div className="relative">
              <Input
                ref={searchInputRef}
                type="search"
                value={searchInput}
                onChange={(event) => setSearchInput(event.target.value)}
                onFocus={() => setIsSearchFocused(true)}
                onBlur={() => {
                  window.setTimeout(() => setIsSearchFocused(false), 100);
                }}
                placeholder={t("feed.search.placeholder")}
                className="h-10 pr-11 text-base"
                aria-label={t("feed.search.label")}
              />
              {searchInput.length > 0 && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="absolute right-1 top-1 size-8"
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
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0 w-full max-w-52 sm:max-w-60 md:max-w-64">
                <TopicFilter
                  topics={topics}
                  selectedTopic={selectedTopic}
                  onSelect={setSelectedTopic}
                />
              </div>
              {!isSearching && (
                /* Plain-text segmented control: weight + color, not pills. */
                <div className="flex shrink-0 items-center gap-4 text-sm">
                  <button
                    type="button"
                    className={cn(
                      "transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                      feedSort === "recent"
                        ? "font-semibold text-foreground"
                        : "font-medium text-muted-foreground hover:text-foreground",
                    )}
                    onClick={() => setFeedSort("recent")}
                    aria-pressed={feedSort === "recent"}
                  >
                    {t("feed.sort.recent")}
                  </button>
                  <button
                    type="button"
                    className={cn(
                      "transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                      feedSort === "trending"
                        ? "font-semibold text-foreground"
                        : "font-medium text-muted-foreground hover:text-foreground",
                    )}
                    onClick={() => setFeedSort("trending")}
                    aria-pressed={feedSort === "trending"}
                  >
                    {t("feed.sort.trending")}
                  </button>
                </div>
              )}
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
                {t("feed.search.indexed").replace("{query}", debouncedSearch)}
              </p>
            )}
          </header>

          {!isSearching && <QuizCta variant="feed" />}

          <div className="flex flex-col gap-8">
            {isSearching && searchResults === undefined && (
              <p
                role="status"
                aria-live="polite"
                className="py-8 text-sm text-muted-foreground"
              >
                {t("feed.searching")}
              </p>
            )}
            {status === "LoadingFirstPage" && events.length === 0 && (
              <p
                role="status"
                aria-live="polite"
                className="py-8 text-sm text-muted-foreground"
              >
                {t("feed.loading")}
              </p>
            )}

            {!isSearching && featuredEvent ? (
              <section className="flex flex-col gap-4 border-b border-border pb-8">
                <SectionTitle>
                  {feedSort === "recent"
                    ? t("feed.leadStory")
                    : t("feed.trendingStory")}
                </SectionTitle>
                <EventCard
                  event={featuredEvent}
                  topicNamesById={topicNamesById}
                  variant="feature"
                  returnToFeed
                />
              </section>
            ) : null}

            {isSearching && featuredSearchEvent ? (
              <section className="flex flex-col gap-4 border-b border-border pb-8">
                <SectionTitle>{t("feed.topSearch")}</SectionTitle>
                <EventCard
                  event={featuredSearchEvent}
                  topicNamesById={topicNamesById}
                  searchQuery={debouncedSearch}
                  returnToFeed
                />
              </section>
            ) : null}

            {(!isSearching && remainingEvents && remainingEvents.length > 0) ||
            (isSearching &&
              remainingSearchEvents &&
              remainingSearchEvents.length > 0) ? (
              <section className="flex flex-col gap-2">
                <SectionTitle>
                  {isSearching ? t("feed.moreSearch") : t("feed.moreEvents")}
                </SectionTitle>
                <div className="flex flex-col divide-y divide-border">
                  {(isSearching ? remainingSearchEvents : remainingEvents)?.map(
                    (event: FeedEventCardData) => (
                      <div key={event._id} className="py-5">
                        <EventCard
                          event={event}
                          topicNamesById={topicNamesById}
                          searchQuery={
                            isSearching ? debouncedSearch : undefined
                          }
                          returnToFeed
                        />
                      </div>
                    ),
                  )}
                </div>
              </section>
            ) : null}

            {isSearching && searchResults?.length === 0 && (
              <section className="flex flex-col gap-6">
                <div className="py-4 text-sm text-muted-foreground">
                  <p>{t("feed.noMatch").replace("{query}", debouncedSearch)}</p>
                  <p className="mt-2">{t("feed.tryFewer")}</p>
                </div>
                {fallbackEvents && fallbackEvents.length > 0 && (
                  <div className="flex flex-col gap-2">
                    <SectionTitle>{t("feed.preferredTopics")}</SectionTitle>
                    <div className="flex flex-col divide-y divide-border">
                      {fallbackEvents.map((event) => (
                        <div key={event._id} className="py-5">
                          <EventCard
                            event={event}
                            topicNamesById={topicNamesById}
                            returnToFeed
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </section>
            )}

            {!isSearching &&
              status !== "LoadingFirstPage" &&
              (!events || events.length === 0) && (
                <p
                  role="status"
                  aria-live="polite"
                  className="py-8 text-sm text-muted-foreground"
                >
                  {t("feed.none")}
                </p>
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

          {/* Crawlable entry into the paginated archive: a real anchor a
              no-JS crawler can follow, since it cannot trigger the
              infinite-scroll observer above. */}
          {!isSearching && (
            <nav
              aria-label={t("feed.archive.title")}
              className="border-t border-border pt-4"
            >
              <Link
                to="/"
                search={{ page: 1 }}
                className="text-sm text-muted-foreground underline hover:text-foreground"
              >
                {t("feed.archive.browse")} →
              </Link>
            </nav>
          )}
        </div>
      </div>
    </div>
  );
}
