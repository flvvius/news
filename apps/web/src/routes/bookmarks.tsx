import { useMemo } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { api } from "@news-app/backend/convex/_generated/api";
import {
  Authenticated,
  AuthLoading,
  Unauthenticated,
  useQuery,
} from "convex/react";
import EventCard from "@/components/feed/event-card";
import { Button } from "@/components/ui/button";
import { SITE } from "@/lib/seo";

/** Validate and clamp a config value to a non-negative integer. */
function safePositiveInt(raw: unknown, fallback: number): number {
  const n = Number(raw);
  return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : fallback;
}

export const Route = createFileRoute("/bookmarks")({
  head: () => ({
    meta: [
      { title: `Bookmarks — ${SITE.name}` },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: BookmarksPage,
});

function BookmarksPage() {
  return (
    <>
      <Authenticated>
        <BookmarksContent />
      </Authenticated>
      <Unauthenticated>
        <div className="bg-gradient-to-b from-background via-background to-muted/35 min-h-[calc(100vh-4rem)]">
          <div className="container mx-auto max-w-4xl px-4 py-8 sm:py-10">
            <div className="flex flex-col items-center justify-center py-20 gap-6">
              <div className="overflow-hidden rounded-[1.6rem] border border-border/70 bg-card/80 shadow-sm p-8 sm:p-12 max-w-md w-full text-center">
                <div className="flex flex-col items-center gap-6">
                  <div className="flex items-center justify-center size-16 rounded-full bg-primary/10 text-primary">
                    <svg className="size-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M17.593 3.322c1.1.128 1.907 1.077 1.907 2.185V21L12 17.25 4.5 21V5.507c0-1.108.806-2.057 1.907-2.185a48.507 48.507 0 0111.186 0z" />
                    </svg>
                  </div>
                  <div>
                    <h1 className="text-2xl font-bold tracking-tight mb-2">
                      Sign in to see your bookmarks
                    </h1>
                    <p className="text-muted-foreground text-sm">
                      Bookmark events to read later from any device. Your bookmarks sync across all your sessions.
                    </p>
                  </div>
                  <Button asChild size="lg" className="w-full rounded-full">
                    <Link to="/dashboard">
                      Sign in to continue
                    </Link>
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </Unauthenticated>
      <AuthLoading>
        <div className="bg-gradient-to-b from-background via-background to-muted/35 min-h-[calc(100vh-4rem)]">
          <div className="container mx-auto max-w-4xl px-4 py-8 sm:py-10">
            <div className="flex flex-col items-center justify-center py-20 gap-4">
              <div className="rounded-[1.2rem] border border-border/70 bg-card/70 px-6 py-8 text-sm text-muted-foreground">
                Loading...
              </div>
            </div>
          </div>
        </div>
      </AuthLoading>
    </>
  );
}

function BookmarksContent() {
  const bookmarks = useQuery(api.interactions.getBookmarkedEvents);
  const topics = useQuery(api.topics.getTopics);
  const maxSourcesConfig = useQuery(api.config.get, {
    key: "event_card_max_sources",
  });
  const maxSources = safePositiveInt(maxSourcesConfig?.value, 5);

  const topicNamesById = useMemo(() => {
    const map: Record<string, string> = {};
    topics?.forEach((topic) => {
      map[topic._id] = topic.displayName;
    });
    return map;
  }, [topics]);

  if (bookmarks === undefined) {
    return (
      <div className="bg-gradient-to-b from-background via-background to-muted/35 min-h-[calc(100vh-4rem)]">
        <div className="container mx-auto max-w-4xl px-4 py-8 sm:py-10">
          <div className="flex flex-col items-center justify-center py-20 gap-4">
            <div className="rounded-[1.2rem] border border-border/70 bg-card/70 px-6 py-8 text-sm text-muted-foreground">
              Loading bookmarks...
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-gradient-to-b from-background via-background to-muted/35">
      <div className="container mx-auto max-w-4xl px-4 py-8 sm:py-10">
        <div className="flex flex-col gap-8">
          {/* Header */}
          <header className="overflow-hidden rounded-[1.6rem] border border-border/70 bg-card/80 shadow-sm">
            <div className="bg-gradient-to-br from-background via-card to-muted/50 px-6 py-8 sm:px-8 sm:py-10">
              <div className="flex flex-col gap-4">
                <p className="text-xs font-semibold uppercase tracking-[0.24em] text-muted-foreground">
                  Saved for Later
                </p>
                <div className="flex max-w-[65ch] flex-col gap-3">
                  <h1 className="text-4xl font-bold tracking-tight text-foreground sm:text-5xl">
                    Your Bookmarks
                  </h1>
                  <p className="max-w-[55ch] text-sm text-muted-foreground sm:text-base">
                    {bookmarks.length === 0 
                      ? "Events you save will appear here. Bookmark any story to read it later."
                      : `You have ${bookmarks.length} ${bookmarks.length === 1 ? "event" : "events"} saved for later.`
                    }
                  </p>
                </div>
              </div>
            </div>
          </header>

          {/* Content */}
          {bookmarks.length === 0 ? (
            <div className="rounded-[1.6rem] border border-border/70 bg-card/80 p-8 sm:p-12">
              <div className="flex flex-col items-center justify-center gap-6 text-center">
                <div className="flex items-center justify-center size-16 rounded-full bg-muted">
                  <svg className="size-8 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 7.5h1.5m-1.5 3h1.5m-7.5 3h7.5m-7.5 3h7.5m3-9h3.375c.621 0 1.125.504 1.125 1.125V18a2.25 2.25 0 01-2.25 2.25M16.5 7.5V18a2.25 2.25 0 002.25 2.25M16.5 7.5V4.875c0-.621-.504-1.125-1.125-1.125H4.125C3.504 3.75 3 4.254 3 4.875V18a2.25 2.25 0 002.25 2.25h13.5M6 7.5h3v3H6v-3z" />
                  </svg>
                </div>
                <div>
                  <h3 className="font-semibold text-lg mb-2">No bookmarks yet</h3>
                  <p className="text-sm text-muted-foreground max-w-sm">
                    When you find an interesting story, tap the bookmark icon to save it here for later reading.
                  </p>
                </div>
                <Button asChild variant="outline" className="rounded-full">
                  <Link to="/feed">
                    Browse the feed
                  </Link>
                </Button>
              </div>
            </div>
          ) : (
            <div className="grid gap-5">
              {bookmarks.map((event) => (
                <EventCard
                  key={event._id}
                  event={event}
                  topicNamesById={topicNamesById}
                  maxSources={maxSources}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
