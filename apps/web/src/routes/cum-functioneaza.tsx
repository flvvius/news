import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/cum-functioneaza")({
  component: CumFunctioneazaPage,
});

function CumFunctioneazaPage() {
  return (
    <section className="container mx-auto max-w-4xl px-4 py-12">
      <h1 className="text-3xl font-bold tracking-tight">Cum funcționează</h1>
      <p className="mt-4 text-muted-foreground">
        Pagină în construcție. Pregătim o explicație simplă despre feed,
        analiza de bias și comparația dintre surse.
      </p>
    </section>
  );
}
