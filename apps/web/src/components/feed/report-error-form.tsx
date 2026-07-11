// L8 — report-an-error form (DSA notice-and-action entry point). Presented in
// a dialog opened from any complaint entry point on the current screen (see
// ReportDialogProvider / useReportDialog below) rather than hard-rendered on
// the page.
import { createContext, useCallback, useContext, useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@news-app/backend/convex/_generated/api";
import type { Id } from "@news-app/backend/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
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

/** The form fields themselves, so they can be embedded in any container. */
function ReportErrorFields({
  eventId,
  onSubmitted,
}: {
  eventId: Id<"events">;
  onSubmitted?: () => void;
}) {
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
      onSubmitted?.();
    } catch {
      setState("error");
    }
  };

  if (state === "sent") {
    return (
      <p
        role="status"
        aria-live="polite"
        className="text-sm text-muted-foreground"
      >
        {t("report.sent")}
      </p>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div className="space-y-1">
        <label htmlFor="report-category" className="text-sm font-medium">
          {t("report.category")}
        </label>
        <select
          id="report-category"
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
          value={category}
          onChange={(event) => setCategory(event.target.value as ReportCategory)}
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
        <p
          role="alert"
          aria-live="assertive"
          className="text-sm text-destructive"
        >
          {t("report.error")}
        </p>
      )}
      <Button type="submit" size="sm" disabled={state === "busy"}>
        {t("report.submit")}
      </Button>
    </form>
  );
}

type ReportDialogContextValue = { open: () => void };

const ReportDialogContext = createContext<ReportDialogContextValue | null>(null);

/**
 * Any complaint entry point on the current screen can call `open()` to raise
 * the report dialog in place. Returns null when no provider is present (SSR
 * embeds, tests) so callers can fall back to a plain link.
 */
export function useReportDialog(): ReportDialogContextValue | null {
  return useContext(ReportDialogContext);
}

/**
 * Wraps a screen that has a reportable event, providing a single in-place
 * report dialog that every entry point below it can open.
 */
export function ReportDialogProvider({
  eventId,
  children,
}: {
  eventId: Id<"events">;
  children: React.ReactNode;
}) {
  const t = useT();
  const [isOpen, setIsOpen] = useState(false);
  const open = useCallback(() => setIsOpen(true), []);

  return (
    <ReportDialogContext.Provider value={{ open }}>
      {children}
      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t("report.title")}</DialogTitle>
            <DialogDescription>{t("report.intro")}</DialogDescription>
          </DialogHeader>
          <ReportErrorFields eventId={eventId} />
        </DialogContent>
      </Dialog>
    </ReportDialogContext.Provider>
  );
}
