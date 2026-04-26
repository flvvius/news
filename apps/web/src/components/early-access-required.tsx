import { Link } from "@tanstack/react-router";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import EarlyAccessApplyCard from "@/components/early-access-apply-card";
import type { AuthRedirectPath } from "@/lib/auth-redirect";

type AccessState = {
  authenticated: boolean;
  email: string | null;
  waitlistStatus:
    | "pending"
    | "invited"
    | "converted"
    | "bounced"
    | "unsubscribed"
    | null;
  waitlistPosition: number | null;
};

type EarlyAccessRequiredProps = {
  access: AccessState;
  redirectTo: AuthRedirectPath;
  surfaceName: string;
};

export default function EarlyAccessRequired({
  access,
  redirectTo,
  surfaceName,
}: EarlyAccessRequiredProps) {
  const isPendingWaitlist = access.waitlistStatus === "pending";

  const title = access.authenticated
    ? isPendingWaitlist
      ? "You're on the waitlist"
      : "This account doesn't have beta access yet"
    : "Early access required";

  const description = access.authenticated
    ? isPendingWaitlist
      ? `You're signed in as ${access.email}. We'll email this address as soon as your beta access is ready${access.waitlistPosition ? ` (#${access.waitlistPosition} on the waitlist)` : ""}.`
      : `You're signed in as ${access.email}, but ${surfaceName} is still limited to invited beta users. If you joined the waitlist with a different email, sign out and use that invite instead.`
    : `${surfaceName} is currently available to invited beta users. Sign in with the email address from your invite, or apply for access below.`;

  if (!access.authenticated) {
    return (
      <div className="bg-linear-to-b from-background via-background to-muted/35 min-h-[calc(100vh-4rem)]">
        <div className="container mx-auto max-w-6xl px-4 py-10 sm:py-14">
          <div className="grid gap-6 lg:grid-cols-[1.05fr_0.95fr]">
            <div className="space-y-6">
              <EarlyAccessApplyCard />

              <Card className="border-border/70 bg-card/90">
                <CardHeader>
                  <CardTitle className="text-lg">Already applied?</CardTitle>
                  <p className="text-sm text-muted-foreground">
                    If you already joined the waitlist or received an invite, try creating or signing in to your beta account with that same email address.
                  </p>
                </CardHeader>
                <CardContent className="flex flex-wrap gap-3">
                  <Link to="/dashboard" search={{ redirect: redirectTo }}>
                    <Button>Sign in or create your beta account</Button>
                  </Link>
                  <Link to="/">
                    <Button variant="ghost">Back to homepage</Button>
                  </Link>
                </CardContent>
              </Card>
            </div>

            <Card className="border-border/70 bg-card/90">
              <CardHeader>
                <p className="text-xs font-semibold uppercase tracking-[0.22em] text-muted-foreground">
                  Private Beta
                </p>
                <CardTitle className="text-3xl tracking-tight">{title}</CardTitle>
                <p className="max-w-[60ch] text-sm text-muted-foreground">
                  {description}
                </p>
              </CardHeader>
              <CardContent className="space-y-2 text-sm text-muted-foreground">
                <p>1. Join the waitlist with the email you want to use.</p>
                <p>2. We’ll email you when your beta slot is ready.</p>
                <p>3. Create or sign in to your account with that same email.</p>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-linear-to-b from-background via-background to-muted/35 min-h-[calc(100vh-4rem)]">
      <div className="container mx-auto max-w-5xl px-4 py-10 sm:py-14">
        <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
          <Card className="border-border/70 bg-card/90">
            <CardHeader>
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-muted-foreground">
                Private Beta
              </p>
              <CardTitle className="text-3xl tracking-tight">{title}</CardTitle>
              <p className="max-w-[60ch] text-sm text-muted-foreground">
                {description}
              </p>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-3">
              {!access.authenticated ? (
                <Link to="/dashboard" search={{ redirect: redirectTo }}>
                  <Button>Sign in or create your beta account</Button>
                </Link>
              ) : (
                <>
                  <Link to="/dashboard">
                    <Button>View access status</Button>
                  </Link>
                  <Button
                    variant="outline"
                    onClick={async () => {
                      await authClient.signOut({
                        fetchOptions: {
                          onSuccess: () => {
                            location.href = "/dashboard";
                          },
                        },
                      });
                    }}
                  >
                    Sign out
                  </Button>
                </>
              )}
              <Link to="/">
                <Button variant="ghost">Back to homepage</Button>
              </Link>
            </CardContent>
          </Card>

          <Card className="border-border/70 bg-card/90">
            <CardHeader>
              <CardTitle className="text-lg">How access works</CardTitle>
              <p className="text-sm text-muted-foreground">
                Beta access is tied to the email address we invite from the waitlist.
              </p>
            </CardHeader>
            <CardContent className="space-y-2 text-sm text-muted-foreground">
              <p>1. Join the waitlist with the email you want to use.</p>
              <p>2. We’ll email you when your beta slot is ready.</p>
              <p>3. Create or sign in to your account with that same email.</p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
