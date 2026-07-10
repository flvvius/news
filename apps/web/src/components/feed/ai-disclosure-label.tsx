import { useT } from "@/lib/i18n/LocaleContext";

/**
 * L1 — AI Act art. 50(4) disclosure. Rendered adjacent to every AI summary
 * block (server-side, part of the initial HTML) — deliberately not in the
 * footer. The report link goes to the notice-and-action mechanism (L8);
 * until the on-page report form ships it points at /contact. Plain <a> on
 * purpose: the label must render in any context (SSR, tests, embeds)
 * without a router.
 */
export function AiDisclosureLabel({
  sourceCount,
  reportHref = "/contact",
}: {
  sourceCount: number;
  reportHref?: string;
}) {
  const t = useT();
  const text =
    sourceCount === 1
      ? t("event.aiDisclosure.one")
      : t("event.aiDisclosure").replace("{count}", String(sourceCount));

  return (
    <p
      data-ai-disclosure
      className="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs leading-relaxed text-muted-foreground"
    >
      {text}{" "}
      <a
        href={reportHref}
        className="whitespace-nowrap font-medium underline underline-offset-2 hover:text-foreground"
      >
        {t("event.aiDisclosure.report")} →
      </a>
    </p>
  );
}
