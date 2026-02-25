import { useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation } from "convex/react";
import { api } from "@news-app/backend/convex/_generated/api";
import { z } from "zod";

const searchSchema = z.object({
  email: z.string().optional(),
});

export const Route = createFileRoute("/unsubscribe")({
  validateSearch: searchSchema,
  component: UnsubscribePage,
});

function UnsubscribePage() {
  const { email } = Route.useSearch();
  const unsubscribe = useMutation(api.waitlist.unsubscribe);

  const [status, setStatus] = useState<"idle" | "loading" | "done" | "error">(
    "idle",
  );

  useEffect(() => {
    if (!email || status !== "idle") return;

    setStatus("loading");

    unsubscribe({ email })
      .then(() => setStatus("done"))
      .catch(() => setStatus("error"));
  }, [email]);

  if (!email) {
    return (
      <PageShell>
        <h1 className="text-2xl font-bold text-gray-900">Invalid Link</h1>
        <p className="text-gray-500 mt-2">
          This unsubscribe link is missing the email address. Please use the
          link from your email.
        </p>
      </PageShell>
    );
  }

  if (status === "loading") {
    return (
      <PageShell>
        <p className="text-gray-500">Unsubscribing...</p>
      </PageShell>
    );
  }

  if (status === "error") {
    return (
      <PageShell>
        <h1 className="text-2xl font-bold text-gray-900">
          Something went wrong
        </h1>
        <p className="text-gray-500 mt-2">
          We couldn't process your request. Please try again or reply to our
          email and we'll remove you manually.
        </p>
      </PageShell>
    );
  }

  return (
    <PageShell>
      <h1 className="text-2xl font-bold text-gray-900">You're unsubscribed</h1>
      <p className="text-gray-500 mt-2">
        <strong>{email}</strong> has been removed from all Biviant emails. You
        won't hear from us again.
      </p>
      <p className="text-sm text-gray-400 mt-6">
        Changed your mind?{" "}
        <Link to="/" className="text-blue-600 underline">
          Re-join the waitlist
        </Link>
      </p>
    </PageShell>
  );
}

function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="bg-white rounded-xl border border-gray-200 p-10 max-w-md w-full text-center shadow-sm">
        <div className="text-2xl font-bold text-blue-600 mb-6">Biviant</div>
        {children}
      </div>
    </div>
  );
}
