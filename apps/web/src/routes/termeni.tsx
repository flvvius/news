import { createFileRoute, Link } from "@tanstack/react-router";
import { StaticPage, StaticSection } from "@/components/layout/StaticPage";
import { BRAND_NAME } from "@/lib/i18n/strings";

export const Route = createFileRoute("/termeni")({
  head: () => ({
    meta: [
      { title: `Termeni și condiții — ${BRAND_NAME}` },
      {
        name: "description",
        content: `Condițiile de utilizare a platformei ${BRAND_NAME}: ce oferă serviciul, ce reguli se aplică și care sunt limitele răspunderii.`,
      },
    ],
  }),
  component: TermeniPage,
});

export function TermeniPage() {
  return (
    <StaticPage
      title="Termeni și condiții"
      intro={`Folosind ${BRAND_NAME} accepți condițiile de mai jos. Le-am scris cât mai simplu cu putință.`}
    >
      <StaticSection heading="Ce este serviciul">
        <p>
          {BRAND_NAME} este un agregator de știri: colectează articole din
          fluxurile publice ale publicațiilor românești, le grupează pe
          evenimente, afișează informații despre orientarea și fiabilitatea
          surselor și generează automat rezumate. Serviciul este oferit „ca
          atare”, fără garanții de disponibilitate neîntreruptă sau de
          exhaustivitate a acoperirii.
        </p>
      </StaticSection>

      <StaticSection heading="Conținutul publicațiilor">
        <p>
          Articolele aparțin publicațiilor care le-au scris. {BRAND_NAME}{" "}
          afișează titluri, fragmente scurte și metadate, cu link direct către
          articolul original — nu republică texte integrale. Dacă reprezinți o
          publicație și ai obiecții privind modul de afișare, scrie-ne prin
          pagina de{" "}
          <Link to="/contact" className="underline hover:text-foreground">
            Contact
          </Link>{" "}
          și rezolvăm.
        </p>
      </StaticSection>

      <StaticSection heading="Rezumatele și scorurile">
        <p>
          Rezumatele sunt generate automat și pot conține erori sau omisiuni;
          ele nu înlocuiesc lectura articolelor originale. Scorurile de
          orientare și fiabilitate sunt evaluări metodologice — opinii
          documentate, nu constatări oficiale — și sunt explicate în pagina{" "}
          <Link
            to="/cum-functioneaza"
            className="underline hover:text-foreground"
          >
            Cum funcționează
          </Link>
          .
        </p>
      </StaticSection>

      <StaticSection heading="Contul tău">
        <p>
          Contul este gratuit și opțional. Ești responsabil de
          confidențialitatea datelor de autentificare și de activitatea din
          contul tău. Ne rezervăm dreptul de a suspenda conturile folosite
          abuziv — de exemplu pentru acces automatizat excesiv, încercări de
          fraudare a autentificării sau perturbarea serviciului.
        </p>
      </StaticSection>

      <StaticSection heading="Utilizare acceptabilă">
        <ul className="list-disc space-y-2 pl-5">
          <li>
            nu accesa serviciul prin mijloace automate care îi afectează
            funcționarea;
          </li>
          <li>
            nu încerca să ocolești măsurile de securitate sau de limitare a
            accesului;
          </li>
          <li>
            nu prezenta conținutul {BRAND_NAME} în moduri care induc în eroare
            cu privire la sursa lui.
          </li>
        </ul>
      </StaticSection>

      <StaticSection heading="Răspundere">
        <p>
          În limitele permise de lege, nu răspundem pentru decizii luate pe baza
          conținutului agregat sau al rezumatelor generate automat, nici pentru
          conținutul site-urilor către care trimitem prin linkuri. Nimic din
          acești termeni nu limitează drepturile pe care legea ți le garantează
          în calitate de consumator.
        </p>
      </StaticSection>

      <StaticSection heading="Semnalarea conținutului și corecții (DSA)">
        <p>
          Orice eveniment are un buton „Raportează o eroare” — poți semnala
          erori factuale, posibile defăimări, probleme de drepturi de autor
          sau conținut ilegal, cu sau fără date de contact. Fiecare raport
          primește o decizie motivată (respingere, corectare sau retragerea
          conținutului), iar dacă ai lăsat un contact, primești decizia pe
          e-mail. Conținutul retras dispare imediat din platformă.
        </p>
        <p>
          Nu sunt permise pe platformă: conținut ilegal, abuz asupra
          mecanismului de raportare (rapoarte vădit nefondate, repetate) sau
          încercări de a manipula sistemele automate. Punctul de contact
          pentru utilizatori și autorități este pagina de{" "}
          <Link to="/contact" className="underline hover:text-foreground">
            Contact
          </Link>
          .
        </p>
      </StaticSection>

      <StaticSection heading="Legea aplicabilă și modificări">
        <p>
          Acești termeni sunt guvernați de legea română. Serviciul este
          operat de {"{{TODO: entitate juridică}}"}. Putem actualiza termenii;
          modificările substanțiale vor fi anunțate în aplicație, iar
          versiunea curentă este în vigoare de la{" "}
          {"{{TODO: data intrării în vigoare}}"}.
        </p>
      </StaticSection>
    </StaticPage>
  );
}
