import { useMemo } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { api } from "@news-app/backend/convex/_generated/api";
import { useConvexAuth, useQuery } from "convex/react";
import { SignInPrompt } from "@/components/SignInPrompt";
import EventCard from "@/components/feed/event-card";
import { Button } from "@/components/ui/button";
import { PageLoadingState } from "@/components/ui/page-loading-state";
import { SectionTitle } from "@/components/ui/section-title";
import { getLocaleFromMatches } from "@/lib/i18n/getLocaleFromMatches";
import { useT } from "@/lib/i18n/LocaleContext";
import { getString } from "@/lib/i18n/strings";

export const Route = createFileRoute("/salvate")({
  head: ({ matches }) => {
    const locale = getLocaleFromMatches(matches);

    return {
      meta: [
        { title: getString(locale, "saved.metaTitle") },
        { name: "robots", content: "noindex, nofollow" },
      ],
    };
  },
  component: SalvatePage,
});

function SalvatePage() {
  const t = useT();
  const { isAuthenticated, isLoading } = useConvexAuth();
  const currentUser = useQuery(
    api.user.getCurrentUser,
    isAuthenticated ? {} : "skip",
  );

  if (isLoading || (isAuthenticated && currentUser === undefined)) {
    return (
      <PageLoadingState
        title={t("saved.checking.title")}
        description={t("saved.checking.body")}
        cardCount={2}
      />
    );
  }

  if (!currentUser) {
    return (
      <SignInPrompt
        title={t("saved.empty.title")}
        description={t("saved.empty.body")}
        redirectTo="/salvate"
      />
    );
  }

  return (
    <SalvateContent />
  );
}

function SalvateContent() {
  const t = useT();
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
      <PageLoadingState
        title={t("saved.loading.title")}
        description={t("saved.loading.body")}
        cardCount={3}
      />
    );
  }

  return (
    <div className="bg-background">
      <div className="container mx-auto max-w-4xl px-4 py-8 sm:py-10">
        <div className="flex flex-col gap-8">
          <header className="flex flex-col gap-3 border-b border-border pb-6">
            <SectionTitle as="p">
              {t("saved.section")}
            </SectionTitle>
            <h1 className="text-3xl font-semibold tracking-tight text-foreground">
              {t("saved.heading")}
            </h1>
            <p className="max-w-[55ch] text-sm text-muted-foreground">
              {bookmarks.length === 0
                ? t("saved.summary.empty")
                : bookmarks.length === 1
                  ? t("saved.summary.one")
                  : t("saved.summary.many").replace(
                      "{count}",
                      String(bookmarks.length),
                    )}
            </p>
          </header>

          {bookmarks.length === 0 ? (
            /* Typographic empty state: one line + one action (native
               DESIGN_LOG — dashed boxes and icon circles deleted). */
            <div className="flex flex-col items-start gap-4 py-4">
              <div>
                <h2 className="mb-1 text-lg font-semibold">
                  {t("saved.none")}
                </h2>
                <p className="max-w-sm text-sm text-muted-foreground">
                  {t("saved.noneBody")}
                </p>
              </div>
              <Button asChild variant="outline">
                <Link to="/">{t("saved.browseFeed")}</Link>
              </Button>
            </div>
          ) : (
            /* Same row anatomy as the feed — recognition over novelty. */
            <div className="flex flex-col divide-y divide-border">
              {bookmarks.map((event) => (
                <div key={event._id} className="py-5">
                  <EventCard
                    event={event}
                    topicNamesById={topicNamesById}
                    showBookmark
                  />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
