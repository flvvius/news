import { createFileRoute, Link } from "@tanstack/react-router";
import { StaticPage, StaticSection } from "@/components/layout/StaticPage";
import { BRAND_NAME } from "@/lib/i18n/strings";
import { staticPageHead } from "@/lib/seo";

export const Route = createFileRoute("/parteneri")({
  head: () =>
    staticPageHead({
      title: `Parteneri — ${BRAND_NAME}`,
      description: `Colaborări ${BRAND_NAME}: publicații, organizații de educație media și cercetători interesați de pluralismul surselor de știri.`,
      path: "/parteneri",
    }),
  component: ParteneriPage,
});

export function ParteneriPage() {
  return (
    <StaticPage
      title="Parteneri"
      intro={`${BRAND_NAME} este la început de drum: nu avem încă parteneriate anunțate public, dar suntem deschiși la colaborări care servesc aceluiași scop — un consum de știri mai echilibrat.`}
    >
      <StaticSection heading="Publicații">
        <p>
          {BRAND_NAME} trimite cititori către articolele originale: afișăm titlul,
          un scurt fragment și sursa, iar lectura integrală se întâmplă pe
          site-ul publicației. Folosim fluxurile RSS publice și respectăm
          regulile de acces ale fiecărui site.
        </p>
        <p>
          Dacă reprezinți o publicație și vrei să discutăm — despre modul în
          care apare publicația ta, despre fluxuri dedicate sau despre orice
          altă formă de colaborare — scrie-ne prin pagina de{" "}
          <Link to="/contact" className="underline hover:text-foreground">
            Contact
          </Link>
          .
        </p>
      </StaticSection>

      <StaticSection heading="Educație media și cercetare">
        <p>
          Modul în care {BRAND_NAME} clasifică orientarea și fiabilitatea surselor
          este explicat public în paginile platformei, iar datele agregate despre acoperirea
          evenimentelor pot fi utile organizațiilor de educație media,
          jurnaliștilor și cercetătorilor care studiază peisajul media
          românesc. Dacă lucrezi într-una dintre aceste zone, ne-ar bucura să
          te auzim.
        </p>
      </StaticSection>

      <StaticSection heading="Ce nu facem">
        <p>
          Nu vindem poziționare editorială: niciun partener — actual sau
          viitor — nu poate cumpăra un scor de orientare mai „bun”, un scor
          de fiabilitate mai mare sau o poziție privilegiată în feed.
          Independența clasificărilor este condiția de existență a
          produsului.
        </p>
      </StaticSection>
    </StaticPage>
  );
}
