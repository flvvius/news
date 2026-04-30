import { useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { api } from "@news-app/backend/convex/_generated/api";
import { SITE } from "@/lib/seo";
import { useQuery } from "convex/react";
import { useMutation } from "@tanstack/react-query";
import { useConvexMutation } from "@convex-dev/react-query";
import EventCard from "@/components/feed/event-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ArrowRight, Globe, Newspaper, Shield, Sparkles } from "lucide-react";

// Unified waitlist form - single component with size variants
function WaitlistForm({
  className,
  size = "default",
}: {
  className?: string;
  size?: "compact" | "default" | "large";
}) {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [message, setMessage] = useState("");
  const [showName, setShowName] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const toastDismissConfig = useQuery(api.config.get, {
    key: "waitlist_toast_dismiss_ms",
  });
  const rawDismiss = Number(toastDismissConfig?.value);
  const toastDismissMs = Number.isFinite(rawDismiss)
    ? Math.max(1, Math.floor(rawDismiss))
    : 10_000;

  const addToWaitlist = useMutation({
    mutationFn: useConvexMutation(api.waitlist.addToWaitlist),
    onSuccess: (result) => {
      if (result.alreadyExists) {
        setMessage(
          `You're already on the waitlist at position #${result.position}!`,
        );
      } else {
        setMessage(
          `You're in! You're #${result.position} on the waitlist. Check your email for details.`,
        );
        setEmail("");
        setName("");
        setShowName(false);
      }
      scheduleReset();
    },
    onError: (error) => {
      console.error("Waitlist submission failed:", error);
      setMessage("Something went wrong. Please try again.");
      scheduleReset();
    },
  });

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const scheduleReset = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      addToWaitlist.reset();
      setMessage("");
    }, toastDismissMs);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    const normalizedEmail = email.trim().toLowerCase();
    addToWaitlist.mutate({
      email: normalizedEmail,
      name: name.trim() || undefined,
    });
  };

  const isPending = addToWaitlist.isPending;
  const status = addToWaitlist.isError
    ? "error"
    : addToWaitlist.isSuccess
      ? "success"
      : "idle";

  // Compact: header form - inline, minimal
  if (size === "compact") {
    return (
      <form onSubmit={handleSubmit} className={className}>
        <div className="flex flex-col gap-2">
          <div className="flex gap-2">
            <Input
              type="email"
              placeholder="your@email.com"
              aria-label="Email address"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onFocus={() => setShowName(true)}
              onBlur={(e) => {
                // Only collapse if both email and name are empty
                if (!e.target.value && !name) {
                  setTimeout(() => setShowName(false), 150);
                }
              }}
              required
              className="flex-1 h-10 px-3 text-sm bg-card/80 backdrop-blur-sm border-border"
              disabled={isPending}
            />
            <Button
              type="submit"
              size="sm"
              disabled={isPending}
              className="h-10 px-4 text-sm font-semibold gap-1.5 group shrink-0"
            >
              {isPending ? (
                "Joining..."
              ) : (
                <>
                  Join
                  <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" />
                </>
              )}
            </Button>
          </div>
          {showName && !message && (
            <Input
              type="text"
              placeholder="Name (optional)"
              aria-label="Your name (optional)"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="h-9 px-3 text-sm bg-card/80 backdrop-blur-sm border-border"
              disabled={isPending}
            />
          )}
        </div>
        {message && (
          <p
            role={status === "error" ? "alert" : "status"}
            aria-live={status === "error" ? "assertive" : "polite"}
            aria-atomic="true"
            className={`text-xs mt-2 ${status === "error" ? "text-destructive" : "text-primary"}`}
          >
            {message}
          </p>
        )}
      </form>
    );
  }

  // Large: main CTA form - stacked, prominent
  if (size === "large") {
    return (
      <form onSubmit={handleSubmit} className={className}>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col sm:flex-row gap-3">
            <Input
              type="email"
              placeholder="Enter your email"
              aria-label="Email address"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="flex-1 h-12 px-4 text-base bg-card border-border"
              disabled={isPending}
            />
            <Button
              type="submit"
              size="lg"
              disabled={isPending}
              className="h-12 px-6 text-base font-semibold gap-2 group"
            >
              {isPending ? (
                "Joining..."
              ) : (
                <>
                  Get Early Access
                  <ArrowRight className="size-4 transition-transform group-hover:translate-x-1" />
                </>
              )}
            </Button>
          </div>
          <Input
            type="text"
            placeholder="Your name (optional)"
            aria-label="Your name (optional)"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="h-11 px-4 text-base bg-card border-border"
            disabled={isPending}
          />
        </div>
        {message && (
          <p
            role={status === "error" ? "alert" : "status"}
            aria-live={status === "error" ? "assertive" : "polite"}
            aria-atomic="true"
            className={`text-sm mt-3 ${status === "error" ? "text-destructive" : "text-primary"}`}
          >
            {message}
          </p>
        )}
      </form>
    );
  }

  // Default: standard form
  return (
    <form onSubmit={handleSubmit} className={className}>
      <div className="flex flex-col gap-3">
        <div className="flex gap-2">
          <Input
            type="email"
            placeholder="Enter your email"
            aria-label="Email address"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            className="flex-1"
            disabled={isPending}
          />
          <Button type="submit" size="lg" disabled={isPending}>
            {isPending ? "Joining..." : "Get Early Access"}
          </Button>
        </div>
        <Input
          type="text"
          placeholder="Your name (optional)"
          aria-label="Your name (optional)"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="flex-1"
          disabled={isPending}
        />
      </div>
      {message && (
        <p
          role={status === "error" ? "alert" : "status"}
          aria-live={status === "error" ? "assertive" : "polite"}
          aria-atomic="true"
          className={`text-sm mt-2 ${status === "error" ? "text-destructive" : "text-primary"}`}
        >
          {message}
        </p>
      )}
    </form>
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

        {/* Floating header */}
        <header className="sticky top-0 z-50 pt-3 pb-2 px-4">
          <div className="mx-auto max-w-4xl">
            <div className="flex items-center justify-between gap-4 px-4 py-2.5 rounded-xl bg-card/80 backdrop-blur-xl border border-border/50 shadow-lg">
              {/* Brand */}
              <div className="flex items-center gap-2.5">
                <div className="relative flex size-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75" />
                  <span className="relative inline-flex rounded-full size-2 bg-primary" />
                </div>
                <span className="font-bold text-sm tracking-tight">
                  {SITE.name}
                </span>
              </div>

              {/* Desktop waitlist */}
              <WaitlistForm
                className="hidden md:block w-64 shrink-0"
                size="compact"
              />

              {/* Mobile CTA */}
              <Button
                size="sm"
                className="md:hidden shrink-0 h-9 px-3 text-xs"
                asChild
              >
                <a href="#join">Get Early Access</a>
              </Button>
            </div>
          </div>
        </header>

        {/* Main content */}
        <div className="relative px-4 pt-4 pb-12">
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
            {displayEvents && displayEvents.length > 0 && (
              <div className="mt-8 text-center">
                <a
                  href="#join"
                  className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
                >
                  <span>Get notified when we launch</span>
                  <ArrowRight className="size-3.5" />
                </a>
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
              Be first to access the full platform when we launch. Free during
              beta.
            </p>

            <WaitlistForm className="w-full max-w-sm" size="large" />
          </div>
        </div>
      </section>
    </div>
  );
}
