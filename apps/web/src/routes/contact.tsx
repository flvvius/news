import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/contact")({
  component: ContactPage,
});

function ContactPage() {
  return (
    <section className="container mx-auto max-w-4xl px-4 py-12">
      <h1 className="text-3xl font-bold tracking-tight">Contact</h1>
      <p className="mt-4 text-muted-foreground">
        Pagină în construcție. Vom adăuga în curând detaliile de contact și
        canalele prin care ne poți scrie.
      </p>
    </section>
  );
}
