import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "convex/react";
import { api } from "@news-app/backend/convex/_generated/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import ArticlesList from "@/components/feed/articles-list";
import BookmarkButton from "@/components/bookmark-button";
import { SITE } from "@/lib/seo";

export const Route = createFileRoute("/event/$slug")({
  loader: async ({ context, params }) => {
    // Fetch event data server-side so head() can set dynamic meta tags for SEO.
    // serverHttpClient is only available during SSR — returns null on client nav.
    const httpClient = context.convexQueryClient.serverHttpClient;
    if (!httpClient) return null;
    try {
      return await httpClient.query(api.events.getEventBySlug, {
        slug: params.slug,
      });
    } catch (error) {
      console.error(
        `[SSR] Failed to load event (slug: ${params.slug}):`,
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
    const imageUrl = loaderData?.event?.imageUrl;

    return {
      meta: [
        { title },
        { name: "description", content: description },
        { property: "og:title", content: title },
        { property: "og:description", content: description },
        { property: "og:type", content: "article" },
        { property: "og:url", content: `${SITE.url}/event/${params.slug}` },
        { name: "twitter:title", content: title },
        { name: "twitter:description", content: description },
        ...(imageUrl
          ? [
              { property: "og:image", content: imageUrl },
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
  const { slug } = Route.useParams();
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
          <Link to="/feed">
            <Button>Back to feed</Button>
          </Link>
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

  return (
    <div className="bg-gradient-to-b from-background via-background to-muted/35">
      <div className="container mx-auto max-w-4xl px-4 py-8 sm:py-10">
        <div className="flex flex-col gap-8">
        <Link
          to="/feed"
          className="inline-flex items-center text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          &larr; Back to feed
        </Link>

          <section className="overflow-hidden rounded-[1.6rem] border border-border/80 bg-card/95 shadow-sm">
            <div className="aspect-[16/10] overflow-hidden border-b border-border/70 bg-muted/40 sm:aspect-[16/9]">
              {event.imageUrl ? (
                <img
                  src={event.imageUrl}
                  alt={event.imageAlt ?? event.title}
                  className="h-full w-full object-cover"
                />
              ) : (
                <div className="flex h-full items-center justify-center bg-gradient-to-br from-muted to-background">
                  <span className="rounded-full border border-border/80 bg-background/85 px-3 py-1 text-xs font-medium text-muted-foreground">
                    Event
                  </span>
                </div>
              )}
            </div>

            <div className="space-y-6 px-6 py-6 sm:px-8 sm:py-8">
              <div className="flex items-start justify-between gap-4">
                <div className="space-y-3">
                  <p className="text-xs font-semibold uppercase tracking-[0.24em] text-muted-foreground">
                    Event Overview
                  </p>
                  <h1 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl text-balance">
                    {event.title}
                  </h1>
                </div>
                <BookmarkButton
                  eventId={event._id}
                  className="rounded-full border border-border/80 bg-background/80"
                />
              </div>

              <div className="flex flex-wrap items-center gap-3 border-t border-border/70 pt-4">
                <div className="flex -space-x-3">
                  {articles
                    .map((article) => article.source)
                    .filter((source, index, array) =>
                      source &&
                      array.findIndex((candidate) => candidate?._id === source._id) === index,
                    )
                    .slice(0, 5)
                    .map((source) => (
                      <div
                        key={source!._id}
                        className="flex h-11 w-11 items-center justify-center overflow-hidden rounded-full border-2 border-background bg-background shadow-sm"
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
                <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
                  <span className="font-medium text-card-foreground">
                    {articles.length} {articles.length === 1 ? "article" : "articles"}
                  </span>
                  <span>•</span>
                  <span>{sourceCount} sources</span>
                </div>
              </div>
            </div>
          </section>

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
                    {event.perspectiveSummaries?.center ?? "Summary pending..."}
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
                <CardTitle className="text-xl tracking-tight">Summary</CardTitle>
              </CardHeader>
              <CardContent className="px-6 py-6 sm:px-8">
                <p className="max-w-[65ch] text-sm text-card-foreground sm:text-base">
                  {event.perspectiveSummaries?.center ??
                    event.globalImpact ??
                    "Coverage grouped from multiple sources. Compare the original reporting below."}
                </p>
              </CardContent>
            </Card>
          )}

          {event.globalImpact && (
            <Card className="overflow-hidden border-border/80 py-0">
              <CardHeader className="border-b border-border/70 bg-muted/30 py-5">
                <CardTitle className="text-xl tracking-tight">What This Means</CardTitle>
              </CardHeader>
              <CardContent className="px-6 py-6 sm:px-8">
                <p className="max-w-[65ch] text-sm text-card-foreground sm:text-base">
                  {event.globalImpact}
                </p>
              </CardContent>
            </Card>
          )}

          <ArticlesList articles={articles} />
        </div>
      </div>
    </div>
  );
}
