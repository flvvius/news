import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/parteneri")({
  component: ParteneriPage,
});

function ParteneriPage() {
  return (
    <section className="container mx-auto max-w-4xl px-4 py-12">
      <h1 className="text-3xl font-bold tracking-tight">Parteneri</h1>
      <p className="mt-4 text-muted-foreground">
        Pagină în construcție. Aici vor apărea partenerii, colaborările și
        inițiativele susținute de Biviant.
      </p>
    </section>
  );
}
