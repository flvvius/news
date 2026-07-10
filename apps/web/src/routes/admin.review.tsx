// L4 — minimal admin view for the summary review queue: summaries whose
// text pairs a named person/organization with an accusation term are held
// here and never auto-published. Approve (optionally edited), or reject.
// Access control lives server-side (requireAdminUser on every query/mutation).
import { useState, type ReactNode } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { api } from "@news-app/backend/convex/_generated/api";
import { useMutation, useQuery } from "convex/react";
import type { Id } from "@news-app/backend/convex/_generated/dataModel";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageLoadingState } from "@/components/ui/page-loading-state";

export const Route = createFileRoute("/admin/review")({
  component: AdminReviewRoute,
});

type EditableFields = {
  neutral: string;
  reformist: string;
  suveranist: string;
  globalImpact: string;
};

function highlightFlagged(sentence: string, text: string) {
  const index = text.indexOf(sentence);
  if (index === -1) return <>{text}</>;
  return (
    <>
      {text.slice(0, index)}
      <mark className="bg-warning/30 text-foreground">{sentence}</mark>
      {text.slice(index + sentence.length)}
    </>
  );
}

function ReviewCard({
  item,
}: {
  item: NonNullable<
    ReturnType<
      typeof useQuery<typeof api.summarization.listSummaryReviewQueueForAdmin>
    >
  >[number];
}) {
  const decide = useMutation(api.summarization.decideSummaryReviewForAdmin);
  const [editing, setEditing] = useState(false);
  const [fields, setFields] = useState<EditableFields>({
    neutral: item.proposed.neutral,
    reformist: item.proposed.reformist,
    suveranist: item.proposed.suveranist,
    globalImpact: item.proposed.globalImpact,
  });
  const [busy, setBusy] = useState(false);

  const flaggedByField = new Map<string, string[]>();
  for (const flag of item.flaggedSentences) {
    flaggedByField.set(flag.field, [
      ...(flaggedByField.get(flag.field) ?? []),
      flag.sentence,
    ]);
  }

  const handleDecision = async (decision: "approve" | "reject") => {
    setBusy(true);
    try {
      const result = await decide({
        reviewId: item._id as Id<"summaryReviewQueue">,
        decision,
        editedFields: editing ? fields : undefined,
      });
      if (result.decided) {
        toast.success(
          decision === "approve"
            ? "Rezumat aprobat și publicat"
            : "Rezumat respins",
        );
      } else {
        toast.error("Elementul nu mai este în așteptare");
      }
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Decizia a eșuat",
      );
    } finally {
      setBusy(false);
    }
  };

  const fieldEntries: Array<[keyof EditableFields, string]> = [
    ["neutral", "Neutru"],
    ["reformist", "Reformist"],
    ["suveranist", "Suveranist"],
    ["globalImpact", "Impact"],
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center justify-between gap-2 text-base">
          <span>{item.eventTitle}</span>
          <span className="text-xs font-normal text-muted-foreground">
            {new Date(item.createdAt).toLocaleString()}
          </span>
        </CardTitle>
        <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
          {item.flaggedSentences.map((flag, index) => (
            <span
              key={index}
              className="rounded-full bg-warning/15 px-2 py-1 text-warning-foreground"
            >
              {flag.entity} + „{flag.term}”
            </span>
          ))}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {fieldEntries.map(([field, label]) => {
          const value = fields[field];
          if (!value?.trim()) return null;
          const flagged = flaggedByField.get(field) ?? [];
          return (
            <div key={field} className="space-y-1">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {label}
              </p>
              {editing ? (
                <textarea
                  className="w-full rounded-md border border-border bg-background p-2 text-sm"
                  rows={3}
                  value={value}
                  onChange={(event) =>
                    setFields((previous) => ({
                      ...previous,
                      [field]: event.target.value,
                    }))
                  }
                />
              ) : (
                <p className="text-sm leading-relaxed">
                  {flagged.reduce<ReactNode>(
                    (node, sentence) =>
                      typeof node === "string"
                        ? highlightFlagged(sentence, node)
                        : node,
                    value,
                  )}
                </p>
              )}
            </div>
          );
        })}

        <div className="flex flex-wrap gap-2 pt-2">
          <Button
            size="sm"
            disabled={busy}
            onClick={() => handleDecision("approve")}
          >
            {editing ? "Aprobă cu modificări" : "Aprobă și publică"}
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => setEditing((value) => !value)}
          >
            {editing ? "Renunță la editare" : "Editează"}
          </Button>
          <Button
            size="sm"
            variant="destructive"
            disabled={busy}
            onClick={() => handleDecision("reject")}
          >
            Respinge
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function AdminReviewRoute() {
  const queue = useQuery(api.summarization.listSummaryReviewQueueForAdmin, {});

  if (queue === undefined) {
    return <PageLoadingState title="Se încarcă coada de verificare..." />;
  }

  return (
    <div className="container mx-auto max-w-4xl space-y-6 px-4 py-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Rezumate în așteptarea verificării
        </h1>
        <p className="text-sm text-muted-foreground">
          Rezumate generate de AI reținute de filtrul de risc (persoană sau
          organizație numită + termen de acuzație). Nu se publică automat.
        </p>
      </div>
      {queue.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Nicio verificare în așteptare.
        </p>
      ) : (
        queue.map((item) => <ReviewCard key={item._id} item={item} />)
      )}
    </div>
  );
}
