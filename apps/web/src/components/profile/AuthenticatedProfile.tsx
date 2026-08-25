import { useState } from "react";
import { CheckCircle2, Download, KeyRound, LogOut, Trash2 } from "lucide-react";
import { useConvex, useMutation } from "convex/react";
import { api } from "@news-app/backend/convex/_generated/api";
import { authClient } from "@/lib/auth-client";
import { LanguagePicker } from "@/components/LanguagePicker";
import { ThemePicker } from "@/components/theme/ThemePicker";
import { useT } from "@/lib/i18n/LocaleContext";
import { absoluteSiteUrl } from "@/lib/seo";
import { Button } from "@/components/ui/button";
import { SectionTitle } from "@/components/ui/section-title";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { toast } from "sonner";

type AuthenticatedProfileUser = {
  email: string;
  emailVerified?: boolean;
  image?: string | null;
  name?: string | null;
  profile?: {
    avatar?: string;
    name?: string;
    preferredLanguage?: "ro" | "en";
  };
};

function getAvatarFallback(name: string, email: string) {
  const firstNameLetter = name.trim().charAt(0).toUpperCase();

  if (firstNameLetter) {
    return firstNameLetter;
  }

  return email.trim().charAt(0).toUpperCase() || "?";
}

function getPasswordResetRedirectURL() {
  if (typeof window === "undefined") {
    return absoluteSiteUrl("/reset-password");
  }

  return new URL("/reset-password", window.location.origin).toString();
}

export function AuthenticatedProfile({
  user,
}: {
  user: AuthenticatedProfileUser;
}) {
  const t = useT();
  const displayName = user.profile?.name || user.name || user.email;
  const avatarSrc = user.profile?.avatar || user.image || undefined;
  const avatarFallback = getAvatarFallback(displayName, user.email);
  const [isSendingReset, setIsSendingReset] = useState(false);
  const [resetStatusMessage, setResetStatusMessage] = useState("");
  // L10 — GDPR self-service export + deletion.
  const convex = useConvex();
  const deleteMyAccount = useMutation(api.dataRights.deleteMyAccount);
  const [isExporting, setIsExporting] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const handleDownloadData = async () => {
    setIsExporting(true);
    try {
      const data = await convex.query(api.dataRights.exportMyData, {});
      const blob = new Blob([JSON.stringify(data, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `miez-data-export-${new Date().toISOString().slice(0, 10)}.json`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error("Data export failed:", error);
      toast.error(t("profile.downloadDataFailed"));
    } finally {
      setIsExporting(false);
    }
  };

  const handleDeleteAccount = async () => {
    setIsDeleting(true);
    try {
      await deleteMyAccount({});
      toast.success(t("profile.deleteDone"));
      try {
        await authClient.signOut({});
      } finally {
        location.href = "/";
      }
    } catch (error) {
      console.error("Account deletion failed:", error);
      toast.error(t("profile.deleteFailed"));
      setIsDeleting(false);
      setDeleteDialogOpen(false);
    }
  };

  const handleSignOut = async () => {
    try {
      await authClient.signOut({
        fetchOptions: {
          onSuccess: () => {
            location.reload();
          },
        },
      });
    } catch (error) {
      console.error("Sign-out failed:", error);
      toast.error(t("auth.signOutError"));
    }
  };

  const handleRequestPasswordReset = async () => {
    setResetStatusMessage("");
    setIsSendingReset(true);

    try {
      const response = await fetch("/api/auth/request-password-reset", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          email: user.email,
          redirectTo: getPasswordResetRedirectURL(),
        }),
      });
      const payload = (await response.json().catch(() => null)) as
        | { message?: string }
        | null;

      if (!response.ok) {
        throw new Error(payload?.message || t("auth.resetLinkFailed"));
      }

      const message = payload?.message || t("auth.resetLinkSent");
      setResetStatusMessage(message);
      toast.success(message);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : t("auth.resetLinkFailed");
      setResetStatusMessage(message);
      toast.error(message);
    } finally {
      setIsSendingReset(false);
    }
  };

  return (
    <div className="bg-background">
      <div className="container mx-auto max-w-2xl px-4 py-8 sm:py-12">
        {/* Identity. The avatar and the name are the page title — they do not
            need a surface to say so. */}
        <header className="flex flex-col gap-5 sm:flex-row sm:items-center">
          {avatarSrc ? (
            <img
              src={avatarSrc}
              alt={displayName}
              className="size-16 rounded-full object-cover"
            />
          ) : (
            <div className="flex size-16 items-center justify-center rounded-full bg-muted text-xl font-semibold text-foreground">
              {avatarFallback}
            </div>
          )}
          <div className="min-w-0 space-y-1">
            <p className="text-sm text-muted-foreground">
              {t("profile.account")}
            </p>
            <h1 className="break-words text-3xl font-semibold tracking-tight text-foreground">
              {displayName}
            </h1>
          </div>
        </header>

        <dl className="mt-8 grid gap-5 border-t border-border pt-6 sm:grid-cols-2">
          <div>
            <dt className="text-sm text-muted-foreground">
              {t("profile.emailLabel")}
            </dt>
            <dd className="mt-1 break-all text-sm text-foreground">
              {user.email}
            </dd>
          </div>
          <div>
            <dt className="text-sm text-muted-foreground">
              {t("profile.security")}
            </dt>
            <dd className="mt-1 flex items-center gap-1.5 text-sm text-foreground">
              {user.emailVerified ? (
                <>
                  <CheckCircle2 className="size-4 shrink-0 text-success" />
                  <span>{t("profile.verified")}</span>
                </>
              ) : (
                <span>{t("auth.checkEmailVerify")}</span>
              )}
            </dd>
          </div>
        </dl>

        {/* Settings rows: label + description on the left, control on the
            right, separated by hairlines. */}
        <section className="mt-10 border-t border-border pt-6">
          <SectionTitle>
            {t("profile.settings")}
          </SectionTitle>
          <div className="mt-5 divide-y divide-border">
            <div className="flex flex-col gap-4 pb-5 sm:flex-row sm:items-center sm:justify-between">
              <div className="space-y-1">
                <p className="text-sm font-medium text-foreground">
                  {t("settings.language")}
                </p>
                <p className="max-w-[55ch] text-sm text-muted-foreground">
                  {t("profile.settingsBody")}
                </p>
              </div>
              <LanguagePicker />
            </div>

            <div className="flex flex-col gap-4 pt-5 sm:flex-row sm:items-center sm:justify-between">
              <div className="space-y-1">
                <p className="text-sm font-medium text-foreground">
                  {t("profile.theme")}
                </p>
                <p className="max-w-[55ch] text-sm text-muted-foreground">
                  {t("profile.themeBody")}
                </p>
              </div>
              <ThemePicker />
            </div>
          </div>
        </section>

        <section className="mt-10 border-t border-border pt-6">
          <SectionTitle>
            {t("profile.security")}
          </SectionTitle>
          <p className="mt-1 max-w-[55ch] text-sm text-muted-foreground">
            {t("profile.securityBody")}
          </p>

          <div className="mt-5 flex flex-wrap gap-3">
            <Button
              type="button"
              variant="outline"
              disabled={isSendingReset}
              onClick={() => void handleRequestPasswordReset()}
            >
              <KeyRound className="size-4" />
              <span>
                {isSendingReset
                  ? t("auth.resetSendingStatus")
                  : t("profile.changePassword")}
              </span>
            </Button>

            <Button
              type="button"
              variant="outline"
              disabled={isExporting}
              onClick={() => void handleDownloadData()}
            >
              <Download className="size-4" />
              <span>{t("profile.downloadData")}</span>
            </Button>

            <Button type="button" variant="ghost" onClick={handleSignOut}>
              <LogOut className="size-4" />
              <span>{t("auth.signOut")}</span>
            </Button>
          </div>

          {/* Reset feedback: plain text, no banner box (native DESIGN_LOG —
              boxed form notices removed). */}
          {resetStatusMessage ? (
            <p
              className="mt-4 text-sm text-muted-foreground"
              role="status"
              aria-live="polite"
            >
              {resetStatusMessage}
            </p>
          ) : null}
        </section>

        <section className="mt-10 border-t border-border pt-6">
          <SectionTitle>
            {t("profile.deleteAccount")}
          </SectionTitle>
          <p className="mt-1 max-w-[55ch] text-sm text-muted-foreground">
            {t("profile.deleteConfirm")}
          </p>
          <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
            <DialogTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                className="mt-4 text-destructive hover:bg-destructive/10 hover:text-destructive"
                disabled={isDeleting}
              >
                <Trash2 className="size-4" />
                <span>{t("profile.deleteAccount")}</span>
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{t("profile.deleteDialogTitle")}</DialogTitle>
                <DialogDescription>
                  {t("profile.deleteConfirm")}
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <DialogClose asChild>
                  <Button type="button" variant="outline" disabled={isDeleting}>
                    {t("profile.deleteCancel")}
                  </Button>
                </DialogClose>
                <Button
                  type="button"
                  variant="destructive"
                  disabled={isDeleting}
                  onClick={() => void handleDeleteAccount()}
                >
                  <Trash2 className="size-4" />
                  <span>{t("profile.deleteAccount")}</span>
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </section>
      </div>
    </div>
  );
}
