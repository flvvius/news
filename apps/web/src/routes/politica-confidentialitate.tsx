import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/politica-confidentialitate")({
  component: PoliticaConfidentialitatePage,
});

function PoliticaConfidentialitatePage() {
  return (
    <section className="container mx-auto max-w-4xl px-4 py-12">
      <h1 className="text-3xl font-bold tracking-tight">
        Politica de confidențialitate
      </h1>
      <p className="mt-4 text-muted-foreground">
        Pagină în construcție. Vom publica aici informațiile despre datele
        colectate, utilizare și drepturile tale.
      </p>
    </section>
  );
}
