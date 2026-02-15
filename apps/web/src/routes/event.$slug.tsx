import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "convex/react";
import { api } from "@news-app/backend/convex/_generated/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import ArticlesList from "@/components/feed/articles-list";

export const Route = createFileRoute("/event/$slug")({
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
                    <p className="text-sm leading-relaxed">
                      {event.perspectiveSummaries.left}
                    </p>
                  </TabsContent>
                )}

                <TabsContent value="center" className="mt-4">
                  <p className="text-sm leading-relaxed">
                    {event.perspectiveSummaries.center}
                  </p>
                </TabsContent>

                {event.perspectiveSummaries.right && (
                  <TabsContent value="right" className="mt-4">
                    <p className="text-sm leading-relaxed">
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
              <p className="text-sm leading-relaxed">
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
              <p className="text-sm leading-relaxed">{event.globalImpact}</p>
            </CardContent>
          </Card>
        )}

        {/* Articles */}
        <ArticlesList articles={articles} />
      </div>
    </div>
  );
}
