import { useMemo } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { api } from "@news-app/backend/convex/_generated/api";
import { useConvexAuth, useQuery } from "convex/react";
import { SignInPrompt } from "@/components/SignInPrompt";
import EventCard from "@/components/feed/event-card";
import { Button } from "@/components/ui/button";
import { PageLoadingState } from "@/components/ui/page-loading-state";
import { getLocaleFromMatches } from "@/lib/i18n/getLocaleFromMatches";
import { useT } from "@/lib/i18n/LocaleContext";
import { getString } from "@/lib/i18n/strings";

function safePositiveInt(raw: unknown, fallback: number): number {
  const n = Number(raw);
  return Number.isFinite(n) ? Math.max(1, Math.floor(n)) : fallback;
}

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
        illustration={
          <div className="flex size-16 items-center justify-center rounded-full bg-primary/10 text-primary">
            <svg
              className="size-8"
              aria-hidden="true"
              focusable="false"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={1.5}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M17.593 3.322c1.1.128 1.907 1.077 1.907 2.185V21L12 17.25 4.5 21V5.507c0-1.108.806-2.057 1.907-2.185a48.507 48.507 0 0111.186 0z"
              />
            </svg>
          </div>
        }
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
  const runtimeConfig = useQuery(api.config.getPublicRuntimeConfig);
  const maxSources = safePositiveInt(runtimeConfig?.eventCardMaxSources, 5);

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
    <div className="bg-gradient-to-b from-background via-background to-muted/35">
      <div className="container mx-auto max-w-4xl px-4 py-8 sm:py-10">
        <div className="flex flex-col gap-8">
          <header className="overflow-hidden rounded-[1.6rem] border border-border/70 bg-card/80 shadow-sm">
            <div className="bg-gradient-to-br from-background via-card to-muted/50 px-6 py-8 sm:px-8 sm:py-10">
              <div className="flex flex-col gap-4">
                <p className="text-xs font-semibold uppercase tracking-[0.24em] text-muted-foreground">
                  {t("saved.section")}
                </p>
                <div className="flex max-w-[65ch] flex-col gap-3">
                  <h1 className="text-4xl font-bold tracking-tight text-foreground sm:text-5xl">
                    {t("saved.heading")}
                  </h1>
                  <p className="max-w-[55ch] text-sm text-muted-foreground sm:text-base">
                    {bookmarks.length === 0
                      ? t("saved.summary.empty")
                      : bookmarks.length === 1
                        ? t("saved.summary.one")
                        : t("saved.summary.many").replace(
                            "{count}",
                            String(bookmarks.length),
                          )}
                  </p>
                </div>
              </div>
            </div>
          </header>

          {bookmarks.length === 0 ? (
            <div className="rounded-[1.6rem] border border-border/70 bg-card/80 p-8 sm:p-12">
              <div className="flex flex-col items-center justify-center gap-6 text-center">
                <div className="flex size-16 items-center justify-center rounded-full bg-muted">
                  <svg
                    className="size-8 text-muted-foreground"
                    aria-hidden="true"
                    focusable="false"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={1.5}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M12 7.5h1.5m-1.5 3h1.5m-7.5 3h7.5m-7.5 3h7.5m3-9h3.375c.621 0 1.125.504 1.125 1.125V18a2.25 2.25 0 01-2.25 2.25M16.5 7.5V18a2.25 2.25 0 002.25 2.25M16.5 7.5V4.875c0-.621-.504-1.125-1.125-1.125H4.125C3.504 3.75 3 4.254 3 4.875V18a2.25 2.25 0 002.25 2.25h13.5M6 7.5h3v3H6v-3z"
                    />
                  </svg>
                </div>
                <div>
                  <h2 className="mb-2 text-lg font-semibold">{t("saved.none")}</h2>
                  <p className="max-w-sm text-sm text-muted-foreground">
                    {t("saved.noneBody")}
                  </p>
                </div>
                <Button asChild variant="outline" className="rounded-full">
                  <Link to="/feed">{t("saved.browseFeed")}</Link>
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
