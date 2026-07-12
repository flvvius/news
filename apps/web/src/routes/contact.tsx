import { createFileRoute } from "@tanstack/react-router";
import { StaticPage, StaticSection } from "@/components/layout/StaticPage";
import { ContactForm } from "@/components/contact-form";
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
      <StaticSection heading="Scrie-ne un mesaj">
        <p>
          Completează formularul de mai jos și îți răspundem pe adresa lăsată.
          Nu ai nevoie de cont.
        </p>
        <div className="mt-4 text-foreground">
          <ContactForm />
        </div>
      </StaticSection>

      <StaticSection heading="Alte căi">
        <p>
          Pentru corecții și semnalări pe un anume eveniment, cel mai direct
          canal este butonul <strong>„Raportează o eroare”</strong> din pagina
          evenimentului: alegi tipul problemei, ne scrii pe scurt și, dacă lași
          un contact, ești notificat cu decizia motivată.
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

      <StaticSection heading="Punct de contact (DSA)">
        <p>
          Această pagină este punctul unic de contact al {BRAND_NAME} atât
          pentru utilizatori, cât și pentru autorități (inclusiv în sensul
          Regulamentului UE privind serviciile digitale — DSA). Comunicarea se
          poate face în limba română sau în engleză.
        </p>
        <p>
          Conținutul ilegal sau problematic poate fi semnalat direct din
          pagina fiecărui eveniment, prin butonul „Raportează o eroare” —
          fiecare raport primește o decizie motivată, iar raportorul care
          lasă un contact este notificat.
        </p>
      </StaticSection>
    </StaticPage>
  );
}
