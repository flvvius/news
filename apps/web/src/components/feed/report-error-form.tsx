// L8 — on-page report-an-error form (DSA notice-and-action entry point).
// Anchored at #raporteaza so the AI-disclosure label links straight here.
import { useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@news-app/backend/convex/_generated/api";
import type { Id } from "@news-app/backend/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SectionTitle } from "@/components/ui/section-title";
import { useT } from "@/lib/i18n/LocaleContext";

type ReportCategory =
  | "factual_error"
  | "defamation"
  | "copyright_takedown"
  | "illegal_content";

const CATEGORIES: ReportCategory[] = [
  "factual_error",
  "defamation",
  "copyright_takedown",
  "illegal_content",
];

export function ReportErrorForm({ eventId }: { eventId: Id<"events"> }) {
  const t = useT();
  const submit = useMutation(api.reports.submitContentReport);
  const [category, setCategory] = useState<ReportCategory>("factual_error");
  const [message, setMessage] = useState("");
  const [claim, setClaim] = useState("");
  const [contact, setContact] = useState("");
  const [state, setState] = useState<"idle" | "busy" | "sent" | "error">(
    "idle",
  );

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setState("busy");
    try {
      await submit({
        eventId,
        category,
        message,
        claim: claim.trim() || undefined,
        reporterContact: contact.trim() || undefined,
      });
      setState("sent");
    } catch {
      setState("error");
    }
  };

  return (
    <section
      id="raporteaza"
      className="scroll-mt-20 space-y-3 border-t border-border pt-6"
    >
      <SectionTitle>{t("report.title")}</SectionTitle>
      {state === "sent" ? (
        <p className="text-sm text-muted-foreground">{t("report.sent")}</p>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">{t("report.intro")}</p>
          <form onSubmit={handleSubmit} className="space-y-3">
            <div className="space-y-1">
              <label
                htmlFor="report-category"
                className="text-sm font-medium"
              >
                {t("report.category")}
              </label>
              <select
                id="report-category"
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                value={category}
                onChange={(event) =>
                  setCategory(event.target.value as ReportCategory)
                }
              >
                {CATEGORIES.map((value) => (
                  <option key={value} value={value}>
                    {t(`report.category.${value}` as Parameters<typeof t>[0])}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <label htmlFor="report-message" className="text-sm font-medium">
                {t("report.message")}
              </label>
              <textarea
                id="report-message"
                required
                minLength={5}
                maxLength={2000}
                rows={3}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                value={message}
                onChange={(event) => setMessage(event.target.value)}
              />
            </div>
            <div className="space-y-1">
              <label htmlFor="report-claim" className="text-sm font-medium">
                {t("report.claim")}
              </label>
              <Input
                id="report-claim"
                maxLength={500}
                value={claim}
                onChange={(event) => setClaim(event.target.value)}
              />
            </div>
            <div className="space-y-1">
              <label htmlFor="report-contact" className="text-sm font-medium">
                {t("report.contact")}
              </label>
              <Input
                id="report-contact"
                type="email"
                maxLength={200}
                value={contact}
                onChange={(event) => setContact(event.target.value)}
              />
            </div>
            {state === "error" && (
              <p className="text-sm text-destructive">{t("report.error")}</p>
            )}
            <Button type="submit" size="sm" disabled={state === "busy"}>
              {t("report.submit")}
            </Button>
          </form>
        </>
      )}
    </section>
  );
}
