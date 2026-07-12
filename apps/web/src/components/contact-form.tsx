import { useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@news-app/backend/convex/_generated/api";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * General contact form. Posts to `contact.submitContactMessage`, which stores
 * the message for the admin dashboard and emails the operators. No account
 * required.
 */
export function ContactForm() {
  const submit = useMutation(api.contact.submitContactMessage);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (name.trim().length < 2) {
      toast.error("Scrie-ți numele.");
      return;
    }
    if (!EMAIL_RE.test(email.trim())) {
      toast.error("Adresa de e-mail nu pare validă.");
      return;
    }
    if (message.trim().length < 10) {
      toast.error("Mesajul este prea scurt.");
      return;
    }

    setBusy(true);
    try {
      await submit({
        name: name.trim(),
        email: email.trim(),
        subject: subject.trim(),
        message: message.trim(),
      });
      setSent(true);
      setName("");
      setEmail("");
      setSubject("");
      setMessage("");
      toast.success("Mesajul a fost trimis. Mulțumim!");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Nu am putut trimite mesajul.",
      );
    } finally {
      setBusy(false);
    }
  };

  if (sent) {
    return (
      <div className="rounded-lg border border-border bg-muted/30 p-4 text-sm">
        <p className="font-medium text-foreground">Mesajul a fost trimis.</p>
        <p className="mt-1 text-muted-foreground">
          Îți răspundem de regulă în câteva zile lucrătoare, pe adresa lăsată.
        </p>
        <Button
          variant="outline"
          size="sm"
          className="mt-3"
          onClick={() => setSent(false)}
        >
          Trimite alt mesaj
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4" noValidate>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="contact-name">Nume</Label>
          <Input
            id="contact-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            autoComplete="name"
            required
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="contact-email">E-mail</Label>
          <Input
            id="contact-email"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            autoComplete="email"
            required
          />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="contact-subject">Subiect</Label>
        <Input
          id="contact-subject"
          value={subject}
          onChange={(event) => setSubject(event.target.value)}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="contact-message">Mesaj</Label>
        <textarea
          id="contact-message"
          rows={5}
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          required
        />
      </div>
      <Button type="submit" disabled={busy}>
        {busy ? "Se trimite..." : "Trimite mesajul"}
      </Button>
    </form>
  );
}
