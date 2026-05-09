import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/sursele-noastre")({
  component: SurseleNoastrePage,
});

function SurseleNoastrePage() {
  return (
    <section className="container mx-auto max-w-4xl px-4 py-12">
      <h1 className="text-3xl font-bold tracking-tight">Sursele noastre</h1>
      <p className="mt-4 text-muted-foreground">
        Pagină în construcție. În curând vei vedea cum selectăm sursele și cum
        construim perspectivele din feed.
      </p>
    </section>
  );
}
