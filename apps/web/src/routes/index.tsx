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
import { Card, CardContent } from "@/components/ui/card";
import {
  ArrowRight,
  Eye,
  Shield,
  Target,
  Zap,
  TrendingUp,
  Users,
  Sparkles,
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
          `You're already on the waitlist at position #${result.position}!`
        );
      } else {
        setMessage(
          `You're in! You're #${result.position} on the waitlist. Check your email for details.`
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
        <div className="flex flex-col gap-4">
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
            className="h-12 px-4 text-base bg-card border-border"
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
    api.events.getPublishedEvents,
    previewCountConfig !== undefined
      ? { paginationOpts: { numItems: previewCount, cursor: null } }
      : "skip"
  );
  const topics = useQuery(api.topics.getTopics);

  const topicNamesById = useMemo(() => {
    const map: Record<string, string> = {};
    topics?.forEach((topic) => {
      map[topic._id] = topic.displayName;
    });
    return map;
  }, [topics]);

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

      {/* Hero Section */}
      <section className="relative overflow-hidden">
        {/* Background gradient */}
        <div className="absolute inset-0 bg-gradient-to-b from-primary/5 via-background to-background" />
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[600px] bg-primary/10 rounded-full blur-3xl opacity-30" />

        <div className="container relative mx-auto max-w-5xl px-4 py-20 md:py-32">
          <div className="flex flex-col items-center text-center gap-8">
            {/* Badge */}
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-primary/10 border border-primary/20 text-primary text-sm font-medium">
              <Sparkles className="size-4" />
              Multi-perspective news platform
            </div>

            {/* Main headline */}
            <h1 className="text-4xl sm:text-5xl md:text-6xl lg:text-7xl font-bold tracking-tight text-balance">
              Stop Reading the{" "}
              <span className="relative">
                <span className="relative z-10 text-primary">News Blind</span>
                <span className="absolute bottom-2 left-0 right-0 h-3 bg-primary/20 -z-0" />
              </span>
            </h1>

            {/* Subtitle */}
            <p className="text-lg md:text-xl text-muted-foreground max-w-[55ch] leading-relaxed text-balance">
              Every story has a left version, a right version, and what actually
              happened. Biviant shows you all three, scores every source for
              bias and reliability, and tells you exactly how it affects your
              life.
            </p>

            {/* Email Capture */}
            <WaitlistForm className="w-full max-w-lg mt-4" variant="hero" />

            {/* Trust indicators */}
            <div className="flex flex-wrap items-center justify-center gap-6 mt-4 text-sm text-muted-foreground">
              <div className="flex items-center gap-2">
                <Shield className="size-4 text-primary" />
                Free during beta
              </div>
              <div className="flex items-center gap-2">
                <Zap className="size-4 text-primary" />
                No credit card required
              </div>
              <div className="flex items-center gap-2">
                <Users className="size-4 text-primary" />
                Join 1,000+ early adopters
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section className="border-y border-border bg-muted/30">
        <div className="container mx-auto max-w-5xl px-4 py-20">
          <div className="text-center mb-12">
            <h2 className="text-3xl md:text-4xl font-bold tracking-tight mb-4">
              How It Works
            </h2>
            <p className="text-muted-foreground text-lg max-w-[50ch] mx-auto">
              Three simple steps to break free from your filter bubble
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-6">
            {[
              {
                step: 1,
                icon: Eye,
                title: "One Story, Every Angle",
                description:
                  "When a story breaks, Biviant collects coverage from across the political spectrum and groups it into one event. No more Googling to see what the other side is saying.",
              },
              {
                step: 2,
                icon: Shield,
                title: "Know Who to Trust",
                description:
                  "Every source gets a bias score from far-left to far-right and a reliability score from tabloid to wire service. You always know exactly where your information is coming from.",
              },
              {
                step: 3,
                icon: Target,
                title: "See Why It Matters to You",
                description:
                  "Biviant doesn't just summarize the news — it tells you how each story affects you personally, based on your job, your location, and what you care about.",
              },
            ].map(({ step, icon: Icon, title, description }) => (
              <Card
                key={step}
                className="group relative overflow-hidden border-border hover:border-primary/30 transition-colors"
              >
                <CardContent className="pt-8 pb-8">
                  <div className="flex flex-col items-center text-center gap-4">
                    {/* Step indicator */}
                    <div className="relative">
                      <div className="flex items-center justify-center size-14 rounded-2xl bg-primary/10 text-primary group-hover:bg-primary group-hover:text-primary-foreground transition-colors">
                        <Icon className="size-7" />
                      </div>
                      <span className="absolute -top-2 -right-2 flex items-center justify-center size-6 rounded-full bg-primary text-primary-foreground text-xs font-bold">
                        {step}
                      </span>
                    </div>

                    <h3 className="font-semibold text-lg">{title}</h3>
                    <p className="text-sm text-muted-foreground leading-relaxed">
                      {description}
                    </p>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* Personal Impact */}
      <section className="border-b border-border">
        <div className="container mx-auto max-w-5xl px-4 py-20">
          <div className="grid lg:grid-cols-2 gap-12 items-center">
            {/* Left column - text */}
            <div className="flex flex-col gap-6">
              <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-primary/10 border border-primary/20 text-primary text-sm font-medium w-fit">
                <Target className="size-4" />
                Personalized insights
              </div>

              <h2 className="text-3xl md:text-4xl font-bold tracking-tight">
                News That&apos;s Actually About You
              </h2>

              <p className="text-muted-foreground text-lg leading-relaxed">
                Biviant doesn&apos;t just tell you what happened — it tells you
                what it means for you. No more wondering how a story affects
                your life.
              </p>

              <div className="grid gap-4 mt-2">
                {[
                  {
                    title: "Personal Impact",
                    description:
                      "Every story comes with a breakdown of how it affects you based on your profile.",
                  },
                  {
                    title: "Actionable Tips",
                    description:
                      "Clear next steps — not just 'be informed,' but what you can actually do.",
                  },
                ].map(({ title, description }) => (
                  <div key={title} className="flex gap-4">
                    <div className="flex-shrink-0 flex items-center justify-center size-10 rounded-lg bg-primary/10 text-primary">
                      <Zap className="size-5" />
                    </div>
                    <div>
                      <h4 className="font-semibold mb-1">{title}</h4>
                      <p className="text-sm text-muted-foreground">
                        {description}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Right column - feature cards */}
            <div className="grid sm:grid-cols-2 gap-4">
              {[
                {
                  icon: TrendingUp,
                  title: "Bias Balance Tracker",
                  description:
                    "Track your reading habits and see when you're drifting into a bubble.",
                },
                {
                  icon: Sparkles,
                  title: "Reading Streaks",
                  description:
                    "Build a daily habit of balanced reading with streaks.",
                },
              ].map(({ icon: Icon, title, description }) => (
                <Card
                  key={title}
                  className="group border-border hover:border-primary/30 transition-colors"
                >
                  <CardContent className="pt-6">
                    <div className="flex flex-col gap-3">
                      <div className="flex items-center justify-center size-12 rounded-xl bg-primary/10 text-primary group-hover:bg-primary group-hover:text-primary-foreground transition-colors">
                        <Icon className="size-6" />
                      </div>
                      <h3 className="font-semibold">{title}</h3>
                      <p className="text-sm text-muted-foreground">
                        {description}
                      </p>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Feed Preview */}
      <section className="bg-muted/20">
        <div className="container mx-auto max-w-5xl px-4 py-20">
          <div className="flex flex-col gap-8">
            <div className="text-center">
              <h2 className="text-3xl md:text-4xl font-bold tracking-tight mb-4">
                See How It Actually Looks
              </h2>
              <p className="text-muted-foreground text-lg max-w-[50ch] mx-auto">
                Real stories, real perspectives. This is what your daily feed
                looks like on Biviant.
              </p>
            </div>

            <div className="grid gap-6 max-w-4xl mx-auto w-full">
              {events?.page.map((event) => (
                <EventCard
                  key={event._id}
                  event={event}
                  topicNamesById={topicNamesById}
                  maxSources={maxSources}
                />
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Bottom CTA */}
      <section className="border-t border-border">
        <div className="container mx-auto max-w-3xl px-4 py-20">
          <div className="relative overflow-hidden rounded-3xl bg-primary/5 border border-primary/20 p-8 md:p-12">
            {/* Background decoration */}
            <div className="absolute top-0 right-0 w-64 h-64 bg-primary/10 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2" />

            <div className="relative flex flex-col items-center text-center gap-6">
              <h2 className="text-3xl md:text-4xl font-bold tracking-tight text-balance">
                You Deserve to Know the Whole Story
              </h2>
              <p className="text-lg text-muted-foreground max-w-[50ch] leading-relaxed">
                Most news apps optimize for engagement. Biviant optimizes for
                understanding. Join the waitlist and be first to try a news
                experience built around clarity, not clicks.
              </p>

              <WaitlistForm
                className="w-full max-w-md"
                buttonText="Claim Your Spot"
                variant="hero"
              />
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
