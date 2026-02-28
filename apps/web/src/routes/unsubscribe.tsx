import { useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";
import { useConvexMutation } from "@convex-dev/react-query";
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
  const [lastEmail, setLastEmail] = useState<string | undefined>(undefined);

  const unsubscribe = useMutation({
    mutationFn: useConvexMutation(api.waitlist.unsubscribe),
  });

  // Reset mutation state when email changes so it re-fires
  useEffect(() => {
    if (email !== lastEmail) {
      unsubscribe.reset();
      setLastEmail(email);
    }
  }, [email, lastEmail]);

  // Auto-fire unsubscribe when ready
  useEffect(() => {
    if (
      !email ||
      unsubscribe.isPending ||
      unsubscribe.isSuccess ||
      unsubscribe.isError
    )
      return;

    unsubscribe.mutate({ email });
  }, [
    email,
    unsubscribe.isPending,
    unsubscribe.isSuccess,
    unsubscribe.isError,
  ]);

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

  if (unsubscribe.isPending) {
    return (
      <PageShell>
        <p className="text-muted-foreground" role="status" aria-live="polite">
          Unsubscribing...
        </p>
      </PageShell>
    );
  }

  if (unsubscribe.isError) {
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
