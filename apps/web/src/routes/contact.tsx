import { createFileRoute } from "@tanstack/react-router";
import { StaticPage, StaticSection } from "@/components/layout/StaticPage";
import { BRAND_NAME } from "@/lib/i18n/strings";
import { staticPageHead } from "@/lib/seo";

export const Route = createFileRoute("/contact")({
  head: () =>
    staticPageHead({
      title: `Contact — ${BRAND_NAME}`,
      description: `Cum poți contacta echipa ${BRAND_NAME}: întrebări, corecții, cereri legate de date personale sau propuneri de colaborare.`,
      path: "/contact",
    }),
  component: ContactPage,
});

export function ContactPage() {
  return (
    <StaticPage
      title="Contact"
      intro={`Ne poți scrie pentru orice ține de ${BRAND_NAME} — de la întrebări simple până la corecții, cereri legate de datele tale sau propuneri de colaborare.`}
    >
      <StaticSection heading="Cum ne contactezi">
        <p>
          Cel mai sigur canal este e-mailul
          {/* :{" "}
          {"{{TODO: adresă de e-mail de contact}}"} */}
          . Trimitem și primim mesaje de pe domeniul{" "}
          <strong>biviant.com</strong> — dacă primești un e-mail „de la{" "}
          {BRAND_NAME}” de pe alt domeniu, tratează-l cu suspiciune.
        </p>
        <p>
          Răspundem de regulă în câteva zile lucrătoare. Suntem o echipă mică,
          așa că îți mulțumim pentru răbdare.
        </p>
      </StaticSection>

      <StaticSection heading="Pentru ce ne poți scrie">
        <ul className="list-disc space-y-2 pl-5">
          <li>
            <strong>Corecții și semnalări</strong> — un eveniment grupat greșit,
            un rezumat inexact sau un scor de orientare ori de fiabilitate pe
            care îl consideri nedrept. Include linkul către pagina în cauză.
          </li>
          <li>
            <strong>Publicații</strong> — dacă reprezinți o publicație inclusă
            în {BRAND_NAME} și vrei să discutăm despre modul în care este
            afișată, sau dacă vrei ca publicația ta să fie luată în calcul.
          </li>
          <li>
            <strong>Datele tale</strong> — cereri de acces, rectificare sau
            ștergere a datelor personale (vezi și Politica de
            confidențialitate). Ștergerea contului o poți solicita și din pagina
            de profil.
          </li>
          <li>
            <strong>Parteneriate și presă</strong> — colaborări editoriale,
            educație media, cercetare.
          </li>
        </ul>
      </StaticSection>

      {/* <StaticSection heading="Date de identificare">
        <p>
          Operator: {"{{TODO: entitate juridică}}"}, cu sediul la{" "}
          {"{{TODO: adresă sediu}}"}.
        </p>
      </StaticSection> */}
    </StaticPage>
  );
}
