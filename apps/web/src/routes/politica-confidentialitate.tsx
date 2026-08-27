import { createFileRoute, Link } from "@tanstack/react-router";
import { RETENTION_POLICY } from "@news-app/backend/convex/lib/retentionPolicy";
import { StaticPage, StaticSection } from "@/components/layout/StaticPage";
import { BRAND_NAME } from "@/lib/i18n/strings";
import { staticPageHead } from "@/lib/seo";

export const Route = createFileRoute("/politica-confidentialitate")({
  head: () =>
    staticPageHead({
      title: `Politica de confidențialitate — ${BRAND_NAME}`,
      description: `Ce date colectează ${BRAND_NAME}, cu ce scop, cine le procesează și ce drepturi ai asupra lor.`,
      path: "/politica-confidentialitate",
      breadcrumb: [
        { name: BRAND_NAME, path: "/" },
        { name: "Politica de confidențialitate", path: "/politica-confidentialitate" },
      ],
    }),
  component: PoliticaConfidentialitatePage,
});

export function PoliticaConfidentialitatePage() {
  return (
    <StaticPage
      title="Politica de confidențialitate"
      intro={`Pe scurt: poți citi ${BRAND_NAME} fără cont; un cont adaugă funcții personale, iar datele tale rămân ale tale — le poți șterge oricând, complet.`}
    >
      <StaticSection heading="Cum ne contactezi pentru datele tale">
        <p>
          Pentru orice cerere legată de datele tale ne poți scrie prin pagina
          de{" "}
          <Link to="/contact" className="underline hover:text-foreground">
            Contact
          </Link>
          , punctul nostru unic de contact — inclusiv prin formularul
          „Raportează o eroare” din pagina fiecărui eveniment.
        </p>
      </StaticSection>

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
          La o simplă vizită nu setăm niciun cookie și nicio intrare de
          stocare locală în afara poziției de derulare (sessionStorage,
          funcțională, fără identificatori). Analiza de utilizare (PostHog,
          instanța din UE) rulează complet fără cookie-uri și fără stocare
          locală — de aceea nu ai nevoie de un banner de consimțământ.
        </p>
        <p>
          Doar după acțiuni explicite apar: cookie-urile de sesiune la
          autentificare (strict necesare), preferința de limbă, preferința de
          temă și lista căutărilor recente. Inventarul complet este documentat
          în depozitul proiectului (docs/compliance-storage-inventory.md). Nu
          folosim cookie-uri de publicitate ale terților.
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
          Datele contului se păstrează cât timp există contul; ștergerea o
          faci direct din pagina de profil (imediată și completă, inclusiv
          cererea de ștergere a identității tale de analiză din PostHog) sau
          printr-o cerere scrisă. Perioadele de mai jos sunt aplicate automat
          de joburi zilnice de minimizare și provin din aceeași configurație
          pe care o rulează serverul:
        </p>
        <ul className="list-disc space-y-2 pl-5">
          <li>
            Conturi create cu e-mail și neverificate:{" "}
            <strong>{RETENTION_POLICY.unverifiedAccountDays} zile</strong>.
          </li>
          <li>
            Înscrieri în lista de așteptare fără nicio activitate:{" "}
            <strong>{RETENTION_POLICY.waitlistUnengagedDays} de zile</strong>.
          </li>
          <li>
            Istoricul de lectură:{" "}
            <strong>
              {Math.round(RETENTION_POLICY.readingHistoryDays / 30.44)} luni
            </strong>
            .
          </li>
          <li>
            Analize personalizate („Ce înseamnă pentru tine”):{" "}
            <strong>{RETENTION_POLICY.userInsightsDays} de zile</strong>.
          </li>
          <li>
            Textul integral al articolelor presei:{" "}
            <strong>nu este stocat niciodată</strong> — este folosit doar
            trecător la generarea rezumatelor.
          </li>
        </ul>
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
