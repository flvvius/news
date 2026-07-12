// Admin queue for general contact-form messages: read the message and mark it
// handled. Messages also arrive by email (reply-to is the sender).
import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery } from "convex/react";
import { api } from "@news-app/backend/convex/_generated/api";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageLoadingState } from "@/components/ui/page-loading-state";

export const Route = createFileRoute("/admin/contact")({
  component: AdminContactRoute,
});

function ContactCard({
  message,
}: {
  message: NonNullable<
    ReturnType<
      typeof useQuery<typeof api.contact.listContactMessagesForAdmin>
    >
  >[number];
}) {
  const markHandled = useMutation(api.contact.markContactMessageHandled);
  const [busy, setBusy] = useState(false);

  const handleResolve = async () => {
    setBusy(true);
    try {
      const result = await markHandled({ messageId: message._id });
      if (result.updated) {
        toast.success("Mesaj marcat ca rezolvat");
      } else {
        toast.error("Mesajul era deja rezolvat");
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Acțiunea a eșuat");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center justify-between gap-2 text-base">
          <span className="min-w-0">
            {message.subject}
            <span className="ml-2 text-xs font-normal text-muted-foreground">
              {message.name} &lt;
              <a
                href={`mailto:${message.email}`}
                className="underline hover:text-foreground"
              >
                {message.email}
              </a>
              &gt;
            </span>
          </span>
          <span className="text-xs font-normal text-muted-foreground">
            {new Date(message.createdAt).toLocaleString()}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="whitespace-pre-wrap text-sm">{message.message}</p>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" asChild>
            <a href={`mailto:${message.email}?subject=Re: ${encodeURIComponent(message.subject)}`}>
              Răspunde
            </a>
          </Button>
          <Button size="sm" disabled={busy} onClick={handleResolve}>
            Marchează rezolvat
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function AdminContactRoute() {
  const messages = useQuery(api.contact.listContactMessagesForAdmin, {});

  if (messages === undefined) {
    return <PageLoadingState title="Se încarcă mesajele..." />;
  }

  return (
    <div className="container mx-auto max-w-4xl space-y-6 px-4 py-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Mesaje de contact
        </h1>
        <p className="text-sm text-muted-foreground">
          Mesaje trimise din pagina de contact. Fiecare ajunge și pe e-mail
          (poți răspunde direct expeditorului).
        </p>
      </div>
      {messages.length === 0 ? (
        <p className="text-sm text-muted-foreground">Niciun mesaj nou.</p>
      ) : (
        messages.map((message) => (
          <ContactCard key={message._id} message={message} />
        ))
      )}
    </div>
  );
}
