import { createFileRoute } from "@tanstack/react-router";
import { useT } from "@/lib/i18n/LocaleContext";

export const Route = createFileRoute("/cum-functioneaza")({
  component: CumFunctioneazaPage,
});

function CumFunctioneazaPage() {
  const t = useT();

  return (
    <section className="container mx-auto max-w-4xl px-4 py-12">
      <h1 className="text-3xl font-bold tracking-tight">
        {t("page.how.title")}
      </h1>
      <p className="mt-4 text-muted-foreground">{t("page.how.body")}</p>
    </section>
  );
}
