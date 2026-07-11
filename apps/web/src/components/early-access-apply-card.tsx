import { useState, type ChangeEvent, type FormEvent } from "react";
import { useMutation } from "@tanstack/react-query";
import { useConvexMutation } from "@convex-dev/react-query";
import { Link } from "@tanstack/react-router";
import { api } from "@news-app/backend/convex/_generated/api";
import { WAITLIST_CONSENT_TEXT } from "@news-app/backend/convex/lib/consent";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { getClientIp } from "@/lib/getClientIp";

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
    {
      email: string;
      name?: string;
      consentSourcePage?: string;
      clientIp?: string;
    }
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
          onSubmit={(event: FormEvent<HTMLFormElement>) => {
            event.preventDefault();
            setMessage("");
            const normalizedEmail = email.trim().toLowerCase();
            if (!normalizedEmail) {
              setMessage("Please enter a valid email");
              return;
            }
            // L12: record consent provenance (source page + requester IP).
            void getClientIp()
              .catch(() => null)
              .then((clientIp) => {
                addToWaitlist.mutate({
                  email: normalizedEmail,
                  name: name.trim() || undefined,
                  consentSourcePage:
                    typeof window !== "undefined"
                      ? window.location.pathname
                      : undefined,
                  clientIp: clientIp ?? undefined,
                });
              });
          }}
          className="space-y-3"
        >
          <Input
            type="email"
            value={email}
            onChange={(event: ChangeEvent<HTMLInputElement>) =>
              setEmail(event.target.value)
            }
            placeholder="you@example.com"
            aria-label="Email address"
            required
            disabled={addToWaitlist.isPending}
          />
          <Input
            type="text"
            value={name}
            onChange={(event: ChangeEvent<HTMLInputElement>) =>
              setName(event.target.value)
            }
            placeholder="Your name (optional)"
            aria-label="Name"
            disabled={addToWaitlist.isPending}
          />
          {/* L12: explicit affirmative consent statement, privacy policy link
              adjacent to submit, opt-out control named at the point of
              collection — no pre-checked boxes, no ToS bundling. */}
          <p
            data-waitlist-consent
            className="text-xs leading-relaxed text-muted-foreground"
          >
            {WAITLIST_CONSENT_TEXT}{" "}
            <Link
              to="/politica-confidentialitate"
              className="underline underline-offset-2 hover:text-foreground"
            >
              Politica de confidențialitate
            </Link>
          </p>
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
            aria-live={addToWaitlist.isError ? "assertive" : "polite"}
          >
            {message}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
