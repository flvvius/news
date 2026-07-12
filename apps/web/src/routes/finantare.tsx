import { createFileRoute, Link } from "@tanstack/react-router";
import { StaticPage, StaticSection } from "@/components/layout/StaticPage";
import { BRAND_NAME } from "@/lib/i18n/strings";
import { staticPageHead } from "@/lib/seo";

export const Route = createFileRoute("/finantare")({
  head: () =>
    staticPageHead({
      title: `Cine finanțează ${BRAND_NAME} — ${BRAND_NAME}`,
      description: `De unde vin banii din spatele ${BRAND_NAME} și cum ne asigurăm că finanțarea nu influențează pozițiile afișate.`,
      path: "/finantare",
    }),
  component: FinantarePage,
});

// MIEZ-7: funding-transparency page. Deliberately does NOT invent business
// details (funders, amounts, legal entity) — those are filled in from real
// facts, see FOOTER_TODO.md. Structure + route are the deliverable.
export function FinantarePage() {
  return (
    <StaticPage
      title={`Cine finanțează ${BRAND_NAME}`}
      intro="Cine plătește un agregator de știri contează pentru cât de mult poți avea încredere în el, așa că spunem transparent de unde vin banii."
    >
      <StaticSection heading="Independență față de tabere">
        <p>
          {BRAND_NAME} nu este finanțat de partide politice, de candidați sau de
          instituții ale statului, și nu primește bani în schimbul poziției
          afișate pentru vreo publicație. Produsul este gratuit și poate fi
          folosit fără cont.
        </p>
      </StaticSection>

      <StaticSection heading="Modelul de finanțare">
        <p>
          {/* TODO(finanțare): completează cu detaliile reale ale modelului de
              finanțare (entitate, surse de venit, granturi) pe măsură ce sunt
              confirmate — fără cifre sau finanțatori inventați. */}
          Detaliile concrete despre modelul de finanțare și entitatea din spatele{" "}
          {BRAND_NAME} sunt publicate aici pe măsură ce sunt confirmate. Dacă
          apare o sursă de venit care ar putea crea un conflict de interese, o
          vom declara explicit pe această pagină.
        </p>
      </StaticSection>

      <StaticSection heading="Întrebări">
        <p>
          Pentru orice întrebare legată de finanțare ne poți scrie prin pagina de{" "}
          <Link to="/contact" className="underline hover:text-foreground">
            Contact
          </Link>
          .
        </p>
      </StaticSection>
    </StaticPage>
  );
}
