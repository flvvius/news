import { useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";
import { useConvexMutation } from "@convex-dev/react-query";
import { api } from "@news-app/backend/convex/_generated/api";
import { z } from "zod";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  AlertCircle,
  CheckCircle,
  Loader2,
  Mail,
  MailX,
} from "lucide-react";

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

  useEffect(() => {
    if (email !== lastEmail) {
      unsubscribe.reset();
      setLastEmail(email);
    }
  }, [email, lastEmail]);

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
        <StatusIcon variant="error" />
        <h1 className="text-2xl font-bold mt-6">Invalid Link</h1>
        <p className="text-muted-foreground mt-2 max-w-sm">
          This unsubscribe link is missing the email address. Please use the
          link from your email.
        </p>
        <Link to="/" className="mt-6">
          <Button variant="outline">Go to homepage</Button>
        </Link>
      </PageShell>
    );
  }

  if (unsubscribe.isPending) {
    return (
      <PageShell>
        <div className="flex items-center justify-center size-16 rounded-2xl bg-primary/10">
          <Loader2 className="size-8 text-primary animate-spin" />
        </div>
        <p
          className="text-muted-foreground mt-6"
          role="status"
          aria-live="polite"
        >
          Unsubscribing...
        </p>
      </PageShell>
    );
  }

  if (unsubscribe.isError) {
    return (
      <PageShell>
        <StatusIcon variant="error" />
        <h1 className="text-2xl font-bold mt-6">Something went wrong</h1>
        <p className="text-muted-foreground mt-2 max-w-sm">
          We couldn&apos;t process your request. Please try again or reply to
          our email and we&apos;ll remove you manually.
        </p>
        <Button
          onClick={() => unsubscribe.mutate({ email })}
          className="mt-6"
        >
          Try again
        </Button>
      </PageShell>
    );
  }

  return (
    <PageShell>
      <StatusIcon variant="success" />
      <h1 className="text-2xl font-bold mt-6">You&apos;re unsubscribed</h1>
      <p className="text-muted-foreground mt-2 max-w-sm">
        <strong className="text-foreground">{email}</strong> has been removed
        from all Biviant emails. You won&apos;t hear from us again.
      </p>
      <div className="flex flex-col items-center gap-3 mt-8">
        <p className="text-sm text-muted-foreground">Changed your mind?</p>
        <Link to="/">
          <Button variant="outline" className="gap-2">
            <Mail className="size-4" />
            Re-join the waitlist
          </Button>
        </Link>
      </div>
    </PageShell>
  );
}

function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-[calc(100vh-4rem)] flex items-center justify-center bg-muted/20 px-4 py-12">
      <Card className="border-border shadow-lg max-w-md w-full">
        <CardContent className="flex flex-col items-center text-center p-10">
          {/* Logo */}
          <div className="flex items-center gap-2 mb-8">
            <div className="flex items-center justify-center size-9 rounded-lg bg-primary text-primary-foreground font-bold text-lg">
              B
            </div>
            <span className="text-xl font-bold">Biviant</span>
          </div>
          {children}
        </CardContent>
      </Card>
    </div>
  );
}

function StatusIcon({ variant }: { variant: "success" | "error" }) {
  if (variant === "success") {
    return (
      <div className="relative">
        <div className="flex items-center justify-center size-16 rounded-2xl bg-success/10">
          <CheckCircle className="size-8 text-success" />
        </div>
        <div className="absolute -bottom-1 -right-1 flex items-center justify-center size-7 rounded-full bg-muted border-2 border-card">
          <MailX className="size-3.5 text-muted-foreground" />
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-center size-16 rounded-2xl bg-destructive/10">
      <AlertCircle className="size-8 text-destructive" />
    </div>
  );
}
