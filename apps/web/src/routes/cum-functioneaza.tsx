import { createFileRoute, Link } from "@tanstack/react-router";
import { StaticPage, StaticSection } from "@/components/layout/StaticPage";
import { BRAND_NAME } from "@/lib/i18n/strings";

export const Route = createFileRoute("/cum-functioneaza")({
  head: () => ({
    meta: [
      { title: `Cum funcționează — ${BRAND_NAME}` },
      {
        name: "description",
        content: `Cum colectează ${BRAND_NAME} știrile, cum grupează articolele pe evenimente și cum atribuie scoruri de orientare și fiabilitate surselor.`,
      },
    ],
  }),
  component: CumFunctioneazaPage,
});

export function CumFunctioneazaPage() {
  return (
    <StaticPage
      title="Cum funcționează"
      intro="De la fluxurile RSS ale publicațiilor până la evenimentele cu perspective multiple din feed — pașii prin care trece fiecare știre."
    >
      <StaticSection heading="1. Colectăm articolele">
        <p>
          {BRAND_NAME} citește la intervale regulate fluxurile RSS publice ale
          publicațiilor românești monitorizate. Reținem titlul, un scurt
          fragment, data publicării și linkul canonic — lectura integrală se
          întâmplă întotdeauna pe site-ul publicației.
        </p>
      </StaticSection>

      <StaticSection heading="2. Grupăm pe evenimente">
        <p>
          Articolele care relatează același fapt — aceeași decizie, același
          incident, aceeași declarație — sunt grupate automat într-un
          „eveniment”. Așa poți vedea dintr-o privire câte surse acoperă o
          poveste și cum diferă relatările între ele.
        </p>
      </StaticSection>

      <StaticSection heading="3. Măsurăm orientarea">
        <p>
          Fiecare sursă are un scor pe axa{" "}
          <strong>reformist ↔ suveranist</strong> — clivajul real al presei
          românești, mai relevant decât clasica axă stânga–dreapta. Scorul
          măsoară <strong>formularea</strong> relatărilor (ce vocabular și ce
          accente adoptă textul), nu subiectul acoperit și nu publicul
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

      <StaticSection heading="4. Evaluăm fiabilitatea — separat">
        <p>
          Pe lângă orientare, fiecare sursă primește un scor de{" "}
          <strong>fiabilitate</strong>: cât de consecvent publică informație
          factuală verificabilă. Cele două scoruri sunt independente — o
          publicație poate fi ferm orientată și totuși riguroasă cu faptele,
          sau „neutră” în ton și neglijentă cu ele. Sursele cu istoric
          documentat de dezinformare primesc scoruri de fiabilitate scăzute.
        </p>
      </StaticSection>

      <StaticSection id="rezumate-ai" heading="5. Generăm rezumatele cu AI">
        <p>
          Pentru fiecare eveniment, sistemul generează automat un rezumat
          neutru al nucleului factual și, unde acoperirea o permite, câte un
          rezumat al formulării fiecărei părți. Rezumatele sunt produse de un
          model de limbaj instruit să folosească exclusiv materialul din
          articolele grupate, să atribuie afirmațiile surselor și să
          semnaleze dezacordurile în loc să aleagă în tăcere o variantă.
        </p>
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
          fiecare eveniment — verificarea sursei rămâne la un clic distanță —
          și orice eroare poate fi semnalată prin linkul „Raportează o
          eroare” de lângă rezumat.
        </p>
      </StaticSection>

      <StaticSection heading="6. Ordonăm feedul">
        <p>
          Fila „În tendințe” ordonează evenimentele după cât de multe surse și
          articole le acoperă, combinat cu recența; fila „Recente” arată strict
          cele mai noi actualizări. Nu ordonăm după emoție, engagement sau
          apartenență politică.
        </p>
      </StaticSection>

      <StaticSection heading="Ce nu facem">
        <ul className="list-disc space-y-2 pl-5">
          <li>Nu scriem știri proprii și nu edităm articolele surselor.</li>
          <li>Nu ascundem și nu re-etichetăm sursele unei relatări.</li>
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
    </StaticPage>
  );
}
