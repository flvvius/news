import { Bell, LogOut, MoonStar, ShieldCheck, User2 } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";

type AuthenticatedProfileUser = {
  email: string;
  image?: string | null;
  name?: string | null;
  profile?: {
    avatar?: string;
    name?: string;
  };
};

function getInitials(name: string) {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("");
}

export function AuthenticatedProfile({
  user,
}: {
  user: AuthenticatedProfileUser;
}) {
  const displayName = user.profile?.name || user.name || user.email;
  const avatarSrc = user.profile?.avatar || user.image || undefined;
  const initials = getInitials(displayName);

  const handleSignOut = async () => {
    await authClient.signOut({
      fetchOptions: {
        onSuccess: () => {
          location.reload();
        },
      },
    });
  };

  return (
    <div className="bg-gradient-to-b from-background via-background to-muted/20">
      <div className="container mx-auto max-w-4xl px-4 py-10 sm:py-14">
        <div className="space-y-6">
          <section className="rounded-[1.75rem] border border-border/70 bg-card/80 p-6 shadow-sm sm:p-8">
            <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
              {avatarSrc ? (
                <img
                  src={avatarSrc}
                  alt={displayName}
                  className="size-20 rounded-3xl object-cover"
                />
              ) : (
                <div className="flex size-20 items-center justify-center rounded-3xl bg-primary/10 text-2xl font-semibold text-primary">
                  {initials || "B"}
                </div>
              )}

              <div className="min-w-0">
                <p className="text-sm font-semibold uppercase tracking-[0.24em] text-primary">
                  Contul tău
                </p>
                <h1 className="mt-2 truncate text-3xl font-bold tracking-tight">
                  {displayName}
                </h1>
                <p className="mt-1 truncate text-sm text-muted-foreground">
                  {user.email}
                </p>
              </div>
            </div>
          </section>

          <section className="rounded-[1.5rem] border border-border/70 bg-card/80 p-6 shadow-sm">
            <div className="flex items-center gap-3">
              <MoonStar className="size-5 text-primary" />
              <div>
                <h2 className="font-semibold">Setări</h2>
                <p className="text-sm text-muted-foreground">
                  Opțiuni rapide pentru preferințele tale.
                </p>
              </div>
            </div>

            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              <div className="rounded-2xl border border-border/70 bg-muted/30 p-4">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <MoonStar className="size-4 text-primary" />
                  Temă
                </div>
                <p className="mt-2 text-sm text-muted-foreground">
                  Selectorul de temă va fi disponibil în curând.
                </p>
                <Button
                  variant="outline"
                  className="mt-4 w-full justify-start"
                  disabled
                >
                  În curând
                </Button>
              </div>

              <div className="rounded-2xl border border-border/70 bg-muted/30 p-4">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <Bell className="size-4 text-primary" />
                  Notificări
                </div>
                <p className="mt-2 text-sm text-muted-foreground">
                  Preferințele pentru alerte și rezumate vor apărea aici.
                </p>
                <Button
                  variant="outline"
                  className="mt-4 w-full justify-start"
                  disabled
                >
                  În curând
                </Button>
              </div>
            </div>
          </section>

          <section className="rounded-[1.5rem] border border-border/70 bg-card/80 p-6 shadow-sm">
            <div className="flex items-center gap-3">
              <User2 className="size-5 text-primary" />
              <div>
                <h2 className="font-semibold">Cont</h2>
                <p className="text-sm text-muted-foreground">
                  Informațiile tale de autentificare și opțiunile sensibile ale
                  contului.
                </p>
              </div>
            </div>

            <div className="mt-5 space-y-3">
              <div className="rounded-2xl border border-border/70 bg-muted/20 p-4">
                <p className="text-sm font-medium">Email</p>
                <p className="mt-1 text-sm text-muted-foreground">{user.email}</p>
              </div>

              <div className="flex flex-col gap-3 sm:flex-row">
                <Button asChild variant="outline" className="sm:flex-1">
                  <Link to="/reset-password">Schimbă parola</Link>
                </Button>
                <Button asChild variant="outline" className="sm:flex-1">
                  <Link to="/contact">Solicită ștergerea contului</Link>
                </Button>
              </div>

              <div className="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-4 text-sm text-muted-foreground">
                <div className="flex items-center gap-2 font-medium text-foreground">
                  <ShieldCheck className="size-4 text-amber-600" />
                  Siguranța contului
                </div>
                <p className="mt-2">
                  Dacă vrei modificări mai sensibile, ne poți scrie din pagina
                  de contact și te ajutăm manual.
                </p>
              </div>
            </div>
          </section>

          <Button
            variant="destructive"
            size="lg"
            className="w-full"
            onClick={handleSignOut}
          >
            <LogOut className="size-4" />
            Deconectare
          </Button>
        </div>
      </div>
    </div>
  );
}
