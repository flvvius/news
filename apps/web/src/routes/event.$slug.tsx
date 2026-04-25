import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "convex/react";
import { api } from "@news-app/backend/convex/_generated/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import ArticlesList from "@/components/feed/articles-list";
import BookmarkButton from "@/components/bookmark-button";
import { SITE } from "@/lib/seo";
import {
  ArrowLeft,
  Globe,
  Loader2,
  MessageSquare,
  Newspaper,
} from "lucide-react";

export const Route = createFileRoute("/event/$slug")({
  loader: async ({ context, params }) => {
    const httpClient = context.convexQueryClient.serverHttpClient;
    if (!httpClient) return null;
    try {
      return await httpClient.query(api.events.getEventBySlug, {
        slug: params.slug,
      });
    } catch (error) {
      console.error(
        `[SSR] Failed to load event (slug: ${params.slug}):`,
        error
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
      <div className="min-h-[calc(100vh-4rem)] flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="size-8 text-primary animate-spin" />
          <p className="text-sm text-muted-foreground">Loading event...</p>
        </div>
      </div>
    );
  }

  if (eventData === null) {
    return (
      <div className="min-h-[calc(100vh-4rem)] flex items-center justify-center">
        <div className="flex flex-col items-center text-center gap-4 max-w-md px-4">
          <div className="flex items-center justify-center size-16 rounded-2xl bg-muted">
            <Newspaper className="size-8 text-muted-foreground" />
          </div>
          <h1 className="text-2xl font-bold">Event not found</h1>
          <p className="text-muted-foreground">
            The event you&apos;re looking for doesn&apos;t exist or has been
            removed.
          </p>
          <Link to="/feed">
            <Button className="mt-2">
              <ArrowLeft className="size-4 mr-2" />
              Back to feed
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  const { event, articles } = eventData;
  const hasPerspectives =
    event.perspectiveSummaries.left || event.perspectiveSummaries.right;

  return (
    <div className="min-h-[calc(100vh-4rem)]">
      {/* Hero Section */}
      <div className="relative">
        {/* Background image */}
        {event.imageUrl && (
          <div className="absolute inset-0 h-[300px] md:h-[400px]">
            <img
              src={event.imageUrl}
              alt=""
              className="w-full h-full object-cover"
            />
            <div className="absolute inset-0 bg-linear-to-b from-background/60 via-background/80 to-background" />
          </div>
        )}

        {/* Content overlay */}
        <div className="relative container mx-auto max-w-4xl px-4 pt-8 pb-12">
          {/* Back button */}
          <Link
            to="/feed"
            className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors mb-8 group"
          >
            <ArrowLeft className="size-4 transition-transform group-hover:-translate-x-1" />
            Back to feed
          </Link>

          {/* Event header */}
          <div className="flex flex-col gap-6">
            <div className="flex items-start justify-between gap-4">
              <h1 className="text-3xl md:text-4xl font-bold tracking-tight leading-tight max-w-3xl">
                {event.title}
              </h1>
              <BookmarkButton eventId={event._id} size="default" />
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="container mx-auto max-w-4xl px-4 pb-16">
        <div className="flex flex-col gap-8">
          {/* Perspective summaries */}
          {hasPerspectives ? (
            <Card className="overflow-hidden border-border">
              <CardHeader className="border-b border-border bg-muted/30">
                <div className="flex items-center gap-3">
                  <div className="flex items-center justify-center size-10 rounded-xl bg-primary/10 text-primary">
                    <MessageSquare className="size-5" />
                  </div>
                  <div>
                    <CardTitle>Multiple Perspectives</CardTitle>
                    <p className="text-sm text-muted-foreground mt-0.5">
                      See how different sources cover this story
                    </p>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                <Tabs defaultValue="center" className="w-full">
                  <div className="border-b border-border px-6">
                    <TabsList className="h-auto p-0 bg-transparent gap-0">
                      {event.perspectiveSummaries.left && (
                        <TabsTrigger
                          value="left"
                          className="relative h-12 px-6 rounded-none border-b-2 border-transparent data-[state=active]:border-bias-left data-[state=active]:text-bias-left bg-transparent data-[state=active]:bg-transparent data-[state=active]:shadow-none"
                        >
                          <span className="flex items-center gap-2">
                            <span className="size-2 rounded-full bg-bias-left" />
                            Left
                          </span>
                        </TabsTrigger>
                      )}
                      <TabsTrigger
                        value="center"
                        className="relative h-12 px-6 rounded-none border-b-2 border-transparent data-[state=active]:border-bias-center data-[state=active]:text-foreground bg-transparent data-[state=active]:bg-transparent data-[state=active]:shadow-none"
                      >
                        <span className="flex items-center gap-2">
                          <span className="size-2 rounded-full bg-bias-center" />
                          Center
                        </span>
                      </TabsTrigger>
                      {event.perspectiveSummaries.right && (
                        <TabsTrigger
                          value="right"
                          className="relative h-12 px-6 rounded-none border-b-2 border-transparent data-[state=active]:border-bias-right data-[state=active]:text-bias-right bg-transparent data-[state=active]:bg-transparent data-[state=active]:shadow-none"
                        >
                          <span className="flex items-center gap-2">
                            <span className="size-2 rounded-full bg-bias-right" />
                            Right
                          </span>
                        </TabsTrigger>
                      )}
                    </TabsList>
                  </div>

                  <div className="p-6">
                    {event.perspectiveSummaries.left && (
                      <TabsContent value="left" className="mt-0">
                        <p className="text-sm leading-relaxed max-w-[65ch]">
                          {event.perspectiveSummaries.left}
                        </p>
                      </TabsContent>
                    )}

                    <TabsContent value="center" className="mt-0">
                      <p className="text-sm leading-relaxed max-w-[65ch]">
                        {event.perspectiveSummaries.center}
                      </p>
                    </TabsContent>

                    {event.perspectiveSummaries.right && (
                      <TabsContent value="right" className="mt-0">
                        <p className="text-sm leading-relaxed max-w-[65ch]">
                          {event.perspectiveSummaries.right}
                        </p>
                      </TabsContent>
                    )}
                  </div>
                </Tabs>
              </CardContent>
            </Card>
          ) : (
            <Card className="border-border">
              <CardHeader className="border-b border-border bg-muted/30">
                <div className="flex items-center gap-3">
                  <div className="flex items-center justify-center size-10 rounded-xl bg-primary/10 text-primary">
                    <MessageSquare className="size-5" />
                  </div>
                  <CardTitle>Summary</CardTitle>
                </div>
              </CardHeader>
              <CardContent className="pt-6">
                <p className="text-sm leading-relaxed max-w-[65ch]">
                  {event.perspectiveSummaries.center}
                </p>
              </CardContent>
            </Card>
          )}

          {/* Global Impact */}
          {event.globalImpact && (
            <Card className="border-border">
              <CardHeader className="border-b border-border bg-muted/30">
                <div className="flex items-center gap-3">
                  <div className="flex items-center justify-center size-10 rounded-xl bg-primary/10 text-primary">
                    <Globe className="size-5" />
                  </div>
                  <div>
                    <CardTitle>What This Means</CardTitle>
                    <p className="text-sm text-muted-foreground mt-0.5">
                      How this story affects you
                    </p>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="pt-6">
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
    </div>
  );
}
