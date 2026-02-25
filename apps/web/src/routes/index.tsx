import { useEffect, useRef, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { api } from "@news-app/backend/convex/_generated/api";
import { useMutation, useQuery } from "convex/react";
import EventCard from "@/components/feed/event-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";

function WaitlistForm({
  name,
  email,
  status,
  message,
  onNameChange,
  onEmailChange,
  onSubmit,
  className,
  buttonText = "Join Waitlist",
}: {
  name: string;
  email: string;
  status: "idle" | "loading" | "success" | "error";
  message: string;
  onNameChange: (value: string) => void;
  onEmailChange: (value: string) => void;
  onSubmit: (e: React.FormEvent) => void;
  className?: string;
  buttonText?: string;
}) {
  return (
    <form onSubmit={onSubmit} className={className}>
      <div className="flex flex-col gap-3">
        <Input
          type="text"
          placeholder="Your name (optional)"
          value={name}
          onChange={(e) => onNameChange(e.target.value)}
          className="flex-1"
          disabled={status === "loading"}
        />
        <div className="flex gap-2">
          <Input
            type="email"
            placeholder="Enter your email"
            value={email}
            onChange={(e) => onEmailChange(e.target.value)}
            required
            className="flex-1"
            disabled={status === "loading"}
          />
          <Button type="submit" size="lg" disabled={status === "loading"}>
            {status === "loading" ? "Joining..." : buttonText}
          </Button>
        </div>
      </div>
      {message && (
        <p
          className={`text-sm mt-2 ${status === "error" ? "text-red-500" : "text-green-600"}`}
        >
          {message}
        </p>
      )}
    </form>
  );
}

export const Route = createFileRoute("/")({
  component: LandingPage,
});

function LandingPage() {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [status, setStatus] = useState<
    "idle" | "loading" | "success" | "error"
  >("idle");
  const [message, setMessage] = useState("");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const addToWaitlist = useMutation(api.waitlist.addToWaitlist);

  // Get a few events for preview
  const events = useQuery(api.events.getPublishedEvents, {
    paginationOpts: { numItems: 3, cursor: null },
  });
  const topics = useQuery(api.topics.getTopics);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatus("loading");

    try {
      const result = await addToWaitlist({
        email,
        name: name.trim() || undefined,
      });

      if (result.alreadyExists) {
        setMessage(
          `You're already on the waitlist at position #${result.position}!`,
        );
        setStatus("success");
      } else {
        setMessage(
          `You're in! You're #${result.position} on the waitlist. Check your email for details.`,
        );
        setStatus("success");
        setEmail("");
        setName("");
      }
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Something went wrong. Please try again.",
      );
      setStatus("error");
    }

    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      setStatus("idle");
      setMessage("");
    }, 10000); // Show success message for 10 seconds
  };

  const topicNamesById: Record<string, string> = {};
  topics?.forEach((topic) => {
    topicNamesById[topic._id] = topic.displayName;
  });

  return (
    <div className="flex flex-col">
      {/* Hero Section */}
      <section className="border-b bg-gradient-to-b from-background to-muted/20">
        <div className="container mx-auto max-w-5xl px-4 py-16 md:py-24">
          <div className="flex flex-col items-center text-center gap-6">
            <h1 className="text-4xl md:text-6xl font-bold tracking-tight">
              See Every Side of the Story
            </h1>
            <p className="text-xl md:text-2xl text-muted-foreground max-w-3xl">
              Break out of your news bubble. Get the same story from left,
              center, and right perspectives — all in one place.
            </p>

            {/* Email Capture */}
            <WaitlistForm
              name={name}
              email={email}
              status={status}
              message={message}
              onNameChange={setName}
              onEmailChange={setEmail}
              onSubmit={handleSubmit}
              className="w-full max-w-md mt-4"
              buttonText="Join Waitlist"
            />

            <p className="text-sm text-muted-foreground">
              Free during beta • No credit card required
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
                  <h3 className="font-semibold text-lg">We Gather the News</h3>
                  <p className="text-sm text-muted-foreground">
                    Our AI scans trusted sources across the political spectrum —
                    from NPR to Fox News, NYT to WSJ.
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
                  <h3 className="font-semibold text-lg">We Cluster Stories</h3>
                  <p className="text-sm text-muted-foreground">
                    Articles about the same event are automatically grouped
                    together, regardless of political bias.
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
                  <h3 className="font-semibold text-lg">You See Every Angle</h3>
                  <p className="text-sm text-muted-foreground">
                    Read how the left, center, and right are covering the same
                    story. Make up your own mind.
                  </p>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </section>

      {/* Feed Preview */}
      <section className="bg-muted/30">
        <div className="container mx-auto max-w-4xl px-4 py-16">
          <div className="flex flex-col gap-6">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-2xl font-bold">Today's Events</h2>
                <p className="text-sm text-muted-foreground">
                  See what's happening now
                </p>
              </div>
              <Link to="/feed">
                <Button variant="outline">View All →</Button>
              </Link>
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

            <div className="text-center">
              <Link to="/feed">
                <Button size="lg">Explore All Stories</Button>
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Social Proof / CTA */}
      <section className="border-t">
        <div className="container mx-auto max-w-3xl px-4 py-16">
          <div className="flex flex-col items-center text-center gap-6">
            <h2 className="text-3xl font-bold">News Without the Noise</h2>
            <p className="text-lg text-muted-foreground">
              Join thousands of readers who want the full story, not just one
              side of it.
            </p>

            <WaitlistForm
              name={name}
              email={email}
              status={status}
              message={message}
              onNameChange={setName}
              onEmailChange={setEmail}
              onSubmit={handleSubmit}
              className="w-full max-w-md"
              buttonText="Get Early Access"
            />
          </div>
        </div>
      </section>
    </div>
  );
}
