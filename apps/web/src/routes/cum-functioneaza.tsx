import { createFileRoute, Link } from "@tanstack/react-router";
import { api } from "@news-app/backend/convex/_generated/api";
import { StaticPage, StaticSection } from "@/components/layout/StaticPage";
import { BRAND_NAME } from "@/lib/i18n/strings";
import { faqPageJsonLd, staticPageHead } from "@/lib/seo";

// Manually bumped on every substantive edit of this page — a trust document
// should say when it was last reviewed. Update alongside content changes.
const LAST_REVIEWED = "10 iulie 2026";

/**
 * The Q&A pairs this page publishes as FAQPage structured data.
 *
 * Google requires a FAQPage answer to appear verbatim in the page's visible
 * text, so these are not a parallel copy: the sections below render
 * `question` as their heading and `answer` as their opening paragraph, and
 * the schema is built from the same constant. Only sections whose answer is a
 * single plain paragraph belong here — a paragraph carrying links or
 * interpolated counts cannot be reproduced as a flat string without drifting
 * from what is rendered, so those sections stay out of the schema rather than
 * ship an approximation.
 */
export const FAQ_ENTRIES = [
  {
    question: "Cum sunt grupate articolele pe evenimente?",
    answer:
      "Articolele care relatează același fapt — aceeași decizie, același incident, aceeași declarație — sunt grupate automat într-un „eveniment”, pe baza similarității semantice a titlurilor și fragmentelor. Așa poți vedea dintr-o privire câte surse acoperă o poveste și cum diferă relatările între ele.",
  },
  {
    question: "Cum este evaluată fiabilitatea — separat de orientare?",
    answer:
      "Pe lângă orientare, fiecare sursă primește un scor de fiabilitate de la 1 la 10: cât de consecvent publică informație factuală verificabilă. Cele două scoruri sunt independente — o publicație poate fi ferm orientată și totuși riguroasă cu faptele, sau „neutră” în ton și neglijentă cu ele. Sursele cu istoric documentat de dezinformare primesc scoruri de fiabilitate scăzute.",
  },
  {
    question: "Cum sunt generate rezumatele?",
    answer:
      "Pentru fiecare eveniment, sistemul generează automat un rezumat neutru al nucleului factual și, unde acoperirea o permite, câte un rezumat al formulării fiecărei părți. Rezumatele sunt produse de un model de limbaj instruit să folosească exclusiv materialul din articolele grupate, să atribuie afirmațiile surselor și să semnaleze dezacordurile în loc să aleagă în tăcere o variantă.",
  },
  {
    question: "Cum este ordonat feedul?",
    answer:
      "Fila „În tendințe” ordonează evenimentele după cât de multe surse și articole le acoperă, combinat cu recența; fila „Recente” arată strict cele mai noi actualizări. Nu ordonăm după emoție, engagement sau apartenență politică.",
  },
] as const;

/** Look up an entry by its question so a renamed heading fails loudly. */
function faq(question: (typeof FAQ_ENTRIES)[number]["question"]) {
  const entry = FAQ_ENTRIES.find((candidate) => candidate.question === question);
  if (!entry) throw new Error(`Unknown FAQ entry: ${question}`);
  return entry;
}

export const Route = createFileRoute("/cum-functioneaza")({
  loader: async ({ context }) => {
    const client =
      context.convexQueryClient.serverHttpClient ?? context.convexClient;
    try {
      const sources = await client.query(api.sources.listPublicSources, {});
      return { sourceCount: sources.length };
    } catch (error) {
      console.error("[Route loader] Failed to load source count:", error);
      return { sourceCount: null };
    }
  },
  head: () =>
    staticPageHead({
      title: `Cum funcționează — ${BRAND_NAME}`,
      description: `Cum colectează ${BRAND_NAME} știrile, cum grupează articolele pe evenimente și cum atribuie scoruri de orientare și fiabilitate surselor.`,
      path: "/cum-functioneaza",
      breadcrumb: [
        { name: BRAND_NAME, path: "/" },
        { name: "Cum funcționează", path: "/cum-functioneaza" },
      ],
      // The page is already written as questions with answers; publishing it
      // as FAQPage is what lets an answer engine quote "how does Miez decide
      // a source's leaning?" with attribution instead of paraphrasing it.
      jsonLd: [faqPageJsonLd(FAQ_ENTRIES, "/cum-functioneaza")],
    }),
  component: CumFunctioneazaRoute,
});

function CumFunctioneazaRoute() {
  const loaderData = Route.useLoaderData();
  return <CumFunctioneazaPage sourceCount={loaderData?.sourceCount ?? null} />;
}

// Router-free (prop-driven) so footer-pages.test.tsx can render it directly.
export function CumFunctioneazaPage({
  sourceCount = null,
}: {
  sourceCount?: number | null;
}) {
  return (
    <StaticPage
      title="Cum funcționează"
      intro="De la fluxurile RSS ale publicațiilor până la evenimentele cu perspective multiple din feed — pașii prin care trece fiecare știre, plus limitele pe care ni le asumăm."
    >
      <StaticSection heading={`De unde vin știrile din ${BRAND_NAME}?`}>
        <p>
          {BRAND_NAME} citește la intervale regulate fluxurile RSS publice ale{" "}
          {sourceCount ? (
            <>
              celor{" "}
              <Link to="/surse" className="underline hover:text-foreground">
                {sourceCount} publicații românești monitorizate
              </Link>
            </>
          ) : (
            <>
              publicațiilor românești{" "}
              <Link to="/surse" className="underline hover:text-foreground">
                monitorizate
              </Link>
            </>
          )}
          . Reținem titlul, un scurt fragment, data publicării și linkul
          canonic — lectura integrală se întâmplă întotdeauna pe site-ul
          publicației, iar textul integral al articolelor nu este stocat.
        </p>
      </StaticSection>

      <StaticSection heading={faq("Cum sunt grupate articolele pe evenimente?").question}>
        <p>{faq("Cum sunt grupate articolele pe evenimente?").answer}</p>
      </StaticSection>

      <StaticSection
        heading={`Cum decide ${BRAND_NAME} orientarea unei surse?`}
      >
        <p>
          Fiecare sursă are un scor pe axa{" "}
          <strong>reformist ↔ suveranist</strong>, atribuit inițial printr-o
          evaluare editorială documentată (cu note de proveniență afișate pe
          pagina de profil a sursei) și rafinat în timp de analiza automată a
          formulării articolelor. Acolo unde există, afișăm și categoria
          istorică{" "}
          <a
            href="https://mediabiasfactcheck.com"
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-foreground"
          >
            Media Bias/Fact Check
          </a>{" "}
          a publicației.
        </p>
        <p>
          Am ales axa reformist–suveranist pentru că este clivajul real al
          presei românești, mai relevant decât clasica axă stânga–dreapta.
          Scorul măsoară <strong>formularea</strong> relatărilor (ce vocabular
          și ce accente adoptă textul), nu subiectul acoperit și nu publicul
          publicației.
        </p>
        <p>
          Etichetele sunt descriptive, nu evaluative: „reformist” și
          „suveranist” sunt termeni pe care fiecare tabără și-i asumă singură,
          iar platforma nu prezintă niciuna dintre orientări drept cea
          corectă. Vizual, polii folosesc culori neutre (indigo și chihlimbar)
          cu greutate egală — fără roșu/albastru, fără conotații de bine/rău.
        </p>
      </StaticSection>

      <StaticSection
        heading={faq("Cum este evaluată fiabilitatea — separat de orientare?").question}
      >
        <p>
          {faq("Cum este evaluată fiabilitatea — separat de orientare?").answer}
        </p>
      </StaticSection>

      <StaticSection
        id="rezumate-ai"
        heading={faq("Cum sunt generate rezumatele?").question}
      >
        <p>{faq("Cum sunt generate rezumatele?").answer}</p>
        <p>
          <strong>Ce anume este generat de AI:</strong> rezumatul neutru,
          rezumatele celor două cadrări (reformistă și suveranistă) și
          secțiunea „Ce înseamnă asta” de pe pagina fiecărui eveniment sunt
          integral generate de inteligență artificială, fără verificare
          editorială umană independentă înainte de publicare. Titlurile și
          fragmentele articolelor listate sub rezumat aparțin publicațiilor
          originale și nu sunt generate de AI.
        </p>
        <p>
          <strong>Cum semnalăm asta:</strong> fiecare rezumat afișează o
          etichetă vizibilă („Rezumat generat de AI…”), iar paginile de
          eveniment includ o marcare și în format citibil de mașini
          (metadate schema.org cu tipul de sursă digitală IPTC{" "}
          <em>trainedAlgorithmicMedia</em>), conform obligațiilor de
          transparență din Regulamentul european privind inteligența
          artificială (art. 50).
        </p>
        <p>
          <strong>Limită importantă:</strong> rezumatele generate automat pot
          conține erori. De aceea articolele originale sunt legate direct de
          fiecare eveniment — verificarea sursei rămâne la un clic distanță,
          iar orice eroare poate fi semnalată prin linkul „Raportează o
          eroare” de lângă rezumat. Evenimentele care nu au încă un rezumat
          generat sunt tratate drept incomplete.
        </p>
      </StaticSection>

      <StaticSection heading={faq("Cum este ordonat feedul?").question}>
        <p>{faq("Cum este ordonat feedul?").answer}</p>
      </StaticSection>

      <StaticSection heading={`Ce nu face ${BRAND_NAME}?`}>
        <ul className="list-disc space-y-2 pl-5">
          <li>Nu scriem știri proprii și nu edităm articolele surselor.</li>
          <li>Nu ascundem și nu re-etichetăm sursele unei relatări.</li>
          <li>Nu stocăm textul integral al articolelor publicațiilor.</li>
          <li>
            Nu acceptăm plăți pentru scoruri sau poziționare — vezi și pagina{" "}
            <Link to="/parteneri" className="underline hover:text-foreground">
              Parteneri
            </Link>
            .
          </li>
        </ul>
        <p>
          Mai multe despre criteriile pentru surse găsești în pagina{" "}
          <Link
            to="/sursele-noastre"
            className="underline hover:text-foreground"
          >
            Sursele noastre
          </Link>
          .
        </p>
      </StaticSection>

      <p className="text-sm text-muted-foreground">
        Ultima revizuire: {LAST_REVIEWED}
      </p>
    </StaticPage>
  );
}
