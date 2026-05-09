import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/despre")({
  component: DesprePage,
});

function DesprePage() {
  return (
    <section className="container mx-auto max-w-4xl px-4 py-12">
      <h1 className="text-3xl font-bold tracking-tight">Despre noi</h1>
      <p className="mt-4 text-muted-foreground">
        Pagină în construcție. Pregătim o prezentare scurtă despre Biviant și
        misiunea noastră.
      </p>
    </section>
  );
}
