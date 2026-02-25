import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "convex/react";
import { api } from "@news-app/backend/convex/_generated/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import ArticlesList from "@/components/feed/articles-list";
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
        <div className="text-sm text-muted-foreground">Loading...</div>
      </div>
    );
  }

  if (eventData === null) {
    return (
      <div className="container mx-auto max-w-4xl px-4 py-8">
        <div className="text-center">
          <h1 className="text-2xl font-semibold mb-2">Event not found</h1>
          <p className="text-muted-foreground mb-4">
            The event you're looking for doesn't exist.
          </p>
          <Link to="/">
            <Button>Back to feed</Button>
          </Link>
        </div>
      </div>
    );
  }

  const { event, articles } = eventData;
  const hasPerspectives =
    event.perspectiveSummaries.left || event.perspectiveSummaries.right;

  return (
    <div className="container mx-auto max-w-4xl px-4 py-8">
      <div className="flex flex-col gap-6">
        {/* Back button */}
        <Link
          to="/"
          className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground"
        >
          ← Back to feed
        </Link>

        {/* Event header */}
        <div>
          <h1 className="text-3xl font-bold mb-4">{event.title}</h1>
          {event.imageUrl && (
            <div className="overflow-hidden rounded-lg border mb-4">
              <img
                src={event.imageUrl}
                alt={event.title}
                className="w-full h-64 object-cover"
              />
            </div>
          )}
        </div>

        {/* Perspective summaries */}
        {hasPerspectives ? (
          <Card>
            <CardHeader>
              <CardTitle>Multiple Perspectives</CardTitle>
            </CardHeader>
            <CardContent>
              <Tabs defaultValue="center" className="w-full">
                <TabsList className="grid w-full grid-cols-3">
                  {event.perspectiveSummaries.left && (
                    <TabsTrigger value="left">Left</TabsTrigger>
                  )}
                  <TabsTrigger value="center">Center</TabsTrigger>
                  {event.perspectiveSummaries.right && (
                    <TabsTrigger value="right">Right</TabsTrigger>
                  )}
                </TabsList>

                {event.perspectiveSummaries.left && (
                  <TabsContent value="left" className="mt-4">
                    <p className="text-sm leading-relaxed max-w-[65ch]">
                      {event.perspectiveSummaries.left}
                    </p>
                  </TabsContent>
                )}

                <TabsContent value="center" className="mt-4">
                  <p className="text-sm leading-relaxed max-w-[65ch]">
                    {event.perspectiveSummaries.center}
                  </p>
                </TabsContent>

                {event.perspectiveSummaries.right && (
                  <TabsContent value="right" className="mt-4">
                    <p className="text-sm leading-relaxed max-w-[65ch]">
                      {event.perspectiveSummaries.right}
                    </p>
                  </TabsContent>
                )}
              </Tabs>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardHeader>
              <CardTitle>Summary</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm leading-relaxed max-w-[65ch]">
                {event.perspectiveSummaries.center}
              </p>
            </CardContent>
          </Card>
        )}

        {/* Global Impact */}
        {event.globalImpact && (
          <Card>
            <CardHeader>
              <CardTitle>What This Means</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm leading-relaxed max-w-[65ch]">
                {event.globalImpact}
              </p>
            </CardContent>
          </Card>
        )}

        {/* Articles */}
        <ArticlesList articles={articles} />
      </div>
    </div>
  );
}
