import { AnonymousProfile } from "@/components/profile/AnonymousProfile";
import { AuthenticatedProfile } from "@/components/profile/AuthenticatedProfile";
import { PageLoadingState } from "@/components/ui/page-loading-state";
import { api } from "@news-app/backend/convex/_generated/api";
import { createFileRoute } from "@tanstack/react-router";
import { useConvexAuth, useQuery } from "convex/react";

export const Route = createFileRoute("/profil")({
  head: () => ({
    meta: [{ title: "Profil — Biviant" }],
  }),
  component: ProfilPage,
});

function ProfilPage() {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const user = useQuery(api.user.getCurrentUser);

  if (isLoading || (isAuthenticated && user === undefined)) {
    return (
      <PageLoadingState
        title="Se pregătește profilul"
        description="Încărcăm preferințele și detaliile contului tău."
        cardCount={2}
      />
    );
  }

  if (isAuthenticated && user) {
    return <AuthenticatedProfile user={user} />;
  }

  return <AnonymousProfile />;
}
