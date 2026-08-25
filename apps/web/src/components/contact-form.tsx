import { useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@news-app/backend/convex/_generated/api";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useT } from "@/lib/i18n/LocaleContext";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * General contact form. Posts to `contact.submitContactMessage`, which stores
 * the message for the admin dashboard and emails the operators. No account
 * required.
 */
export function ContactForm() {
  const t = useT();
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
      toast.error(t("contact.error.name"));
      return;
    }
    if (!EMAIL_RE.test(email.trim())) {
      toast.error(t("contact.error.email"));
      return;
    }
    if (message.trim().length < 10) {
      toast.error(t("contact.error.message"));
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
      toast.success(t("contact.success.toast"));
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : t("contact.error.generic"),
      );
    } finally {
      setBusy(false);
    }
  };

  if (sent) {
    return (
      <div role="status" aria-live="polite" className="text-sm">
        <p className="font-medium text-foreground">{t("contact.sent.title")}</p>
        <p className="mt-1 text-muted-foreground">{t("contact.sent.body")}</p>
        <Button
          variant="outline"
          size="sm"
          className="mt-3"
          onClick={() => setSent(false)}
        >
          {t("contact.sent.again")}
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4" noValidate>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="contact-name">{t("contact.field.name")}</Label>
          <Input
            id="contact-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            autoComplete="name"
            required
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="contact-email">{t("contact.field.email")}</Label>
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
        <Label htmlFor="contact-subject">{t("contact.field.subject")}</Label>
        <Input
          id="contact-subject"
          value={subject}
          onChange={(event) => setSubject(event.target.value)}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="contact-message">{t("contact.field.message")}</Label>
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
        {busy ? t("contact.submitting") : t("contact.submit")}
      </Button>
    </form>
  );
}
