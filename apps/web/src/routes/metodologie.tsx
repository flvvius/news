import { createFileRoute, Link } from "@tanstack/react-router";
import { StaticPage, StaticSection } from "@/components/layout/StaticPage";
import { BRAND_NAME } from "@/lib/i18n/strings";
import { staticPageHead } from "@/lib/seo";

export const Route = createFileRoute("/metodologie")({
  head: () =>
    staticPageHead({
      title: `Metodologie — ${BRAND_NAME}`,
      description: `Cum așază ${BRAND_NAME} sursele pe axa reformist–suveranist: la nivel de publicație, nu de articol, separat de scorul de fiabilitate, și cum poate fi contestată o poziționare.`,
      path: "/metodologie",
      breadcrumb: [
        { name: BRAND_NAME, path: "/" },
        { name: "Metodologie", path: "/metodologie" },
      ],
    }),
  component: MetodologiePage,
});

// MIEZ-7: methodology page. Content is written directly in Romanian (product
// language), like the other static footer pages (BIV-803). Editable here
// without touching shared components; kept indexable (no noindex).
export function MetodologiePage() {
  return (
    <StaticPage
      title="Metodologie"
      intro={`Cum decide ${BRAND_NAME} unde stă fiecare sursă pe axa reformist–suveranist și ce înseamnă — și ce nu înseamnă — acea poziție.`}
    >
      <StaticSection heading="Poziția e la nivel de publicație, nu de articol">
        <p>
          Fiecare sursă primește o singură poziție pe axa reformist–suveranist,
          la nivel de publicație. Nu punctăm fiecare articol în parte: un titlu
          anume nu mută publicația pe axă. Poziția reflectă orientarea editorială
          generală, așa cum reiese din acoperirea repetată a subiectelor
          politice, nu dintr-o singură relatare.
        </p>
      </StaticSection>

      <StaticSection heading="Orientarea e separată de fiabilitate">
        <p>
          Poziția pe axă este descriptivă, nu evaluativă: spune din ce direcție
          vine relatarea, nu dacă e „bună” sau „rea”. Scorul de fiabilitate al
          unei publicații se atribuie complet separat — o sursă nu devine mai
          credibilă sau mai puțin credibilă pentru că înclină într-o direcție
          sau alta. Cele două scoruri nu se influențează reciproc.
        </p>
      </StaticSection>

      <StaticSection heading="Axa e calculată, nu decretată">
        <p>
          Poziția unei surse pe axă e calculată din semnale despre acoperirea ei,
          nu stabilită prin decizia editorială a {BRAND_NAME}. Centrul axei este
          zona neutră; capetele marchează cele două tabere, reformistă și
          suveranistă, tratate cu aceeași greutate vizuală. Niciun capăt nu e
          „poziția implicită” sau „cea corectă”.
        </p>
      </StaticSection>

      <StaticSection heading="Cum contești o poziționare">
        <p>
          Dacă reprezinți o publicație și consideri că poziția afișată nu îți
          reflectă corect acoperirea, ne poți scrie prin pagina de{" "}
          <Link to="/contact" className="underline hover:text-foreground">
            Contact
          </Link>
          . Analizăm fiecare contestație pe baza acoperirii concrete și
          corectăm poziția dacă semnalele o justifică.
        </p>
      </StaticSection>
    </StaticPage>
  );
}
