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
import {
  ArrowRight,
  Eye,
  Shield,
  Target,
  Zap,
  ChevronDown,
} from "lucide-react";

function WaitlistForm({
  className,
  buttonText = "Get Early Access",
  variant = "default",
}: {
  className?: string;
  buttonText?: string;
  variant?: "default" | "hero";
}) {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [message, setMessage] = useState("");
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

  if (variant === "hero") {
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
                  {buttonText}
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
            className={`text-sm mt-3 ${status === "error" ? "text-destructive" : "text-success"}`}
          >
            {message}
          </p>
        )}
      </form>
    );
  }

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
            {isPending ? "Joining..." : buttonText}
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
          className={`text-sm mt-2 ${status === "error" ? "text-destructive" : "text-success"}`}
        >
          {message}
        </p>
      )}
    </form>
  );
}

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      {
        title: `${SITE.name} — Stop Reading the News Blind`,
      },
      {
        name: "description",
        content:
          "Every story has a left version, a right version, and what actually happened. Biviant shows you all three, scores every source for bias and reliability, and tells you exactly how it affects your life.",
      },
      {
        property: "og:title",
        content: `${SITE.name} — Stop Reading the News Blind`,
      },
      {
        property: "og:description",
        content:
          "Every story has a left version, a right version, and what actually happened. Biviant shows you all three.",
      },
      { property: "og:url", content: SITE.url },
    ],
    links: [{ rel: "canonical", href: SITE.url }],
  }),
  component: LandingPage,
});

function LandingPage() {
  const previewCountConfig = useQuery(api.config.get, {
    key: "landing_preview_count",
  });
  const rawPreview = Number(previewCountConfig?.value);
  const MAX_LANDING_PREVIEW_COUNT = 20;
  const previewCount = Number.isFinite(rawPreview)
    ? Math.min(MAX_LANDING_PREVIEW_COUNT, Math.max(1, Math.floor(rawPreview)))
    : 3;

  const maxSourcesConfig = useQuery(api.config.get, {
    key: "event_card_max_sources",
  });
  const rawMaxSources = Number(maxSourcesConfig?.value);
  const MAX_EVENT_CARD_SOURCES = 10;
  const maxSources = Number.isFinite(rawMaxSources)
    ? Math.min(MAX_EVENT_CARD_SOURCES, Math.max(0, Math.floor(rawMaxSources)))
    : 5;

  const events = useQuery(
    api.events.getPublicPublishedEventsPreview,
    previewCountConfig !== undefined ? { limit: previewCount } : "skip",
  );
  const topics = useQuery(api.topics.getTopics);

  const topicNamesById = useMemo(() => {
    const map: Record<string, string> = {};
    topics?.forEach((topic) => {
      map[topic._id] = topic.displayName;
    });
    return map;
  }, [topics]);

  const scrollToEvents = () => {
    document
      .getElementById("live-events")
      ?.scrollIntoView({ behavior: "smooth" });
  };

  return (
    <div className="flex flex-col">
      {/* Structured data */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "WebSite",
            name: SITE.name,
            url: SITE.url,
            description: SITE.description,
          }),
        }}
      />

      {/* Hero Section - Compact with immediate value prop */}
      <section className="relative">
        <div className="container relative mx-auto max-w-5xl px-4 pt-16 pb-12 md:pt-24 md:pb-16">
          <div className="flex flex-col items-center text-center gap-6">
            {/* Main headline */}
            <h1 className="text-3xl sm:text-4xl md:text-5xl lg:text-6xl font-bold tracking-tight text-balance">
              Stop Reading the{" "}
              <span className="relative inline-block">
                <span className="relative z-10 text-primary">News Blind</span>
                <span className="absolute bottom-1 md:bottom-2 left-0 right-0 h-2 md:h-3 bg-primary/20 -z-0" />
              </span>
            </h1>

            {/* Subtitle - more compact */}
            <p className="text-base md:text-lg text-muted-foreground max-w-[50ch] leading-relaxed text-balance">
              Every story has a left version, a right version, and what actually
              happened. Biviant shows you all three.
            </p>

            {/* Email Capture */}
            <WaitlistForm className="w-full max-w-md mt-2" variant="hero" />

            {/* Scroll indicator */}
            <button
              onClick={scrollToEvents}
              className="mt-4 flex flex-col items-center gap-1 text-muted-foreground hover:text-foreground transition-colors group"
              aria-label="Scroll to live events"
            >
              <span className="text-xs font-medium uppercase tracking-wider">
                See it live
              </span>
              <ChevronDown className="size-5 animate-bounce" />
            </button>
          </div>
        </div>
      </section>

      {/* Live Events Showcase - THE HERO OF THE PAGE */}
      <section
        id="live-events"
        className="relative bg-muted/30 border-y border-border"
      >
        {/* Subtle gradient overlay */}
        <div className="absolute inset-0 bg-linear-to-b from-background via-transparent to-background pointer-events-none" />

        <div className="container relative mx-auto max-w-4xl px-4 py-12 md:py-16">
          <div className="flex flex-col gap-8">
            {/* Section header */}
            <div className="flex flex-col items-center text-center gap-2">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 border border-primary/20 text-primary text-xs font-medium">
                <span className="relative flex size-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75" />
                  <span className="relative inline-flex rounded-full size-2 bg-primary" />
                </span>
                Live Events
              </div>
              <h2 className="text-2xl md:text-3xl font-bold tracking-tight">
                This Is Your News Feed
              </h2>
              <p className="text-sm text-muted-foreground max-w-[45ch]">
                Real stories from multiple perspectives. Tap any event to
                explore.
              </p>
            </div>

            {/* Events grid - the star of the show */}
            <div className="grid gap-4 md:gap-5">
              {events === undefined ? (
                // Loading skeleton
                <div className="flex flex-col gap-4">
                  {[1, 2, 3].map((i) => (
                    <div
                      key={i}
                      className="h-48 rounded-xl bg-card border border-border animate-pulse"
                    />
                  ))}
                </div>
              ) : events.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground">
                  No events available right now. Check back soon.
                </div>
              ) : (
                events.map((event, index) => (
                  <div
                    key={event._id}
                    className="transform transition-all duration-300"
                    style={{
                      animationDelay: `${index * 100}ms`,
                    }}
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

            {/* CTA under events */}
            <div className="flex justify-center pt-4">
              <WaitlistForm
                className="w-full max-w-sm"
                buttonText="Join to See More"
                variant="hero"
              />
            </div>
          </div>
        </div>
      </section>

      {/* How It Works - Compact horizontal strip */}
      <section className="border-b border-border">
        <div className="container mx-auto max-w-5xl px-4 py-10 md:py-12">
          <div className="flex flex-col gap-6">
            <h2 className="text-xl md:text-2xl font-bold tracking-tight text-center">
              How It Works
            </h2>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 md:gap-6">
              {[
                {
                  icon: Eye,
                  title: "Every Angle",
                  description: "One story, all perspectives grouped together.",
                },
                {
                  icon: Shield,
                  title: "Trust Scores",
                  description: "Bias and reliability ratings for every source.",
                },
                {
                  icon: Target,
                  title: "Personal Impact",
                  description: "How each story affects you specifically.",
                },
              ].map(({ icon: Icon, title, description }) => (
                <div
                  key={title}
                  className="flex items-start gap-3 p-4 rounded-xl bg-card border border-border"
                >
                  <div className="flex-shrink-0 flex items-center justify-center size-10 rounded-lg bg-primary/10 text-primary">
                    <Icon className="size-5" />
                  </div>
                  <div className="flex flex-col gap-0.5">
                    <h3 className="font-semibold text-sm">{title}</h3>
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      {description}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Bottom CTA - Compact */}
      <section>
        <div className="container mx-auto max-w-2xl px-4 py-12 md:py-16">
          <div className="flex flex-col items-center text-center gap-5">
            <div className="flex items-center gap-2 text-primary">
              <Zap className="size-5" />
              <span className="text-sm font-medium">Free during beta</span>
            </div>

            <h2 className="text-2xl md:text-3xl font-bold tracking-tight text-balance">
              You Deserve the Whole Story
            </h2>

            <p className="text-muted-foreground max-w-[45ch] text-sm md:text-base">
              Join 50+ early adopters getting news that informs, not inflames.
            </p>

            <WaitlistForm
              className="w-full max-w-sm"
              buttonText="Claim Your Spot"
              variant="hero"
            />
          </div>
        </div>
      </section>
    </div>
  );
}
