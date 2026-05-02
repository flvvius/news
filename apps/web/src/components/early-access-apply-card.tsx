import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useConvexMutation } from "@convex-dev/react-query";
import { api } from "@news-app/backend/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

type WaitlistResponse = {
  success: boolean;
  alreadyExists: boolean;
  position: number;
};

type EarlyAccessApplyCardProps = {
  title?: string;
  description?: string;
  buttonText?: string;
  compact?: boolean;
};

export default function EarlyAccessApplyCard({
  title = "Apply for Early Access",
  description = "Join the waitlist and we’ll email you as soon as your beta access is ready.",
  buttonText = "Join the waitlist",
  compact = false,
}: EarlyAccessApplyCardProps) {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [message, setMessage] = useState("");

  const addToWaitlist = useMutation<
    WaitlistResponse,
    Error,
    { email: string; name?: string }
  >({
    mutationFn: useConvexMutation(api.waitlist.addToWaitlist),
    onSuccess: (result) => {
      if (result.alreadyExists) {
        setMessage(
          `You're already on the waitlist at position #${result.position}.`,
        );
        return;
      }

      setMessage(
        `You're in. You're #${result.position} on the waitlist, and we'll email you when access opens.`,
      );
      setEmail("");
      setName("");
    },
    onError: () => {
      setMessage("Something went wrong. Please try again.");
    },
  });

  return (
    <Card className="border-border/70 bg-card/90">
      <CardHeader className={compact ? "pb-3" : undefined}>
        <CardTitle className={compact ? "text-lg" : "text-xl"}>
          {title}
        </CardTitle>
        <p className="text-sm text-muted-foreground">{description}</p>
      </CardHeader>
      <CardContent>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            setMessage("");
            addToWaitlist.mutate({
              email: email.trim().toLowerCase(),
              name: name.trim() || undefined,
            });
          }}
          className="space-y-3"
        >
          <Input
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="you@example.com"
            aria-label="Email address"
            required
            disabled={addToWaitlist.isPending}
          />
          <Input
            type="text"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Your name (optional)"
            aria-label="Name"
            disabled={addToWaitlist.isPending}
          />
          <Button
            type="submit"
            className="w-full"
            disabled={addToWaitlist.isPending}
          >
            {addToWaitlist.isPending ? "Joining..." : buttonText}
          </Button>
        </form>

        {message && (
          <p
            className={`mt-3 text-sm ${
              addToWaitlist.isError
                ? "text-destructive"
                : "text-muted-foreground"
            }`}
            role={addToWaitlist.isError ? "alert" : "status"}
          >
            {message}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
