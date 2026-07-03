import { createFileRoute, Link } from "@tanstack/react-router";
import { StaticPage, StaticSection } from "@/components/layout/StaticPage";

export const Route = createFileRoute("/despre")({
  head: () => ({
    meta: [
      { title: "Despre noi — Biviant" },
      {
        name: "description",
        content:
          "Ce este Biviant, de ce există și cum arătăm aceeași știre din perspective multiple, cu orientarea și fiabilitatea fiecărei surse la vedere.",
      },
    ],
  }),
  component: DesprePage,
});

// BIV-803: the static footer pages are written directly in Romanian (the
// product language) as long-form content, not catalog strings. Business
// identity details are never invented — see FOOTER_TODO.md.
export function DesprePage() {
  return (
    <StaticPage
      title="Despre noi"
      intro="Biviant este un agregator românesc de știri care îți arată aceeași poveste din perspective multiple — cu orientarea și fiabilitatea fiecărei surse la vedere."
    >
      <StaticSection heading="Ce este Biviant">
        <p>
          Biviant urmărește principalele publicații de știri din România și
          grupează automat articolele care relatează același eveniment. Pentru
          fiecare eveniment vezi ce surse îl acoperă, cum se poziționează
          fiecare pe axa reformist–suveranist și cât de fiabilă este fiecare
          publicație — plus un rezumat neutru și, acolo unde acoperirea o
          permite, formularea distinctă a fiecărei părți.
        </p>
        <p>
          Nu scriem știri proprii și nu ascundem sursele: fiecare eveniment
          din Biviant duce, printr-un clic, la articolele originale ale
          publicațiilor care l-au relatat.
        </p>
      </StaticSection>

      <StaticSection heading="De ce există">
        <p>
          Presa românească este polarizată, iar algoritmii rețelelor sociale
          tind să îți arate doar sursele cu care ești deja de acord. Aceeași
          știre poate arăta complet diferit în două bule informaționale, iar
          cititorul are rareori ocazia să vadă ambele versiuni una lângă alta.
        </p>
        <p>
          Biviant există exact pentru asta: pune versiunile față în față,
          spune transparent din ce direcție vine fiecare relatare și te lasă
          pe tine să tragi concluziile.
        </p>
      </StaticSection>

      <StaticSection heading="Cum lucrăm">
        <p>
          Platforma este în mare parte automată: colectarea articolelor,
          gruparea pe evenimente și rezumatele sunt generate de sistem, după
          regulile descrise în pagina{" "}
          <Link to="/cum-functioneaza" className="underline hover:text-foreground">
            Cum funcționează
          </Link>
          . Scorurile de orientare și cele de fiabilitate sunt atribuite
          separat unele de altele: o publicație nu primește un scor de
          încredere mai bun sau mai slab pentru că înclină într-o anumită
          direcție.
        </p>
        <p>
          Rezumatele sunt generate automat și pot conține erori — de aceea
          linkurile către articolele originale sunt întotdeauna prezente, iar
          etichetele de orientare sunt descriptive, nu evaluative: niciuna
          dintre perspective nu este prezentată drept „cea corectă”.
        </p>
      </StaticSection>

      <StaticSection heading="Cine suntem">
        <p>
          Biviant este operat de {"{{TODO: entitate juridică}}"}. Ne poți
          scrie oricând prin pagina de{" "}
          <Link to="/contact" className="underline hover:text-foreground">
            Contact
          </Link>{" "}
          — inclusiv dacă reprezinți o publicație și vrei să discutăm despre
          scorurile afișate.
        </p>
      </StaticSection>
    </StaticPage>
  );
}
