// L6 — admin queue for publisher opt-out/takedown requests. Approving is a
// single action: it blocks the domain in domainPermissions and purges its
// content; the full lifecycle (received → decided → executed) is timestamped.
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery } from "convex/react";
import { api } from "@news-app/backend/convex/_generated/api";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageLoadingState } from "@/components/ui/page-loading-state";

export const Route = createFileRoute("/admin/publishers")({
  component: AdminPublishersRoute,
});

function AdminPublishersRoute() {
  const requests = useQuery(api.publisherRequests.listPublisherRequestsForAdmin, {});
  const decide = useMutation(api.publisherRequests.decidePublisherRequest);

  if (requests === undefined) {
    return <PageLoadingState title="Se încarcă cererile publisherilor..." />;
  }

  const handleDecision = async (
    requestId: (typeof requests)[number]["_id"],
    decision: "approve" | "deny",
  ) => {
    try {
      const result = await decide({ requestId, decision });
      if (result.decided) {
        toast.success(
          decision === "approve"
            ? "Cerere aprobată — domeniul a fost blocat și conținutul șters"
            : "Cerere respinsă",
        );
      } else {
        toast.error("Cererea nu mai este în așteptare");
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Decizia a eșuat");
    }
  };

  return (
    <div className="container mx-auto max-w-4xl space-y-6 px-4 py-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Cereri de la publicații
        </h1>
        <p className="text-sm text-muted-foreground">
          Opt-out / takedown primite prin /publishers. Aprobarea blochează
          domeniul și șterge conținutul într-o singură acțiune.
        </p>
      </div>
      {requests.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nicio cerere nouă.</p>
      ) : (
        requests.map((request) => (
          <Card key={request._id}>
            <CardHeader>
              <CardTitle className="flex flex-wrap items-center justify-between gap-2 text-base">
                <span>
                  {request.domain}{" "}
                  <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-normal">
                    {request.requestType}
                  </span>
                </span>
                <span className="text-xs font-normal text-muted-foreground">
                  {new Date(request.receivedAt).toLocaleString()}
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm">
                <span className="text-muted-foreground">Contact:</span>{" "}
                {request.contact}
              </p>
              {request.message && (
                <p className="text-sm text-muted-foreground">{request.message}</p>
              )}
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={() => handleDecision(request._id, "approve")}
                >
                  Aprobă (blochează domeniul)
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => handleDecision(request._id, "deny")}
                >
                  Respinge
                </Button>
              </div>
            </CardContent>
          </Card>
        ))
      )}
    </div>
  );
}
