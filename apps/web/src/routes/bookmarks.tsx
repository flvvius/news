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
import { Bookmark, Loader2, LogIn, Newspaper } from "lucide-react";

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
        <div className="min-h-[calc(100vh-4rem)] flex items-center justify-center">
          <div className="flex flex-col items-center text-center gap-6 max-w-md px-4">
            <div className="relative">
              <div className="flex items-center justify-center size-20 rounded-2xl bg-primary/10 text-primary">
                <Bookmark className="size-10" />
              </div>
              <div className="absolute -bottom-1 -right-1 flex items-center justify-center size-8 rounded-full bg-muted border-2 border-background">
                <LogIn className="size-4 text-muted-foreground" />
              </div>
            </div>
            <div>
              <h1 className="text-2xl font-bold mb-2">
                Sign in to see your bookmarks
              </h1>
              <p className="text-muted-foreground">
                Bookmark events to read later from any device. Your bookmarks
                sync across all your sessions.
              </p>
            </div>
            <Link to="/dashboard">
              <Button size="lg" className="mt-2">
                Sign in to continue
              </Button>
            </Link>
          </div>
        </div>
      </Unauthenticated>
      <AuthLoading>
        <div className="min-h-[calc(100vh-4rem)] flex items-center justify-center">
          <div className="flex flex-col items-center gap-4">
            <Loader2 className="size-8 text-primary animate-spin" />
            <p className="text-sm text-muted-foreground">Loading...</p>
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
      <div className="min-h-[calc(100vh-4rem)] flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="size-8 text-primary animate-spin" />
          <p className="text-sm text-muted-foreground">
            Loading bookmarks...
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-[calc(100vh-4rem)]">
      {/* Page Header */}
      <div className="border-b border-border bg-muted/20">
        <div className="container mx-auto max-w-5xl px-4 py-8">
          <div className="flex items-center gap-4">
            <div className="flex items-center justify-center size-12 rounded-xl bg-primary/10 text-primary">
              <Bookmark className="size-6" />
            </div>
            <div>
              <h1 className="text-3xl font-bold tracking-tight">Bookmarks</h1>
              <p className="text-muted-foreground">Events you saved for later</p>
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="container mx-auto max-w-5xl px-4 py-8">
        {bookmarks.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 gap-4">
            <div className="flex items-center justify-center size-16 rounded-2xl bg-muted">
              <Newspaper className="size-8 text-muted-foreground" />
            </div>
            <div className="text-center">
              <h3 className="font-semibold mb-1">No bookmarks yet</h3>
              <p className="text-sm text-muted-foreground max-w-sm">
                When you find an interesting story, bookmark it to read later.
                Your bookmarks will appear here.
              </p>
            </div>
            <Link to="/feed">
              <Button variant="outline" className="mt-2">
                Browse the feed
              </Button>
            </Link>
          </div>
        ) : (
          <div className="grid gap-6">
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
  );
}
