import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect } from "react";
import { useQuery } from "convex/react";
import { api } from "@news-app/backend/convex/_generated/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import ArticlesList from "@/components/feed/articles-list";
import EventClaimComparison from "@/components/feed/event-claim-comparison";
import SourceCoverageSummary from "@/components/feed/source-coverage-summary";
import BookmarkButton from "@/components/bookmark-button";
import ShareEventButton from "@/components/share-event-button";
import { formatAbsoluteTimestamp, formatRelativeTimestamp } from "@/lib/dates";
import { SITE } from "@/lib/seo";
import { consumeBetaWelcomeToast } from "@/lib/beta-welcome";

export const Route = createFileRoute("/event/$slug")({
  loader: async ({ context, params }) => {
    // Fetch event data for both SSR and client transitions so head() stays dynamic.
    const httpClient = context.convexQueryClient.serverHttpClient;
    try {
      if (httpClient) {
        return await httpClient.query(api.events.getEventBySlugPreview, {
          slug: params.slug,
        });
      }

      return await context.convexClient.query(
        api.events.getEventBySlugPreview,
        {
          slug: params.slug,
        },
      );
    } catch (error) {
      console.error(
        `[Route loader] Failed to load event (slug: ${params.slug}):`,
        error,
      );
      return null;
    }
  },
  head: ({ loaderData, params }) => {
    const title = loaderData?.event?.title
      ? `${loaderData.event.title} — ${SITE.name}`
      : `Event — ${SITE.name}`;
    const description =
      loaderData?.event?.perspectiveSummaries?.center?.slice(0, 155) ??
      "Read this story from multiple perspectives on Biviant.";
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
  const access = useQuery(api.user.getCurrentUserAccess);
  const { slug } = Route.useParams();

  useEffect(() => {
    if (access?.hasBetaAccess) {
      consumeBetaWelcomeToast();
    }
  }, [access?.hasBetaAccess]);

  if (access === undefined) {
    return (
      <div className="container mx-auto max-w-4xl px-4 py-8">
        <div
          role="status"
          aria-live="polite"
          aria-atomic="true"
          className="text-sm text-muted-foreground"
        >
          Loading...
        </div>
      </div>
    );
  }

  if (!access.hasBetaAccess) {
    return <PublicEventDetailPage slug={slug} />;
  }

  return <AuthorizedEventDetailPage slug={slug} />;
}

function PublicEventDetailPage({ slug }: { slug: string }) {
  const loaderData = Route.useLoaderData();
  const queryData = useQuery(api.events.getEventBySlugPreview, { slug });
  const eventData = queryData ?? loaderData;

  if (eventData === undefined) {
    return (
      <div className="container mx-auto max-w-4xl px-4 py-8">
        <div
          role="status"
          aria-live="polite"
          aria-atomic="true"
          className="text-sm text-muted-foreground"
        >
          Loading...
        </div>
      </div>
    );
  }

  if (eventData === null) {
    return (
      <div className="container mx-auto max-w-4xl px-4 py-8">
        <div className="text-center">
          <h1 className="mb-2 text-2xl font-semibold">Event not found</h1>
          <p className="mb-4 text-muted-foreground">
            The event you&apos;re looking for doesn&apos;t exist.
          </p>
          <Button asChild>
            <Link to="/">Back to homepage</Link>
          </Button>
        </div>
      </div>
    );
  }

  const { event } = eventData;
  const lastUpdatedAt = event.lastUpdatedAt ?? event.firstPublishedAt;
  const topicLabels = (event.topics ?? []).slice(0, 3);

  return (
    <div className="bg-linear-to-b from-background via-background to-muted/35">
      <div className="container mx-auto max-w-4xl px-3 py-4 sm:px-4 sm:py-10">
        <div className="flex flex-col gap-5 sm:gap-8">
          <Link
            to="/"
            className="inline-flex items-center text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            &larr; Back to homepage
          </Link>

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
                    Event
                  </span>
                </div>
              )}
            </div>

            <div className="space-y-5 px-4 py-5 sm:space-y-6 sm:px-8 sm:py-8">
              <div className="space-y-4">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-xs font-semibold uppercase tracking-[0.24em] text-muted-foreground">
                    Public Preview
                  </p>
                  <ShareEventButton
                    slug={event.slug}
                    title={event.title}
                    summary={
                      event.perspectiveSummaries?.center ?? event.globalImpact
                    }
                    className="rounded-full border border-border/80 bg-background/80"
                  />
                </div>
                <h1 className="max-w-3xl text-2xl font-bold leading-[1.12] tracking-tight text-foreground text-balance sm:text-4xl sm:leading-tight">
                  {event.title}
                </h1>
              </div>

              <div className="grid gap-3 border-t border-border/70 pt-4 sm:flex sm:flex-wrap sm:items-center">
                <div
                  className="w-fit rounded-full border border-border/80 bg-background/70 px-3 py-1.5 text-xs font-medium text-muted-foreground"
                  title={formatAbsoluteTimestamp(lastUpdatedAt)}
                >
                  Updated {formatRelativeTimestamp(lastUpdatedAt)}
                </div>
                <div className="flex items-center justify-between gap-3 rounded-2xl border border-border/70 bg-background/45 px-3 py-3 sm:border-0 sm:bg-transparent sm:p-0">
                  <div className="flex -space-x-3">
                    {event.sources?.slice(0, 5).map((source) => (
                      <div
                        key={source._id}
                        className="flex h-9 w-9 items-center justify-center overflow-hidden rounded-full border-2 border-background bg-background shadow-sm sm:h-11 sm:w-11"
                        title={source.name}
                      >
                        {source.logoUrl ? (
                          <img
                            src={source.logoUrl}
                            alt={source.name}
                            className="h-full w-full object-contain p-1.5"
                          />
                        ) : (
                          <span className="text-xs font-medium text-foreground">
                            {source.name.charAt(0)}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                  <div className="flex flex-wrap items-center justify-end gap-2 text-sm text-muted-foreground">
                    <span className="font-medium text-card-foreground">
                      {event.articleCount}{" "}
                      {event.articleCount === 1 ? "article" : "articles"}
                    </span>
                    <span>•</span>
                    <span>{event.sources?.length ?? 0} sources</span>
                  </div>
                </div>
              </div>

              {topicLabels.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {topicLabels.map((topic) => (
                    <span
                      key={topic._id}
                      className="inline-flex h-7 items-center rounded-full border border-border/80 bg-background/70 px-3 text-xs"
                    >
                      {topic.displayName}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </section>

          <Card className="overflow-hidden border-border/80 py-0">
            <CardHeader className="border-b border-border/70 bg-muted/30 py-5">
              <CardTitle className="text-xl tracking-tight">
                Event Summary
              </CardTitle>
            </CardHeader>
            <CardContent className="px-6 py-6 sm:px-8">
              <p className="max-w-[65ch] text-sm text-card-foreground sm:text-base">
                {event.perspectiveSummaries?.center ??
                  "Coverage grouped from multiple sources on Biviant."}
              </p>
            </CardContent>
          </Card>

          {event.globalImpact && (
            <Card className="overflow-hidden border-border/80 py-0">
              <CardHeader className="border-b border-border/70 bg-muted/30 py-5">
                <CardTitle className="text-xl tracking-tight">
                  Why It Matters
                </CardTitle>
              </CardHeader>
              <CardContent className="px-6 py-6 sm:px-8">
                <p className="max-w-[65ch] text-sm text-card-foreground sm:text-base">
                  {event.globalImpact}
                </p>
              </CardContent>
            </Card>
          )}

          <Card className="border-border/80 bg-card/95">
            <CardHeader>
              <CardTitle className="text-2xl tracking-tight">
                Unlock the full comparison
              </CardTitle>
              <p className="max-w-[60ch] text-sm text-muted-foreground">
                See the original reporting, compare perspectives side by side,
                and follow the full feed inside Biviant.
              </p>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-3">
              <Button asChild>
                <Link to="/dashboard" search={{ redirect: `/event/${slug}` }}>
                  Get beta access
                </Link>
              </Button>
              <Button asChild variant="ghost">
                <Link to="/">Learn more</Link>
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function AuthorizedEventDetailPage({ slug }: { slug: string }) {
  const eventData = useQuery(api.events.getEventBySlug, { slug });

  if (eventData === undefined) {
    return (
      <div className="container mx-auto max-w-4xl px-4 py-8">
        <div
          role="status"
          aria-live="polite"
          aria-atomic="true"
          className="text-sm text-muted-foreground"
        >
          Loading...
        </div>
      </div>
    );
  }

  if (eventData === null) {
    return (
      <div className="container mx-auto max-w-4xl px-4 py-8">
        <div className="text-center">
          <h1 className="text-2xl font-semibold mb-2">Event not found</h1>
          <p className="text-muted-foreground mb-4">
            The event you&apos;re looking for doesn&apos;t exist.
          </p>
          <Button asChild>
            <Link to="/feed">Back to feed</Link>
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

  return (
    <div className="bg-linear-to-b from-background via-background to-muted/35">
      <div className="container mx-auto max-w-4xl px-3 py-4 sm:px-4 sm:py-10">
        <div className="flex flex-col gap-5 sm:gap-8">
          <Link
            to="/feed"
            className="inline-flex items-center text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            &larr; Back to feed
          </Link>

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
                    Event
                  </span>
                </div>
              )}
            </div>

            <div className="space-y-5 px-4 py-5 sm:space-y-6 sm:px-8 sm:py-8">
              <div className="space-y-4">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-xs font-semibold uppercase tracking-[0.24em] text-muted-foreground">
                    Event Overview
                  </p>
                  <div className="flex items-center gap-2">
                  <BookmarkButton
                    eventId={event._id}
                    className="rounded-full border border-border/80 bg-background/80"
                  />
                  <ShareEventButton
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
                  title={formatAbsoluteTimestamp(lastUpdatedAt)}
                >
                  Updated {formatRelativeTimestamp(lastUpdatedAt)}
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
                      {articles.length}{" "}
                      {articles.length === 1 ? "article" : "articles"}
                    </span>
                    <span>•</span>
                    <span>{sourceCount} sources</span>
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
                Perspectives
              </TabsTrigger>
              <TabsTrigger
                className="h-full rounded-full border-0 py-0 text-sm font-medium after:hidden data-[state=active]:border-transparent data-[state=active]:bg-background data-[state=active]:shadow-sm dark:data-[state=active]:border-transparent dark:data-[state=active]:bg-background/80"
                value="claims"
              >
                Claim Breakdown
              </TabsTrigger>
            </TabsList>

            <TabsContent value="perspectives" className="space-y-5 sm:space-y-8">
              {hasPerspectives ? (
                <Card className="overflow-hidden border-border/80 py-0">
                  <CardHeader className="border-b border-border/70 bg-muted/30 py-5">
                    <CardTitle className="text-xl tracking-tight">
                      Multiple Perspectives
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="px-6 py-6 sm:px-8">
                    <Tabs defaultValue="center" className="w-full gap-5">
                      <TabsList
                        className={`grid w-full ${({ 1: "grid-cols-1", 2: "grid-cols-2", 3: "grid-cols-3" } as Record<number, string>)[tabCount] ?? "grid-cols-3"}`}
                      >
                        {event.perspectiveSummaries?.left && (
                          <TabsTrigger value="left">Left</TabsTrigger>
                        )}
                        <TabsTrigger value="center">Center</TabsTrigger>
                        {event.perspectiveSummaries?.right && (
                          <TabsTrigger value="right">Right</TabsTrigger>
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
                            "Summary pending…"}
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
                  <CardHeader className="border-b border-border/70 bg-muted/30 py-5">
                    <CardTitle className="text-xl tracking-tight">
                      Summary
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="px-6 py-6 sm:px-8">
                    <p className="max-w-[65ch] text-sm text-card-foreground sm:text-base">
                      {event.perspectiveSummaries?.center ??
                        "Coverage grouped from multiple sources. Compare the original reporting below."}
                    </p>
                  </CardContent>
                </Card>
              )}

              {event.globalImpact && (
                <Card className="overflow-hidden border-border/80 py-0">
                  <CardHeader className="border-b border-border/70 bg-muted/30 py-5">
                    <CardTitle className="text-xl tracking-tight">
                      What This Means
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="px-6 py-6 sm:px-8">
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

          <ArticlesList articles={articles} />
        </div>
      </div>
    </div>
  );
}
