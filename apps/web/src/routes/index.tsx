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

function WaitlistForm({
  className,
  buttonText = "Get Early Access",
}: {
  className?: string;
  buttonText?: string;
}) {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [message, setMessage] = useState("");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
    }, 10_000);
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
  // Get a few events for preview
  const events = useQuery(api.events.getPublishedEvents, {
    paginationOpts: { numItems: 3, cursor: null },
  });
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
      {/* Structured data — visible to search engines */}
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
      <section className="border-b bg-linear-to-b from-background to-muted/20">
        <div className="container mx-auto max-w-5xl px-4 py-16 md:py-24">
          <div className="flex flex-col items-center text-center gap-6">
            <h1 className="text-4xl md:text-6xl font-bold tracking-tight">
              Stop Reading the News Blind
            </h1>
            <p className="text-xl md:text-2xl text-muted-foreground max-w-[65ch] leading-relaxed">
              Every story has a left version, a right version, and what actually
              happened. Biviant shows you all three, scores every source for
              bias and reliability, and tells you exactly how it affects your
              life.
            </p>

            {/* Email Capture */}
            <WaitlistForm className="w-full max-w-md mt-4" />

            <p className="text-sm text-muted-foreground">
              Free during beta · No credit card required
            </p>
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section className="border-b">
        <div className="container mx-auto max-w-5xl px-4 py-16">
          <h2 className="text-3xl font-bold text-center mb-12">How It Works</h2>
          <div className="grid md:grid-cols-3 gap-8">
            <Card>
              <CardContent className="pt-6">
                <div className="flex flex-col items-center text-center gap-4">
                  <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center text-2xl font-bold text-primary">
                    1
                  </div>
                  <h3 className="font-semibold text-lg">
                    One Story, Every Angle
                  </h3>
                  <p className="text-sm text-muted-foreground">
                    When a story breaks, Biviant collects coverage from across
                    the political spectrum and groups it into one event. No more
                    Googling to see what the other side is saying.
                  </p>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="pt-6">
                <div className="flex flex-col items-center text-center gap-4">
                  <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center text-2xl font-bold text-primary">
                    2
                  </div>
                  <h3 className="font-semibold text-lg">Know Who to Trust</h3>
                  <p className="text-sm text-muted-foreground">
                    Every source gets a bias score from far-left to far-right
                    and a reliability score from tabloid to wire service. You
                    always know exactly where your information is coming from.
                  </p>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="pt-6">
                <div className="flex flex-col items-center text-center gap-4">
                  <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center text-2xl font-bold text-primary">
                    3
                  </div>
                  <h3 className="font-semibold text-lg">
                    See Why It Matters to You
                  </h3>
                  <p className="text-sm text-muted-foreground">
                    Biviant doesn&apos;t just summarize the news — it tells you
                    how each story affects you personally, based on your job,
                    your location, and what you care about. The &ldquo;so
                    what?&rdquo; that other news apps never answer.
                  </p>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </section>

      {/* Personal Impact — key differentiator */}
      <section className="border-b bg-muted/10">
        <div className="container mx-auto max-w-4xl px-4 py-16">
          <div className="flex flex-col items-center text-center gap-6">
            <h2 className="text-3xl font-bold">
              News That&apos;s Actually About You
            </h2>
            <p className="text-lg text-muted-foreground max-w-[55ch] leading-relaxed">
              Biviant doesn&apos;t just tell you what happened — it tells you
              what it means for&nbsp;you.
            </p>
            <div className="grid sm:grid-cols-2 gap-6 mt-4 w-full max-w-2xl text-left">
              <Card>
                <CardContent className="pt-6">
                  <h3 className="font-semibold mb-2">Personal Impact</h3>
                  <p className="text-sm text-muted-foreground">
                    Based on your profile, every story comes with a breakdown of
                    how it affects you. A new tax bill? You&apos;ll know exactly
                    how it hits your bracket. A tech regulation? You&apos;ll see
                    what it means for your industry.
                  </p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-6">
                  <h3 className="font-semibold mb-2">Actionable Tips</h3>
                  <p className="text-sm text-muted-foreground">
                    Every insight comes with a clear next step — not just
                    &ldquo;be informed,&rdquo; but what you can actually do
                    about it.
                  </p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-6">
                  <h3 className="font-semibold mb-2">Bias Balance Tracker</h3>
                  <p className="text-sm text-muted-foreground">
                    Biviant tracks your reading habits and shows you when
                    you&apos;re drifting into a bubble — so you can course
                    correct before it becomes a blind spot.
                  </p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-6">
                  <h3 className="font-semibold mb-2">Reading Streaks</h3>
                  <p className="text-sm text-muted-foreground">
                    Build a daily habit of balanced reading. Streaks keep you
                    coming back and help you stay consistently informed.
                  </p>
                </CardContent>
              </Card>
            </div>
          </div>
        </div>
      </section>

      {/* Feed Preview */}
      <section className="bg-muted/30">
        <div className="container mx-auto max-w-4xl px-4 py-16">
          <div className="flex flex-col gap-6">
            <div className="text-center">
              <h2 className="text-2xl font-bold">See How It Actually Looks</h2>
              <p className="text-sm text-muted-foreground mt-1">
                Real stories, real perspectives. This is what your daily feed
                looks like on Biviant.
              </p>
            </div>

            <div className="grid gap-4">
              {events?.page.map((event) => (
                <EventCard
                  key={event._id}
                  event={event}
                  topicNamesById={topicNamesById}
                />
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Bottom CTA */}
      <section className="border-t">
        <div className="container mx-auto max-w-3xl px-4 py-16">
          <div className="flex flex-col items-center text-center gap-6">
            <h2 className="text-3xl font-bold">
              You Deserve to Know the Whole Story
            </h2>
            <p className="text-lg text-muted-foreground max-w-[55ch] leading-relaxed">
              Most news apps optimize for engagement. Biviant optimizes for
              understanding. Join the waitlist and be first to try a news
              experience built around clarity, not clicks.
            </p>

            <WaitlistForm
              className="w-full max-w-md"
              buttonText="Claim Your Spot"
            />
          </div>
        </div>
      </section>
    </div>
  );
}
