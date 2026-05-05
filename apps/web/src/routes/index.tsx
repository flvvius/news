import { useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { api } from "@news-app/backend/convex/_generated/api";
import { SITE } from "@/lib/seo";
import { useConvexAuth, useQuery } from "convex/react";
import { Link } from "@tanstack/react-router";
import EventCard from "@/components/feed/event-card";
import { Button } from "@/components/ui/button";
import { ArrowRight, Globe, Newspaper, Shield, Sparkles } from "lucide-react";

function LandingActions({
  className,
  isAuthenticated,
}: {
  className?: string;
  isAuthenticated: boolean;
}) {
  return (
    <div className={className}>
      <div
        className={`flex flex-col gap-3 sm:flex-row ${
          isAuthenticated ? "sm:justify-center" : ""
        }`}
      >
        <Button asChild size="lg" className="gap-2">
          <Link to="/feed">
            Browse the feed
            <ArrowRight className="size-4" />
          </Link>
        </Button>
        {!isAuthenticated && (
          <Button asChild size="lg" variant="outline">
            <Link
              to="/dashboard"
              search={{ mode: "signup", redirect: "/feed" }}
            >
              Create free account
            </Link>
          </Button>
        )}
      </div>
      {!isAuthenticated && (
        <p className="text-sm text-muted-foreground">
          Reading stays open to everyone. Accounts unlock bookmarks,
          personalized ranking, and notifications.
        </p>
      )}
    </div>
  );
}

// Fallback events for when the feed is empty - intentionally minimal
// These are demo placeholders; EventCard will render them without images/badges
const FALLBACK_EVENTS = [
  {
    _id: "demo-1" as unknown as import("@news-app/backend/convex/_generated/dataModel").Id<"events">,
    _creationTime: Date.now() - 3600000,
    title:
      "Federal Reserve Signals Potential Rate Changes Amid Economic Uncertainty",
    summary:
      "The Federal Reserve indicated possible adjustments to interest rates as economic indicators show mixed signals across different sectors.",
    publishedAt: Date.now() - 3600000,
    sourceCount: 12,
    topicIds: [],
    status: "published" as const,
    extractionQuality: 0.85,
    imageUrl:
      "https://images.unsplash.com/photo-1611974789855-9c2a0a7236a3?w=800&q=80",
  },
  {
    _id: "demo-2" as unknown as import("@news-app/backend/convex/_generated/dataModel").Id<"events">,
    _creationTime: Date.now() - 7200000,
    title:
      "Major Tech Companies Report Quarterly Earnings Exceeding Expectations",
    summary:
      "Several leading technology firms announced better-than-expected quarterly results, driving market optimism despite ongoing regulatory scrutiny.",
    publishedAt: Date.now() - 7200000,
    sourceCount: 8,
    topicIds: [],
    status: "published" as const,
    extractionQuality: 0.92,
    imageUrl:
      "https://images.unsplash.com/photo-1518770660439-4636190af475?w=800&q=80",
  },
  {
    _id: "demo-3" as unknown as import("@news-app/backend/convex/_generated/dataModel").Id<"events">,
    _creationTime: Date.now() - 14400000,
    title: "Climate Summit Concludes with New International Agreements",
    summary:
      "World leaders reached consensus on several key environmental initiatives following intense negotiations at the annual climate conference.",
    publishedAt: Date.now() - 14400000,
    sourceCount: 15,
    topicIds: [],
    status: "published" as const,
    extractionQuality: 0.88,
    imageUrl:
      "https://images.unsplash.com/photo-1569163139599-0f4517e36f51?w=800&q=80",
  },
];

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      {
        title: `${SITE.name} — Every Story Has Three Sides`,
      },
      {
        name: "description",
        content:
          "Every story has a left version, a right version, and what actually happened. Biviant shows you all three, scores every source for bias and reliability, and tells you exactly how it affects your life.",
      },
      {
        property: "og:title",
        content: `${SITE.name} — Every Story Has Three Sides`,
      },
      {
        property: "og:description",
        content:
          "Every story has a left version, a right version, and what actually happened. Biviant shows you all three.",
      },
      { property: "og:url", content: SITE.url },
    ],
    links: [{ rel: "canonical", href: SITE.url }],
    scripts: [
      {
        type: "application/ld+json",
        children: JSON.stringify({
          "@context": "https://schema.org",
          "@type": "WebApplication",
          name: SITE.name,
          url: SITE.url,
          description:
            "Every story has a left version, a right version, and what actually happened. Biviant shows you all three, scores every source for bias and reliability, and tells you exactly how it affects your life.",
          applicationCategory: "NewsApplication",
          operatingSystem: "Web",
        }),
      },
    ],
  }),
  component: LandingPage,
});

function LandingPage() {
  const { isAuthenticated } = useConvexAuth();
  const [hasAnimated, setHasAnimated] = useState(false);

  useEffect(() => {
    // Only animate on first mount
    setHasAnimated(true);
  }, []);

  const previewCountConfig = useQuery(api.config.get, {
    key: "landing_preview_count",
  });
  const rawPreview = Number(previewCountConfig?.value);
  const MAX_LANDING_PREVIEW_COUNT = 20;
  // Show 5 events by default for more impact
  const previewCount = Number.isFinite(rawPreview)
    ? Math.min(MAX_LANDING_PREVIEW_COUNT, Math.max(1, Math.floor(rawPreview)))
    : 5;

  const maxSourcesConfig = useQuery(api.config.get, {
    key: "event_card_max_sources",
  });
  const rawMaxSources = Number(maxSourcesConfig?.value);
  const MAX_EVENT_CARD_SOURCES = 10;
  const maxSources = Number.isFinite(rawMaxSources)
    ? Math.min(MAX_EVENT_CARD_SOURCES, Math.max(0, Math.floor(rawMaxSources)))
    : 5;

  // Optimistic loading - use default value immediately, don't wait for config
  const events = useQuery(api.events.getPublicPublishedEventsPreview, {
    limit: previewCount,
  });

  const topics = useQuery(
    api.topics.getTopics,
    events && events.length > 0 ? undefined : "skip",
  );

  const topicNamesById = useMemo(() => {
    const map: Record<string, string> = {};
    topics?.forEach((topic) => {
      map[topic._id] = topic.displayName;
    });
    return map;
  }, [topics]);

  // Use fallback events if feed is empty
  const displayEvents =
    events && events.length > 0
      ? events
      : events !== undefined
        ? FALLBACK_EVENTS
        : undefined;
  const isUsingFallback = events !== undefined && events.length === 0;

  return (
    <div className="flex flex-col min-h-screen">
      {/* EVENTS-FIRST HERO - Events ARE the landing page */}
      <section className="relative">
        {/* Single subtle ambient glow */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-[600px] h-[400px] bg-primary/5 rounded-full blur-3xl" />
        </div>

        {/* Main content */}
        <div className="relative px-4 pt-8 pb-12">
          <div className="mx-auto max-w-4xl">
            {/* Headline - the sharp value prop */}
            <div className="text-center mb-8">
              <h1 className="text-2xl sm:text-3xl md:text-4xl font-bold tracking-tight mb-3 text-balance leading-tight">
                Every story has a left version, a right version,
                <br className="hidden sm:block" />
                <span className="text-muted-foreground">
                  {" "}
                  and what actually happened.
                </span>
              </h1>
              <p className="text-base text-primary font-medium">
                See all three, with bias scores and impact analysis.
              </p>
            </div>

            {/* THE EVENTS - No decorative frame, trust the cards */}
            <div className="flex flex-col gap-4">
              {displayEvents === undefined ? (
                // Loading skeleton - match previewCount
                <>
                  {Array.from({ length: previewCount }).map((_, i) => (
                    <div
                      key={i}
                      className="h-48 rounded-xl bg-card border border-border overflow-hidden"
                    >
                      <div className="p-5 flex flex-col gap-3 h-full">
                        <div className="flex gap-2">
                          <div className="h-5 w-16 rounded-full bg-muted animate-pulse" />
                          <div className="h-5 w-20 rounded-full bg-muted animate-pulse" />
                        </div>
                        <div className="h-6 w-3/4 rounded bg-muted animate-pulse" />
                        <div className="h-4 w-full rounded bg-muted animate-pulse" />
                        <div className="h-4 w-2/3 rounded bg-muted animate-pulse" />
                        <div className="flex gap-2 mt-auto">
                          <div className="h-8 w-24 rounded-lg bg-muted animate-pulse" />
                          <div className="h-8 w-24 rounded-lg bg-muted animate-pulse" />
                        </div>
                      </div>
                    </div>
                  ))}
                </>
              ) : (
                displayEvents.map((event, index) => (
                  <div
                    key={event._id}
                    className={
                      hasAnimated
                        ? ""
                        : "animate-in fade-in slide-in-from-bottom-4"
                    }
                    style={
                      hasAnimated
                        ? {}
                        : {
                            animationDelay: `${index * 100}ms`,
                            animationDuration: "500ms",
                            animationFillMode: "both",
                          }
                    }
                  >
                    <EventCard
                      event={event}
                      topicNamesById={topicNamesById}
                      maxSources={maxSources}
                    />
                  </div>
                ))
              )}
            </div>

            {/* Demo indicator if using fallback */}
            {isUsingFallback && (
              <div className="mt-4 text-center">
                <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground bg-muted/50 px-3 py-1.5 rounded-full">
                  <Sparkles className="size-3" />
                  Demo events shown - live feed coming soon
                </span>
              </div>
            )}

            {/* Scroll hint */}
            {!isAuthenticated && displayEvents && displayEvents.length > 0 && (
              <div className="mt-8 text-center">
                <Link
                  to="/dashboard"
                  search={{ mode: "signup", redirect: "/feed" }}
                  className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
                >
                  <span>Create a free account</span>
                  <ArrowRight className="size-3.5" />
                </Link>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* How It Works - Ultra compact, lead with Your Impact */}
      <section className="border-y border-border bg-muted/30">
        <div className="container mx-auto max-w-4xl px-4 py-8">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
            {[
              {
                icon: Sparkles,
                title: "Your Impact",
                desc: "See exactly how each story affects your life, finances, and community.",
              },
              {
                icon: Newspaper,
                title: "Every Angle",
                desc: "One story from left, right, and center sources side by side.",
              },
              {
                icon: Shield,
                title: "Trust Scores",
                desc: "We score every claim, not just every source.",
              },
            ].map(({ icon: Icon, title, desc }) => (
              <div key={title} className="flex items-start gap-3">
                <div className="flex-shrink-0 flex items-center justify-center size-10 rounded-xl bg-primary/10 text-primary">
                  <Icon className="size-5" />
                </div>
                <div>
                  <h3 className="font-semibold text-sm">{title}</h3>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    {desc}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Final CTA - Single focused message */}
      <section id="join">
        <div className="container mx-auto max-w-xl px-4 py-14">
          <div className="flex flex-col items-center text-center gap-5">
            {/* Specificity flex instead of low number */}
            <div className="flex items-center gap-2 text-muted-foreground">
              <Globe className="size-4" />
              <span className="text-xs font-medium">
                Tracking 50+ news sources across the political spectrum
              </span>
            </div>

            <h2 className="text-xl md:text-2xl font-bold tracking-tight text-balance">
              Stop reading the news blind
            </h2>

            <p className="text-sm text-muted-foreground max-w-[45ch] leading-relaxed">
              {isAuthenticated
                ? "Read the full feed, save what matters, and keep your perspective sharp."
                : "Read the full feed right now, then create a free account when you want bookmarks, personalized ranking, and alerts."}
            </p>

            <LandingActions
              className="w-full max-w-sm"
              isAuthenticated={Boolean(isAuthenticated)}
            />
          </div>
        </div>
      </section>
    </div>
  );
}
