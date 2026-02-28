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
import { Bookmark } from "lucide-react";

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
        <div className="container mx-auto max-w-4xl px-4 py-16 text-center">
          <Bookmark className="mx-auto mb-4 size-10 text-muted-foreground" />
          <h1 className="text-2xl font-semibold mb-2">
            Sign in to see your bookmarks
          </h1>
          <p className="text-sm text-muted-foreground mb-6">
            Bookmark events to read later from any device.
          </p>
          <Link to="/dashboard">
            <Button>Sign in</Button>
          </Link>
        </div>
      </Unauthenticated>
      <AuthLoading>
        <div className="container mx-auto max-w-4xl px-4 py-8">
          <div className="animate-pulse text-muted-foreground text-sm">
            Loading…
          </div>
        </div>
      </AuthLoading>
    </>
  );
}

function BookmarksContent() {
  const bookmarks = useQuery(api.interactions.getBookmarkedEvents);
  const topics = useQuery(api.topics.getTopics);

  const topicNamesById = useMemo(() => {
    const map: Record<string, string> = {};
    topics?.forEach((topic) => {
      map[topic._id] = topic.displayName;
    });
    return map;
  }, [topics]);

  if (bookmarks === undefined) {
    return (
      <div className="container mx-auto max-w-4xl px-4 py-8">
        <div className="animate-pulse text-muted-foreground text-sm">
          Loading bookmarks…
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto max-w-4xl px-4 py-8">
      <div className="flex flex-col gap-6">
        <header className="flex flex-col gap-2">
          <h1 className="text-2xl font-semibold">Bookmarks</h1>
          <p className="text-sm text-muted-foreground">
            Events you saved for later.
          </p>
        </header>

        {bookmarks.length === 0 ? (
          <div className="py-12 text-center">
            <Bookmark className="mx-auto mb-4 size-10 text-muted-foreground" />
            <p className="text-muted-foreground mb-4">No bookmarks yet</p>
            <Link to="/feed">
              <Button variant="outline">Browse the feed</Button>
            </Link>
          </div>
        ) : (
          <div className="grid gap-4">
            {bookmarks.map((event) => (
              <EventCard
                key={event._id}
                event={event}
                topicNamesById={topicNamesById}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
