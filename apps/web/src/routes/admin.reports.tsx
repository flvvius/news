// L8 — admin queue for content reports: dismiss / correct (regenerate) /
// unpublish (instant), each with a mandatory statement of reasons. The
// report → decision → unpublish round-trip is under 3 clicks.
import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery } from "convex/react";
import { api } from "@news-app/backend/convex/_generated/api";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageLoadingState } from "@/components/ui/page-loading-state";

export const Route = createFileRoute("/admin/reports")({
  component: AdminReportsRoute,
});

const CATEGORY_LABELS: Record<string, string> = {
  factual_error: "Eroare factuală",
  defamation: "Defăimare",
  copyright_takedown: "Copyright/takedown",
  illegal_content: "Conținut ilegal",
};

function ReportCard({
  report,
}: {
  report: NonNullable<
    ReturnType<typeof useQuery<typeof api.reports.listContentReportsForAdmin>>
  >[number];
}) {
  const decide = useMutation(api.reports.decideContentReportForAdmin);
  const [reasons, setReasons] = useState("");
  const [busy, setBusy] = useState(false);
  const urgent =
    report.category === "defamation" || report.category === "illegal_content";

  const handleDecision = async (
    decision: "dismiss" | "correct" | "unpublish",
  ) => {
    if (reasons.trim().length < 5) {
      toast.error("Scrie motivarea deciziei (statement of reasons).");
      return;
    }
    setBusy(true);
    try {
      const result = await decide({
        reportId: report._id,
        decision,
        statementOfReasons: reasons,
      });
      if (result.decided) {
        toast.success(
          decision === "unpublish"
            ? "Eveniment retras din public"
            : decision === "correct"
              ? "Regenerare pornită"
              : "Raport respins",
        );
      } else {
        toast.error("Raportul nu mai este în așteptare");
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Decizia a eșuat");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className={urgent ? "border-destructive/60" : undefined}>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center justify-between gap-2 text-base">
          <span className="flex items-center gap-2">
            {report.eventTitle}
            <span
              className={`rounded-full px-2 py-0.5 text-xs font-normal ${
                urgent
                  ? "bg-destructive/10 text-destructive"
                  : "bg-muted text-muted-foreground"
              }`}
            >
              {CATEGORY_LABELS[report.category] ?? report.category}
            </span>
            {report.eventUnpublished && (
              <span className="rounded-full bg-warning/15 px-2 py-0.5 text-xs font-normal">
                deja retras
              </span>
            )}
          </span>
          <span className="text-xs font-normal text-muted-foreground">
            {new Date(report.createdAt).toLocaleString()}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm">{report.message}</p>
        {report.claim && (
          <p className="text-sm text-muted-foreground">
            Afirmația: „{report.claim}”
          </p>
        )}
        {report.reporterContact && (
          <p className="text-xs text-muted-foreground">
            Contact raportor: {report.reporterContact}
          </p>
        )}
        <div className="space-y-1">
          <label
            htmlFor={`reasons-${report._id}`}
            className="text-sm font-medium"
          >
            Motivarea deciziei (trimisă raportorului)
          </label>
          <textarea
            id={`reasons-${report._id}`}
            rows={2}
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
            value={reasons}
            onChange={(event) => setReasons(event.target.value)}
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="destructive"
            disabled={busy}
            onClick={() => handleDecision("unpublish")}
          >
            Retrage din public
          </Button>
          <Button
            size="sm"
            disabled={busy}
            onClick={() => handleDecision("correct")}
          >
            Corectează (regenerare)
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => handleDecision("dismiss")}
          >
            Respinge
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function AdminReportsRoute() {
  const reports = useQuery(api.reports.listContentReportsForAdmin, {});

  if (reports === undefined) {
    return <PageLoadingState title="Se încarcă rapoartele..." />;
  }

  return (
    <div className="container mx-auto max-w-4xl space-y-6 px-4 py-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Rapoarte de conținut
        </h1>
        <p className="text-sm text-muted-foreground">
          Notice-and-action (DSA): fiecare decizie cere o motivare, iar
          raportorul cu contact primește decizia pe e-mail.
        </p>
      </div>
      {reports.length === 0 ? (
        <p className="text-sm text-muted-foreground">Niciun raport nou.</p>
      ) : (
        reports.map((report) => <ReportCard key={report._id} report={report} />)
      )}
    </div>
  );
}
