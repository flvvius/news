import { AnonymousProfile } from "@/components/profile/AnonymousProfile";
import { AuthenticatedProfile } from "@/components/profile/AuthenticatedProfile";
import { PageLoadingState } from "@/components/ui/page-loading-state";
import { useT } from "@/lib/i18n/LocaleContext";
import { getString } from "@/lib/i18n/strings";
import { api } from "@news-app/backend/convex/_generated/api";
import { createFileRoute } from "@tanstack/react-router";
import { useConvexAuth, useQuery } from "convex/react";

export const Route = createFileRoute("/profil")({
  head: ({ matches }) => {
    const locale =
      matches[0]?.context &&
      typeof matches[0].context === "object" &&
      "locale" in matches[0].context &&
      (matches[0].context.locale === "ro" || matches[0].context.locale === "en")
        ? matches[0].context.locale
        : "en";

    return {
      meta: [{ title: getString(locale, "profile.metaTitle") }],
    };
  },
  component: ProfilPage,
});

function ProfilPage() {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const user = useQuery(api.user.getCurrentUser);
  const t = useT();

  if (isLoading || (isAuthenticated && user === undefined)) {
    return (
      <PageLoadingState
        title={t("profile.preparing.title")}
        description={t("profile.preparing.body")}
        cardCount={2}
      />
    );
  }

  if (isAuthenticated && user) {
    return <AuthenticatedProfile user={user} />;
  }

  return <AnonymousProfile />;
}
