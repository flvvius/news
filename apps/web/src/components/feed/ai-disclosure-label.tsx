import { useReportDialog } from "@/components/feed/report-error-form";
import { useT } from "@/lib/i18n/LocaleContext";

/**
 * L1 — AI Act art. 50(4) disclosure. Rendered adjacent to every AI summary
 * block (server-side, part of the initial HTML) — deliberately not in the
 * footer. When a ReportDialogProvider is present the report link opens the
 * notice-and-action form (L8) in a dialog on the current screen; otherwise it
 * falls back to a plain <a> so the label still renders in any context (SSR,
 * tests, embeds) without a provider or router.
 */
export function AiDisclosureLabel({
  sourceCount,
  reportHref = "#raporteaza",
}: {
  sourceCount: number;
  reportHref?: string;
}) {
  const t = useT();
  const reportDialog = useReportDialog();
  const text =
    sourceCount === 1
      ? t("event.aiDisclosure.one")
      : t("event.aiDisclosure").replace("{count}", String(sourceCount));

  const reportLabel = `${t("event.aiDisclosure.report")} →`;
  const linkClass =
    "whitespace-nowrap font-medium underline underline-offset-2 hover:text-foreground";

  return (
    <p
      data-ai-disclosure
      className="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs leading-relaxed text-muted-foreground"
    >
      {text}{" "}
      {reportDialog ? (
        <button
          type="button"
          onClick={reportDialog.open}
          className={`${linkClass} cursor-pointer`}
        >
          {reportLabel}
        </button>
      ) : (
        <a href={reportHref} className={linkClass}>
          {reportLabel}
        </a>
      )}
    </p>
  );
}
