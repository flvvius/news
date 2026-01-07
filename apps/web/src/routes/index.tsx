import { createFileRoute } from "@tanstack/react-router";
import { useConvexAuth } from "@convex-dev/react-query";

export const Route = createFileRoute("/")({
  component: HomeComponent,
});

function HomeComponent() {
  const { isLoading, isAuthenticated } = useConvexAuth();

  if (isLoading) {
    return <div>Loading...</div>;
  }

  if (isAuthenticated) {
    return <h1>hi, there!</h1>;
  }

  return <div className="container mx-auto max-w-3xl px-4 py-2">HELLO</div>;
}
