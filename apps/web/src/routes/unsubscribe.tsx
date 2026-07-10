import { useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";
import { useConvexMutation } from "@convex-dev/react-query";
import { api } from "@news-app/backend/convex/_generated/api";
import { z } from "zod";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { getLocaleFromMatches } from "@/lib/i18n/getLocaleFromMatches";
import { useT } from "@/lib/i18n/LocaleContext";
import { getString } from "@/lib/i18n/strings";
import { BrandLogo } from "@/components/BrandLogo";
import {
  AlertCircle,
  CheckCircle,
  Loader2,
  Mail,
  MailX,
} from "lucide-react";

const searchSchema = z.object({
  email: z.string().optional(),
  // L12 — one-click token unsubscribe (no login, no e-mail in the URL).
  token: z.string().optional(),
});

export const Route = createFileRoute("/unsubscribe")({
  validateSearch: searchSchema,
  head: ({ matches }) => {
    const locale = getLocaleFromMatches(matches);

    return {
      meta: [
        { title: getString(locale, "unsubscribe.meta.title") },
        { name: "robots", content: "noindex, nofollow" },
      ],
    };
  },
  component: UnsubscribePage,
});

function UnsubscribePage() {
  const t = useT();
  const { email, token } = Route.useSearch();
  const [lastEmail, setLastEmail] = useState<string | undefined>(undefined);
  const [tokenEmail, setTokenEmail] = useState<string | undefined>(undefined);

  const unsubscribe = useMutation({
    mutationFn: useConvexMutation(api.waitlist.unsubscribe),
  });
  const unsubscribeByToken = useMutation({
    mutationFn: useConvexMutation(api.waitlist.unsubscribeByToken),
  });
  const { reset } = unsubscribe;

  useEffect(() => {
    if (email !== lastEmail) {
      reset();
      setLastEmail(email);
    }
  }, [email, lastEmail, reset]);

  useEffect(() => {
    if (
      !email ||
      token ||
      unsubscribe.isPending ||
      unsubscribe.isSuccess ||
      unsubscribe.isError
    )
      return;

    unsubscribe.mutate({ email });
  }, [
    email,
    token,
    unsubscribe.isPending,
    unsubscribe.isSuccess,
    unsubscribe.isError,
  ]);

  // Token path takes priority: works with zero knowledge of the address.
  useEffect(() => {
    if (
      !token ||
      unsubscribeByToken.isPending ||
      unsubscribeByToken.isSuccess ||
      unsubscribeByToken.isError
    )
      return;

    unsubscribeByToken.mutate(
      { token },
      {
        onSuccess: (result: { success: boolean; email?: string }) => {
          if (result.success) setTokenEmail(result.email);
        },
      },
    );
  }, [
    token,
    unsubscribeByToken.isPending,
    unsubscribeByToken.isSuccess,
    unsubscribeByToken.isError,
  ]);

  if (token) {
    if (unsubscribeByToken.isError) {
      return (
        <PageShell>
          <StatusIcon variant="error" />
          <h1 className="text-2xl font-bold mt-6">
            {t("unsubscribe.errorTitle")}
          </h1>
          <p className="text-muted-foreground mt-2 max-w-sm">
            {t("unsubscribe.errorBody")}
          </p>
        </PageShell>
      );
    }
    if (!unsubscribeByToken.isSuccess) {
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
            {t("unsubscribe.loading")}
          </p>
        </PageShell>
      );
    }
    const tokenResult = unsubscribeByToken.data as {
      success: boolean;
      email?: string;
    };
    if (!tokenResult.success) {
      return (
        <PageShell>
          <StatusIcon variant="error" />
          <h1 className="text-2xl font-bold mt-6">
            {t("unsubscribe.invalidTitle")}
          </h1>
          <p className="text-muted-foreground mt-2 max-w-sm">
            {t("unsubscribe.invalidBody")}
          </p>
        </PageShell>
      );
    }
    return (
      <PageShell>
        <StatusIcon variant="success" />
        <h1 className="text-2xl font-bold mt-6">
          {t("unsubscribe.successTitle")}
        </h1>
        <p className="text-muted-foreground mt-2 max-w-sm">
          {t("unsubscribe.successBody").replace(
            "{email}",
            tokenEmail ?? "…",
          )}
        </p>
        <div className="flex flex-col items-center gap-3 mt-8">
          <p className="text-sm text-muted-foreground">
            {t("unsubscribe.changedMind")}
          </p>
          <Button asChild variant="outline" className="gap-2">
            <Link to="/">
              <Mail className="size-4" />
              {t("unsubscribe.rejoin")}
            </Link>
          </Button>
        </div>
      </PageShell>
    );
  }

  if (!email) {
    return (
      <PageShell>
        <StatusIcon variant="error" />
        <h1 className="text-2xl font-bold mt-6">
          {t("unsubscribe.invalidTitle")}
        </h1>
        <p className="text-muted-foreground mt-2 max-w-sm">
          {t("unsubscribe.invalidBody")}
        </p>
        <Button asChild variant="outline" className="mt-6">
          <Link to="/">{t("unsubscribe.goHome")}</Link>
        </Button>
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
          {t("unsubscribe.loading")}
        </p>
      </PageShell>
    );
  }

  if (unsubscribe.isError) {
    return (
      <PageShell>
        <StatusIcon variant="error" />
        <h1 className="text-2xl font-bold mt-6">
          {t("unsubscribe.errorTitle")}
        </h1>
        <p className="text-muted-foreground mt-2 max-w-sm">
          {t("unsubscribe.errorBody")}
        </p>
        <Button
          onClick={() => unsubscribe.mutate({ email })}
          className="mt-6"
        >
          {t("unsubscribe.retry")}
        </Button>
      </PageShell>
    );
  }

  return (
    <PageShell>
      <StatusIcon variant="success" />
      <h1 className="text-2xl font-bold mt-6">
        {t("unsubscribe.successTitle")}
      </h1>
      <p className="text-muted-foreground mt-2 max-w-sm">
        {t("unsubscribe.successBody").replace("{email}", email)}
      </p>
      <div className="flex flex-col items-center gap-3 mt-8">
        <p className="text-sm text-muted-foreground">
          {t("unsubscribe.changedMind")}
        </p>
        <Button asChild variant="outline" className="gap-2">
          <Link to="/">
            <Mail className="size-4" />
            {t("unsubscribe.rejoin")}
          </Link>
        </Button>
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
          <BrandLogo className="h-8 mb-8" />
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
