import { useState } from "react";
import {
  CheckCircle2,
  Download,
  Globe2,
  KeyRound,
  LogOut,
  Palette,
  Trash2,
} from "lucide-react";
import { useConvex, useMutation } from "convex/react";
import { api } from "@news-app/backend/convex/_generated/api";
import { authClient } from "@/lib/auth-client";
import { LanguagePicker } from "@/components/LanguagePicker";
import { ThemePicker } from "@/components/theme/ThemePicker";
import { useT } from "@/lib/i18n/LocaleContext";
import { absoluteSiteUrl } from "@/lib/seo";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
      <div className="container mx-auto max-w-4xl px-4 py-8 sm:py-10">
        <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(280px,1fr)]">
          <div className="space-y-6">
            <Card>
              <CardContent className="pt-6">
                <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
                  {avatarSrc ? (
                    <img
                      src={avatarSrc}
                      alt={displayName}
                      className="size-18 rounded-xl object-cover"
                    />
                  ) : (
                    <div className="flex size-18 items-center justify-center rounded-xl bg-muted text-xl font-semibold text-foreground">
                      {avatarFallback}
                    </div>
                  )}

                  <div className="min-w-0 space-y-3">
                    <p className="text-sm text-muted-foreground">
                      {t("profile.account")}
                    </p>
                    <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
                      {displayName}
                    </h1>
                    <dl className="grid gap-3 text-sm sm:grid-cols-2">
                      <div>
                        <dt className="text-xs uppercase tracking-[0.14em] text-muted-foreground">
                          {t("profile.emailLabel")}
                        </dt>
                        <dd className="mt-1 break-all text-card-foreground">
                          {user.email}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-xs uppercase tracking-[0.14em] text-muted-foreground">
                          {t("profile.security")}
                        </dt>
                        <dd className="mt-1 text-card-foreground">
                          {user.emailVerified
                            ? t("profile.verified")
                            : t("auth.checkEmailVerify")}
                        </dd>
                      </div>
                    </dl>
                    {user.emailVerified ? (
                      <div className="inline-flex items-center gap-2 rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
                        <CheckCircle2 className="size-4 text-success" />
                        <span>{t("profile.verified")}</span>
                      </div>
                    ) : null}
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="border-b">
                <CardTitle>{t("profile.settings")}</CardTitle>
              </CardHeader>
              <CardContent className="pt-6">
                <div className="space-y-5">
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="space-y-1">
                      <div className="inline-flex items-center gap-2 text-sm font-medium text-card-foreground">
                        <Globe2 className="size-4 text-primary" />
                        <span>{t("settings.language")}</span>
                      </div>
                      <p className="text-sm text-muted-foreground">
                        {t("profile.settingsBody")}
                      </p>
                    </div>
                    <LanguagePicker />
                  </div>

                  <div className="border-t pt-5">
                    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                      <div className="space-y-1">
                        <div className="inline-flex items-center gap-2 text-sm font-medium text-card-foreground">
                          <Palette className="size-4 text-primary" />
                          <span>{t("profile.theme")}</span>
                        </div>
                        <p className="text-sm text-muted-foreground">
                          {t("profile.themeBody")}
                        </p>
                      </div>
                      <ThemePicker />
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="space-y-6">
            <Card>
              <CardHeader className="border-b">
                <CardTitle>{t("profile.security")}</CardTitle>
                <CardDescription>{t("profile.securityBody")}</CardDescription>
              </CardHeader>
              <CardContent className="pt-6">
                <div className="space-y-3">
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full justify-between"
                    disabled={isSendingReset}
                    onClick={() => void handleRequestPasswordReset()}
                  >
                    <span>
                      {isSendingReset
                        ? t("auth.resetSendingStatus")
                        : t("profile.changePassword")}
                    </span>
                    <KeyRound className="size-4" />
                  </Button>

                  <Button
                    type="button"
                    variant="outline"
                    className="w-full justify-between"
                    disabled={isExporting}
                    onClick={() => void handleDownloadData()}
                  >
                    <span>{t("profile.downloadData")}</span>
                    <Download className="size-4" />
                  </Button>

                  <Button
                    variant="destructive"
                    className="w-full justify-between"
                    onClick={handleSignOut}
                  >
                    <span>{t("auth.signOut")}</span>
                    <LogOut className="size-4" />
                  </Button>

                  <Dialog
                    open={deleteDialogOpen}
                    onOpenChange={setDeleteDialogOpen}
                  >
                    <DialogTrigger asChild>
                      <Button
                        type="button"
                        variant="outline"
                        className="w-full justify-between border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
                        disabled={isDeleting}
                      >
                        <span>{t("profile.deleteAccount")}</span>
                        <Trash2 className="size-4" />
                      </Button>
                    </DialogTrigger>
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>
                          {t("profile.deleteDialogTitle")}
                        </DialogTitle>
                        <DialogDescription>
                          {t("profile.deleteConfirm")}
                        </DialogDescription>
                      </DialogHeader>
                      <DialogFooter>
                        <DialogClose asChild>
                          <Button
                            type="button"
                            variant="outline"
                            disabled={isDeleting}
                          >
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
                </div>

                {resetStatusMessage ? (
                  <div
                    className="mt-4 rounded-lg border border-border bg-muted/30 px-4 py-3"
                    role="status"
                    aria-live="polite"
                  >
                    <p className="text-sm text-muted-foreground">
                      {resetStatusMessage}
                    </p>
                  </div>
                ) : null}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
