// L6 — publisher opt-out/takedown form. Submissions land in the
// publisherRequests table, alert the operator, and are executed (domain
// blocked + content purged) with one admin action.
import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation } from "convex/react";
import { api } from "@news-app/backend/convex/_generated/api";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StaticPage, StaticSection } from "@/components/layout/StaticPage";
import { BRAND_NAME } from "@/lib/i18n/strings";
import { staticPageHead } from "@/lib/seo";

export const Route = createFileRoute("/publishers")({
  // Footer-linked and indexable, but it was the one such page emitting only a
  // title and description: no canonical, no share card. staticPageHead gives
  // it the same head contract as every other static page.
  head: () =>
    staticPageHead({
      title: `Pentru publicații — ${BRAND_NAME}`,
      description:
        "Cere excluderea publicației tale din agregare sau eliminarea conținutului: formular de opt-out/takedown pentru publisheri.",
      path: "/publishers",
      breadcrumb: [
        { name: BRAND_NAME, path: "/" },
        { name: "Pentru publicații", path: "/publishers" },
      ],
    }),
  component: PublishersPage,
});

type RequestType = "opt_out" | "takedown" | "other";

export function PublishersPage() {
  const submit = useMutation(api.publisherRequests.submitPublisherRequest);
  const [domain, setDomain] = useState("");
  const [contact, setContact] = useState("");
  const [requestType, setRequestType] = useState<RequestType>("opt_out");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      await submit({
        domain,
        contact,
        requestType,
        message: message.trim() || undefined,
      });
      setSent(true);
      toast.success("Cererea a fost înregistrată. Te vom contacta.");
    } catch (error) {
      toast.error(
        error instanceof Error && error.message.includes("rate")
          ? "Prea multe cereri. Încearcă din nou mai târziu."
          : "Trimiterea a eșuat. Verifică domeniul și încearcă din nou.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <StaticPage
      title="Pentru publicații"
      intro={`Controlezi cum apare conținutul publicației tale pe ${BRAND_NAME} — sau ceri eliminarea lui completă.`}
    >
      <StaticSection heading="Ce poți cere">
        <ul className="list-disc space-y-2 pl-5">
          <li>
            <strong>Opt-out</strong> — oprim accesarea articolelor și folosirea
            lor la rezumate; conținutul deja procesat este șters. Domeniul
            rămâne cel mult ca titlu + link, sau dispare complet, după
            preferință.
          </li>
          <li>
            <strong>Eliminare (takedown)</strong> — eliminăm complet conținutul
            publicației, inclusiv titlurile și linkurile.
          </li>
        </ul>
        <p>
          Alternativ, poți folosi semnalele automate (robots.txt, TDMRep,
          noai) descrise pe pagina{" "}
          <Link to="/bot" className="underline hover:text-foreground">
            MiezBot
          </Link>{" "}
          — le verificăm la fiecare 24 de ore.
        </p>
      </StaticSection>

      <StaticSection heading="Formular de cerere">
        {sent ? (
          <p>
            Cererea a fost înregistrată. O vom procesa și te vom contacta la
            adresa indicată. Fiecare pas (primire → decizie → execuție) este
            înregistrat cu marcaje de timp.
          </p>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1">
              <label htmlFor="pub-domain" className="text-sm font-medium">
                Domeniul publicației
              </label>
              <Input
                id="pub-domain"
                required
                placeholder="exemplu.ro"
                value={domain}
                onChange={(event) => setDomain(event.target.value)}
              />
            </div>
            <div className="space-y-1">
              <label htmlFor="pub-contact" className="text-sm font-medium">
                Contact (e-mail)
              </label>
              <Input
                id="pub-contact"
                required
                type="email"
                placeholder="redactia@exemplu.ro"
                value={contact}
                onChange={(event) => setContact(event.target.value)}
              />
            </div>
            <div className="space-y-1">
              <label htmlFor="pub-type" className="text-sm font-medium">
                Tipul cererii
              </label>
              <select
                id="pub-type"
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                value={requestType}
                onChange={(event) =>
                  setRequestType(event.target.value as RequestType)
                }
              >
                <option value="opt_out">Opt-out (oprire acces + extragere)</option>
                <option value="takedown">Eliminare completă (takedown)</option>
                <option value="other">Altceva</option>
              </select>
            </div>
            <div className="space-y-1">
              <label htmlFor="pub-message" className="text-sm font-medium">
                Detalii (opțional)
              </label>
              <textarea
                id="pub-message"
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                rows={4}
                maxLength={2000}
                value={message}
                onChange={(event) => setMessage(event.target.value)}
              />
            </div>
            <Button type="submit" disabled={busy}>
              Trimite cererea
            </Button>
          </form>
        )}
      </StaticSection>
    </StaticPage>
  );
}
