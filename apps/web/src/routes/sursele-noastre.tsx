import { createFileRoute, Link } from "@tanstack/react-router";
import { StaticPage, StaticSection } from "@/components/layout/StaticPage";
import { BRAND_NAME } from "@/lib/i18n/strings";
import { staticPageHead } from "@/lib/seo";

export const Route = createFileRoute("/sursele-noastre")({
  head: () =>
    staticPageHead({
      title: `Sursele noastre — ${BRAND_NAME}`,
      description: `Cum alege ${BRAND_NAME} publicațiile monitorizate și cum sunt atribuite scorurile de orientare și fiabilitate pentru fiecare sursă.`,
      path: "/sursele-noastre",
      breadcrumb: [
        { name: BRAND_NAME, path: "/" },
        { name: "Sursele noastre", path: "/sursele-noastre" },
      ],
    }),
  component: SurseleNoastrePage,
});

export function SurseleNoastrePage() {
  return (
    <StaticPage
      title="Sursele noastre"
      intro={`${BRAND_NAME} monitorizează publicații românești de știri din întreg spectrul reformist–suveranist. Iată cum le alegem și cum le evaluăm.`}
    >
      <StaticSection heading="Criterii de includere">
        <ul className="list-disc space-y-2 pl-5">
          <li>
            publicație românească de actualitate, cu flux RSS public și
            funcțional;
          </li>
          <li>
            publicare regulată de conținut propriu (nu doar preluări
            automate);
          </li>
          <li>
            identitate editorială identificabilă — cine publică și de unde.
          </li>
        </ul>
        <p>
          Fluxurile care devin instabile sau nu mai pot fi citite sunt puse în
          carantină până redevin funcționale, ca să nu afecteze acoperirea
          evenimentelor.
        </p>
      </StaticSection>

      <StaticSection heading="Două scoruri, atribuite separat">
        <p>
          Fiecare sursă primește un scor de <strong>orientare</strong> pe axa
          reformist–suveranist și un scor de <strong>fiabilitate</strong> —
          cât de consecvent publică informație factuală verificabilă. Cele
          două sunt independente prin construcție: orientarea nu ridică și nu
          coboară fiabilitatea. O publicație ferm orientată poate fi riguroasă
          cu faptele; una „echilibrată” în ton poate fi neglijentă cu ele.
        </p>
        <p>
          Scorurile de orientare pornesc de la o evaluare documentată a
          fiecărei publicații (cu note de proveniență) și sunt rafinate în
          timp de analiza automată a formulării articolelor. Principiile
          metodologiei sunt descrise în{" "}
          <Link
            to="/cum-functioneaza"
            className="underline hover:text-foreground"
          >
            Cum funcționează
          </Link>
          .
        </p>
      </StaticSection>

      <StaticSection heading="Echilibrul mixului de surse">
        <p>
          Urmărim ca ambii poli ai axei să fie reprezentați real în feed, ca
          să poți compara formulările — dar echilibrul nu se obține niciodată
          cu prețul fiabilității. Publicațiile cu istoric documentat de
          dezinformare fie primesc explicit un scor de fiabilitate foarte
          scăzut, fie nu sunt incluse deloc ca surse credibile; nu li se
          atribuie niciodată o fiabilitate „neutră” doar pentru a echilibra
          aritmetic spectrul.
        </p>
      </StaticSection>

      <StaticSection heading="Transparență per sursă">
        <p>
          Fiecare publicație are o pagină de profil în aplicație, cu scorul de
          fiabilitate, media orientării estimate pe articolele recente și
          relatările ei recente — o poți deschide dând clic pe numele sursei
          oriunde apare, sau din{" "}
          <Link to="/surse" className="underline hover:text-foreground">
            lista completă a surselor monitorizate
          </Link>
          .
        </p>
      </StaticSection>

      <StaticSection heading="Corecții">
        <p>
          Reprezinți o publicație și consideri că scorul afișat este greșit?
          Scrie-ne prin pagina de{" "}
          <Link to="/contact" className="underline hover:text-foreground">
            Contact
          </Link>{" "}
          — argumentele documentate duc la reevaluare.
        </p>
      </StaticSection>
    </StaticPage>
  );
}
