import { useEffect, useRef, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation } from "convex/react";
import { api } from "@news-app/backend/convex/_generated/api";
import { z } from "zod";

const searchSchema = z.object({
  email: z.string().optional(),
});

export const Route = createFileRoute("/unsubscribe")({
  validateSearch: searchSchema,
  head: () => ({
    meta: [
      { title: "Unsubscribe — Biviant" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: UnsubscribePage,
});

function UnsubscribePage() {
  const { email } = Route.useSearch();
  const unsubscribe = useMutation(api.waitlist.unsubscribe);

  const [status, setStatus] = useState<"idle" | "loading" | "done" | "error">(
    "idle",
  );
  const [lastEmail, setLastEmail] = useState<string | undefined>(undefined);
  const requestIdRef = useRef(0);

  useEffect(() => {
    if (email !== lastEmail) {
      setStatus("idle");
      setLastEmail(email);
    }
  }, [email, lastEmail]);

  useEffect(() => {
    if (!email || status !== "idle") return;

    const currentId = ++requestIdRef.current;
    setStatus("loading");

    unsubscribe({ email })
      .then(() => {
        if (currentId === requestIdRef.current) setStatus("done");
      })
      .catch(() => {
        if (currentId === requestIdRef.current) setStatus("error");
      });
  }, [email, unsubscribe, status]);

  if (!email) {
    return (
      <PageShell>
        <h1 className="text-2xl font-bold text-foreground">Invalid Link</h1>
        <p className="text-muted-foreground mt-2">
          This unsubscribe link is missing the email address. Please use the
          link from your email.
        </p>
      </PageShell>
    );
  }

  if (status === "loading") {
    return (
      <PageShell>
        <p className="text-muted-foreground">Unsubscribing...</p>
      </PageShell>
    );
  }

  if (status === "error") {
    return (
      <PageShell>
        <h1 className="text-2xl font-bold text-foreground">
          Something went wrong
        </h1>
        <p className="text-muted-foreground mt-2">
          We couldn't process your request. Please try again or reply to our
          email and we'll remove you manually.
        </p>
      </PageShell>
    );
  }

  return (
    <PageShell>
      <h1 className="text-2xl font-bold text-foreground">
        You're unsubscribed
      </h1>
      <p className="text-muted-foreground mt-2">
        <strong>{email}</strong> has been removed from all Biviant emails. You
        won't hear from us again.
      </p>
      <p className="text-sm text-muted-foreground/70 mt-6">
        Changed your mind?{" "}
        <Link to="/" className="text-primary underline">
          Re-join the waitlist
        </Link>
      </p>
    </PageShell>
  );
}

function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/30 px-4">
      <div className="bg-card rounded-xl border border-border p-10 max-w-md w-full text-center shadow-sm">
        <div className="text-2xl font-bold text-primary mb-6">Biviant</div>
        {children}
      </div>
    </div>
  );
}
