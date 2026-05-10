import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useConvexAuth, useQuery } from "convex/react";
import { api } from "@news-app/backend/convex/_generated/api";
import { useConvexMutation } from "@convex-dev/react-query";
import { z } from "zod";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import ArticlesList from "@/components/feed/articles-list";
import EventClaimComparison from "@/components/feed/event-claim-comparison";
import SourceCoverageSummary from "@/components/feed/source-coverage-summary";
import BookmarkButton from "@/components/bookmark-button";
import ShareEventButton from "@/components/share-event-button";
import {
  buildInteractionContextFromSources,
  getClientDeviceType,
  getScrollDepthPercentage,
} from "@/lib/interaction-tracking";
import { formatAbsoluteTimestamp, formatRelativeTimestamp } from "@/lib/dates";
import { useLocale, useT } from "@/lib/i18n/LocaleContext";
import { getString } from "@/lib/i18n/strings";
import { SITE } from "@/lib/seo";

const searchSchema = z.object({
  returnToFeed: z.string().optional(),
});

export const Route = createFileRoute("/event/$slug")({
  validateSearch: searchSchema,
  loader: async ({ context, params }) => {
    const httpClient = context.convexQueryClient.serverHttpClient;
    try {
      if (httpClient) {
        return await httpClient.query(api.events.getEventBySlug, {
          slug: params.slug,
        });
      }

      return await context.convexClient.query(api.events.getEventBySlug, {
        slug: params.slug,
      });
    } catch (error) {
      console.error(
        `[Route loader] Failed to load event (slug: ${params.slug}):`,
        error,
      );
      return null;
    }
  },
  head: ({ loaderData, params, matches }) => {
    const locale =
      matches[0]?.context &&
      typeof matches[0].context === "object" &&
      "locale" in matches[0].context &&
      (matches[0].context.locale === "ro" || matches[0].context.locale === "en")
        ? matches[0].context.locale
        : "en";
    const title = loaderData?.event?.title
      ? `${loaderData.event.title} — ${SITE.name}`
      : getString(locale, "event.metaTitle");
    const description =
      loaderData?.event?.perspectiveSummaries?.center?.slice(0, 155) ??
      loaderData?.event?.globalImpact?.slice(0, 155) ??
      getString(locale, "event.metaDescription");
    const imageUrl =
      loaderData?.event?.shareImageUrl ?? loaderData?.event?.imageUrl;

    return {
      meta: [
        { title },
        { name: "description", content: description },
        { property: "og:title", content: title },
        { property: "og:site_name", content: SITE.name },
        { property: "og:description", content: description },
        { property: "og:type", content: "article" },
        { property: "og:url", content: `${SITE.url}/event/${params.slug}` },
        ...(loaderData?.event?.firstPublishedAt
          ? [
              {
                property: "article:published_time",
                content: new Date(
                  loaderData.event.firstPublishedAt,
                ).toISOString(),
              },
            ]
          : []),
        ...(loaderData?.event?.lastUpdatedAt
          ? [
              {
                property: "article:modified_time",
                content: new Date(loaderData.event.lastUpdatedAt).toISOString(),
              },
            ]
          : []),
        { name: "twitter:card", content: "summary_large_image" },
        { name: "twitter:title", content: title },
        { name: "twitter:description", content: description },
        ...(imageUrl
          ? [
              { property: "og:image", content: imageUrl },
              ...(loaderData?.event?.shareImageWidth
                ? [
                    {
                      property: "og:image:width",
                      content: String(loaderData.event.shareImageWidth),
                    },
                  ]
                : []),
              ...(loaderData?.event?.shareImageHeight
                ? [
                    {
                      property: "og:image:height",
                      content: String(loaderData.event.shareImageHeight),
                    },
                  ]
                : []),
              {
                property: "og:image:alt",
                content: loaderData?.event?.imageAlt ?? title,
              },
              { name: "twitter:image", content: imageUrl },
            ]
          : []),
      ],
      links: [{ rel: "canonical", href: `${SITE.url}/event/${params.slug}` }],
    };
  },
  component: EventDetailPage,
});

function EventDetailPage() {
  const locale = useLocale();
  const t = useT();
  const { slug } = Route.useParams();
  const loaderData = Route.useLoaderData();
  const search = Route.useSearch();
  const eventData = useQuery(api.events.getEventBySlug, { slug }) ?? loaderData;
  const { isAuthenticated } = useConvexAuth();
  const logInteractionFn = useConvexMutation(api.interactions.logInteraction);
  const navigate = useNavigate();
  const returnToFeed = search.returnToFeed === "1";

  const handleBackToFeed = () => {
    if (returnToFeed && window.history.length > 1) {
      window.history.back();
      return;
    }

    void navigate({ to: "/feed" });
  };

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
  }, [slug]);

  useEffect(() => {
    if (!isAuthenticated || !eventData?.event?._id) return;

    const startedAt = Date.now();
    let maxScrollDepth = getScrollDepthPercentage();
    const interactionContext = buildInteractionContextFromSources(
      eventData.articles.map((article) => article.source),
    );

    const handleScroll = () => {
      maxScrollDepth = Math.max(maxScrollDepth, getScrollDepthPercentage());
    };

    window.addEventListener("scroll", handleScroll, { passive: true });

    return () => {
      window.removeEventListener("scroll", handleScroll);
      void logInteractionFn({
        eventId: eventData.event._id,
        type: "view",
        context: interactionContext,
        metadata: {
          deviceType: getClientDeviceType(),
          scrollDepthPercentage: Math.max(
            maxScrollDepth,
            getScrollDepthPercentage(),
          ),
          timeSpentSeconds: Math.max(
            1,
            Math.round((Date.now() - startedAt) / 1000),
          ),
        },
      }).catch((error) => {
        console.debug("Skipping event view interaction log:", error);
      });
    };
  }, [eventData?.event?._id, isAuthenticated, logInteractionFn]);

  if (eventData === undefined) {
    return (
      <div className="container mx-auto max-w-4xl px-4 py-8">
        <div
          role="status"
          aria-live="polite"
          aria-atomic="true"
          className="text-sm text-muted-foreground"
        >
          {t("event.loading")}
        </div>
      </div>
    );
  }

  if (eventData === null) {
    return (
      <div className="container mx-auto max-w-4xl px-4 py-8">
        <div className="text-center">
          <h1 className="mb-2 text-2xl font-semibold">{t("event.notFound")}</h1>
          <p className="mb-4 text-muted-foreground">
            {t("event.notFoundBody")}
          </p>
          <Button asChild>
            <Link to="/feed">{t("event.backToFeed")}</Link>
          </Button>
        </div>
      </div>
    );
  }

  const { event, articles } = eventData;
  const hasPerspectives =
    event.perspectiveSummaries?.left || event.perspectiveSummaries?.right;
  const sourceCount = new Set(
    articles.map((article) => article.source?._id).filter(Boolean),
  ).size;
  const tabCount = [
    event.perspectiveSummaries?.left ? "left" : null,
    "center",
    event.perspectiveSummaries?.right ? "right" : null,
  ].filter(Boolean).length;
  const lastUpdatedAt = event.lastUpdatedAt ?? event.firstPublishedAt;
  const interactionContext = buildInteractionContextFromSources(
    articles.map((article) => article.source),
  );

  return (
    <div className="bg-linear-to-b from-background via-background to-muted/35">
      <div className="container mx-auto max-w-4xl px-3 py-4 sm:px-4 sm:py-10">
        <div className="flex flex-col gap-5 sm:gap-8">
          <button
            type="button"
            onClick={handleBackToFeed}
            className="inline-flex items-center text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            &larr; {t("event.backToFeed")}
          </button>

          <section className="overflow-hidden rounded-[1.15rem] border border-border/80 bg-card/95 shadow-sm sm:rounded-[1.6rem]">
            <div className="aspect-[16/9] overflow-hidden border-b border-border/70 bg-muted/40">
              {event.imageUrl ? (
                <img
                  src={event.imageUrl}
                  alt={event.imageAlt ?? event.title}
                  className="h-full w-full object-cover"
                />
              ) : (
                <div className="flex h-full items-center justify-center bg-linear-to-br from-muted to-background">
                  <span className="rounded-full border border-border/80 bg-background/85 px-3 py-1 text-xs font-medium text-muted-foreground">
                    {t("event.cardLabel")}
                  </span>
                </div>
              )}
            </div>

            <div className="space-y-5 px-4 py-5 sm:space-y-6 sm:px-8 sm:py-8">
              <div className="space-y-4">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-xs font-semibold uppercase tracking-[0.24em] text-muted-foreground">
                    {t("event.overview")}
                  </p>
                  <div className="flex items-center gap-2">
                    <BookmarkButton
                      eventId={event._id}
                      interactionContext={interactionContext}
                      redirectTo={`/event/${event.slug}`}
                      className="rounded-full border border-border/80 bg-background/80"
                    />
                    <ShareEventButton
                      eventId={event._id}
                      interactionContext={interactionContext}
                      slug={event.slug}
                      title={event.title}
                      summary={
                        event.perspectiveSummaries?.center ?? event.globalImpact
                      }
                      className="rounded-full border border-border/80 bg-background/80"
                    />
                  </div>
                </div>
                <h1 className="max-w-3xl text-2xl font-bold leading-[1.12] tracking-tight text-foreground text-balance sm:text-4xl sm:leading-tight">
                  {event.title}
                </h1>
              </div>

              <div className="grid gap-3 border-t border-border/70 pt-4 sm:flex sm:flex-wrap sm:items-center">
                <div
                  className="w-fit rounded-full border border-border/80 bg-background/70 px-3 py-1.5 text-xs font-medium text-muted-foreground"
                  title={formatAbsoluteTimestamp(lastUpdatedAt, locale)}
                >
                  {t("event.updated").replace(
                    "{time}",
                    formatRelativeTimestamp(lastUpdatedAt, locale),
                  )}
                </div>
                <div className="flex items-center justify-between gap-3 rounded-2xl border border-border/70 bg-background/45 px-3 py-3 sm:border-0 sm:bg-transparent sm:p-0">
                  <div className="flex -space-x-3">
                    {articles
                      .map((article) => article.source)
                      .filter(
                        (source, index, array) =>
                          source &&
                          array.findIndex(
                            (candidate) => candidate?._id === source._id,
                          ) === index,
                      )
                      .slice(0, 5)
                      .map((source) => (
                        <div
                          key={source!._id}
                          className="flex h-9 w-9 items-center justify-center overflow-hidden rounded-full border-2 border-background bg-background shadow-sm sm:h-11 sm:w-11"
                          title={source!.name}
                        >
                          {source?.logoUrl ? (
                            <img
                              src={source.logoUrl}
                              alt={source.name}
                              className="h-full w-full object-contain p-1.5"
                            />
                          ) : (
                            <span className="text-xs font-medium text-foreground">
                              {source?.name.charAt(0)}
                            </span>
                          )}
                        </div>
                      ))}
                  </div>
                  <div className="flex flex-wrap items-center justify-end gap-2 text-sm text-muted-foreground">
                    <span className="font-medium text-card-foreground">
                      {articles.length === 1
                        ? t("event.articles.one")
                        : t("event.articles.many").replace(
                            "{count}",
                            String(articles.length),
                          )}
                    </span>
                    <span>•</span>
                    <span>
                      {sourceCount === 1
                        ? t("event.sourceCount.one")
                        : t("event.sourceCount.many").replace(
                            "{count}",
                            String(sourceCount),
                          )}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </section>

          <Tabs defaultValue="perspectives" className="gap-5">
            <TabsList className="grid h-11 w-full grid-cols-2 rounded-full bg-muted/70 p-1">
              <TabsTrigger
                className="h-full rounded-full border-0 py-0 text-sm font-medium after:hidden data-[state=active]:border-transparent data-[state=active]:bg-background data-[state=active]:shadow-sm dark:data-[state=active]:border-transparent dark:data-[state=active]:bg-background/80"
                value="perspectives"
              >
                {t("event.perspectives")}
              </TabsTrigger>
              <TabsTrigger
                className="h-full rounded-full border-0 py-0 text-sm font-medium after:hidden data-[state=active]:border-transparent data-[state=active]:bg-background data-[state=active]:shadow-sm dark:data-[state=active]:border-transparent dark:data-[state=active]:bg-background/80"
                value="claims"
              >
                {t("event.claimBreakdown")}
              </TabsTrigger>
            </TabsList>

            <TabsContent
              value="perspectives"
              className="space-y-5 sm:space-y-8"
            >
              {hasPerspectives ? (
                <Card className="overflow-hidden border-border/80 py-0">
                  <CardHeader className="border-b border-border/70 bg-muted/30 pt-3 sm:pt-4">
                    <CardTitle className="text-xl tracking-tight">
                      {t("event.multiplePerspectives")}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="px-6 pb-4 sm:px-8 sm:pb-5">
                    <Tabs defaultValue="center" className="w-full gap-5">
                      <TabsList
                        className={`grid w-full ${({ 1: "grid-cols-1", 2: "grid-cols-2", 3: "grid-cols-3" } as Record<number, string>)[tabCount] ?? "grid-cols-3"}`}
                      >
                        {event.perspectiveSummaries?.left && (
                          <TabsTrigger value="left">
                            {t("event.left")}
                          </TabsTrigger>
                        )}
                        <TabsTrigger value="center">
                          {t("event.centerTab")}
                        </TabsTrigger>
                        {event.perspectiveSummaries?.right && (
                          <TabsTrigger value="right">
                            {t("event.right")}
                          </TabsTrigger>
                        )}
                      </TabsList>

                      {event.perspectiveSummaries?.left && (
                        <TabsContent value="left">
                          <p className="max-w-[65ch] text-sm text-card-foreground sm:text-base">
                            {event.perspectiveSummaries.left}
                          </p>
                        </TabsContent>
                      )}

                      <TabsContent value="center">
                        <p className="max-w-[65ch] text-sm text-card-foreground sm:text-base">
                          {event.perspectiveSummaries?.center ??
                            t("event.summaryPending")}
                        </p>
                      </TabsContent>

                      {event.perspectiveSummaries?.right && (
                        <TabsContent value="right">
                          <p className="max-w-[65ch] text-sm text-card-foreground sm:text-base">
                            {event.perspectiveSummaries.right}
                          </p>
                        </TabsContent>
                      )}
                    </Tabs>
                  </CardContent>
                </Card>
              ) : (
                <Card className="overflow-hidden border-border/80 py-0">
                  <CardHeader className="border-b border-border/70 bg-muted/30 py-3 sm:py-4">
                    <CardTitle className="text-xl tracking-tight">
                      {t("event.summary")}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="px-6 pt-3 pb-4 sm:px-8 sm:pt-4 sm:pb-5">
                    <p className="max-w-[65ch] text-sm text-card-foreground sm:text-base">
                      {event.perspectiveSummaries?.center ??
                        t("event.compareOriginal")}
                    </p>
                  </CardContent>
                </Card>
              )}

              {event.globalImpact && (
                <Card className="overflow-hidden border-border/80 py-0">
                  <CardHeader className="border-b border-border/70 bg-muted/30 pt-3 sm:pt-4">
                    <CardTitle className="text-xl tracking-tight">
                      {t("event.meaning")}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="px-6 pb-4 sm:px-8 sm:pb-5">
                    <p className="max-w-[65ch] text-sm text-card-foreground sm:text-base">
                      {event.globalImpact}
                    </p>
                  </CardContent>
                </Card>
              )}

              <SourceCoverageSummary articles={articles} />
            </TabsContent>

            <TabsContent value="claims">
              <EventClaimComparison eventId={event._id} articles={articles} />
            </TabsContent>
          </Tabs>

          <ArticlesList eventId={event._id} articles={articles} />
        </div>
      </div>
    </div>
  );
}
