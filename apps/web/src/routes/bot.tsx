// L6 — the crawler identity page linked from MiezBot's User-Agent string.
import { createFileRoute, Link } from "@tanstack/react-router";
import { StaticPage, StaticSection } from "@/components/layout/StaticPage";
import { BRAND_NAME } from "@/lib/i18n/strings";
import { staticPageHead } from "@/lib/seo";

export const Route = createFileRoute("/bot")({
  // Named in MiezBot's own User-Agent string, so publishers reach it directly
  // from their access logs — it needs a canonical and a share card like any
  // other public page.
  head: () =>
    staticPageHead({
      title: `MiezBot — ${BRAND_NAME}`,
      description:
        "Ce face crawler-ul MiezBot, cum se identifică și cum poate o publicație să refuze accesul (robots.txt, TDMRep, formular).",
      path: "/bot",
      breadcrumb: [
        { name: BRAND_NAME, path: "/" },
        { name: "MiezBot", path: "/bot" },
      ],
    }),
  component: BotPage,
});

export function BotPage() {
  return (
    <StaticPage
      title="MiezBot"
      intro={`Crawler-ul ${BRAND_NAME} — ce face, cum se identifică și cum îl poți opri.`}
    >
      <StaticSection heading="Ce face">
        <p>
          MiezBot citește fluxurile RSS publice ale publicațiilor românești
          monitorizate și, acolo unde publicația nu a exprimat o rezervare de
          drepturi, accesează articolele pentru procesare temporară (textul
          integral nu este stocat niciodată). Pe baza acestui material,{" "}
          {BRAND_NAME} grupează articolele pe evenimente și generează rezumate
          cu legături directe către articolele originale.
        </p>
        <p>
          Identitatea completă a crawler-ului:{" "}
          <code className="rounded bg-muted px-1 py-0.5 text-[13px]">
            MiezBot/1.0 (+https://www.miez.news/bot)
          </code>
          . Toate cererile includ acest User-Agent și un antet{" "}
          <code className="rounded bg-muted px-1 py-0.5 text-[13px]">From</code>{" "}
          de contact. Cererile sunt limitate ca frecvență per domeniu (minim
          1,5 secunde între cereri, maximum 2 conexiuni simultane), respectă{" "}
          <code className="rounded bg-muted px-1 py-0.5 text-[13px]">
            Crawl-delay
          </code>{" "}
          și folosesc cereri condiționate (If-Modified-Since / If-None-Match).
        </p>
      </StaticSection>

      <StaticSection heading="Cum refuzi accesul">
        <p>Respectăm toate semnalele standard, verificate la fiecare 24 de ore:</p>
        <ul className="list-disc space-y-2 pl-5">
          <li>
            <strong>robots.txt</strong> — folosește token-ul{" "}
            <code className="rounded bg-muted px-1 py-0.5 text-[13px]">
              User-agent: MiezBot
            </code>{" "}
            cu{" "}
            <code className="rounded bg-muted px-1 py-0.5 text-[13px]">
              Disallow: /
            </code>
            . Respectăm și interdicțiile generice pentru agenți AI (GPTBot,
            CCBot etc.) ca semnal de opt-out TDM.
          </li>
          <li>
            <strong>TDMRep</strong> — antetul HTTP{" "}
            <code className="rounded bg-muted px-1 py-0.5 text-[13px]">
              TDM-Reservation: 1
            </code>
            , fișierul{" "}
            <code className="rounded bg-muted px-1 py-0.5 text-[13px]">
              /.well-known/tdmrep.json
            </code>{" "}
            sau meta-tag-ul{" "}
            <code className="rounded bg-muted px-1 py-0.5 text-[13px]">
              tdm-reservation
            </code>
            .
          </li>
          <li>
            <strong>noai</strong> — în meta-tag-ul robots sau în antetul{" "}
            <code className="rounded bg-muted px-1 py-0.5 text-[13px]">
              X-Robots-Tag
            </code>
            , plus fișierul{" "}
            <code className="rounded bg-muted px-1 py-0.5 text-[13px]">
              /ai.txt
            </code>
            .
          </li>
          <li>
            <strong>Formular direct</strong> — pagina{" "}
            <Link to="/publishers" className="underline hover:text-foreground">
              pentru publicații
            </Link>{" "}
            procesează cereri de opt-out sau de eliminare fără să fie nevoie de
            modificări tehnice pe site-ul tău.
          </li>
        </ul>
        <p>
          Orice semnal de rezervare limitează automat domeniul la titlu +
          link + fragment scurt din RSS (fără accesarea articolelor), iar
          conținutul deja extras este șters.
        </p>
      </StaticSection>
    </StaticPage>
  );
}
