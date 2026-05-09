import { createFileRoute } from "@tanstack/react-router";
import { useT } from "@/lib/i18n/LocaleContext";

export const Route = createFileRoute("/politica-confidentialitate")({
  component: PoliticaConfidentialitatePage,
});

function PoliticaConfidentialitatePage() {
  const t = useT();

  return (
    <section className="container mx-auto max-w-4xl px-4 py-12">
      <h1 className="text-3xl font-bold tracking-tight">
        {t("page.privacy.title")}
      </h1>
      <p className="mt-4 text-muted-foreground">{t("page.privacy.body")}</p>
    </section>
  );
}
