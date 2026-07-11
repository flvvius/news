import { createFileRoute } from "@tanstack/react-router";
import { StaticPage, StaticSection } from "@/components/layout/StaticPage";
import { BRAND_NAME } from "@/lib/i18n/strings";
import { staticPageHead } from "@/lib/seo";

export const Route = createFileRoute("/politica-confidentialitate")({
  head: () =>
    staticPageHead({
      title: `Politica de confidențialitate — ${BRAND_NAME}`,
      description: `Ce date colectează ${BRAND_NAME}, cu ce scop, cine le procesează și ce drepturi ai asupra lor.`,
      path: "/politica-confidentialitate",
    }),
  component: PoliticaConfidentialitatePage,
});

export function PoliticaConfidentialitatePage() {
  return (
    <StaticPage
      title="Politica de confidențialitate"
      intro={`Pe scurt: poți citi ${BRAND_NAME} fără cont; un cont adaugă funcții personale, iar datele tale rămân ale tale — le poți șterge oricând, complet.`}
    >
      {/* <StaticSection heading="Cine este operatorul">
        <p>
          Operatorul datelor este {"{{TODO: entitate juridică}}"}, cu sediul
          la {"{{TODO: adresă sediu}}"}. Pentru orice cerere legată de datele
          tale ne poți scrie la {"{{TODO: adresă de e-mail de contact}}"} sau
          prin pagina de{" "}
          <Link to="/contact" className="underline hover:text-foreground">
            Contact
          </Link>
          .
        </p>
      </StaticSection> */}

      <StaticSection heading="Ce date colectăm">
        <ul className="list-disc space-y-2 pl-5">
          <li>
            <strong>Fără cont:</strong> date tehnice minime necesare
            funcționării (loguri de server) și statistici de utilizare agregate,
            pseudonimizate, colectate prin PostHog (găzduit în Uniunea
            Europeană).
          </li>
          <li>
            <strong>Cu cont:</strong> adresa de e-mail, numele ales și parola
            (stocată exclusiv criptografic) — sau, dacă alegi autentificarea cu
            Google ori Apple, identificatorul și adresa de e-mail confirmate de
            furnizorul respectiv.
          </li>
          <li>
            <strong>Activitatea de citire</strong> (doar cu cont): ce evenimente
            deschizi, ce salvezi, timpul estimat de lectură și profunzimea
            derulării. Acestea alimentează funcțiile tale personale: salvările,
            seriile de zile de lectură și balanța de perspective.
          </li>
        </ul>
        <p>
          Nu vindem date personale și nu afișăm publicitate bazată pe profilare.
        </p>
      </StaticSection>

      <StaticSection heading="Cookie-uri și tehnologii similare">
        <p>
          Folosim cookie-uri strict necesare pentru sesiunea de autentificare și
          pentru preferințe (de exemplu limba aleasă), plus identificatori de
          analiză pseudonimizați pentru statistici de utilizare. Nu folosim
          cookie-uri de publicitate ale terților.
        </p>
      </StaticSection>

      <StaticSection heading="Cine ne ajută să procesăm datele">
        <p>
          Folosim furnizori de infrastructură care procesează date în numele
          nostru: Convex (baza de date a aplicației), Vercel (găzduirea
          aplicației web), PostHog (analiză de utilizare, instanța din UE) și
          Resend (trimiterea e-mailurilor tranzacționale — verificare de cont,
          resetare de parolă). Autentificarea cu Google sau Apple implică
          furnizorul ales de tine, în condițiile lui de confidențialitate.
        </p>
      </StaticSection>

      <StaticSection heading="Cât timp păstrăm datele">
        <p>
          Datele contului și activitatea de citire se păstrează cât timp există
          contul. Conturile create cu e-mail și neverificate se șterg automat
          după 7 zile. Ștergerea contului o poți solicita din pagina de profil
          sau printr-o cerere scrisă; la ștergere se elimină datele asociate —
          profilul, salvările, istoricul de lectură și statisticile — și se
          declanșează cererea de ștergere a identității tale de analiză din
          PostHog.
        </p>
      </StaticSection>

      <StaticSection heading="Drepturile tale">
        <p>
          Conform Regulamentului (UE) 2016/679 (GDPR), ai dreptul de acces,
          rectificare, ștergere, restricționare, portabilitate și opoziție,
          precum și dreptul de a depune o plângere la Autoritatea Națională de
          Supraveghere a Prelucrării Datelor cu Caracter Personal (ANSPDCP).
          Pentru exercitarea drepturilor, folosește datele de contact de mai
          sus.
        </p>
      </StaticSection>

      <StaticSection heading="Modificări ale politicii">
        <p>
          Vom anunța modificările substanțiale ale acestei politici în
          aplicație. Versiunea curentă este în vigoare de la 07.07.2026.
        </p>
      </StaticSection>
    </StaticPage>
  );
}
