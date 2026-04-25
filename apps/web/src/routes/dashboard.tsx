import SignInForm from "@/components/sign-in-form";
import SignUpForm from "@/components/sign-up-form";
import UserMenu from "@/components/user-menu";
import { api } from "@news-app/backend/convex/_generated/api";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  Authenticated,
  AuthLoading,
  Unauthenticated,
  useQuery,
} from "convex/react";
import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/dashboard")({
  head: () => ({
    meta: [
      { title: "Dashboard — Biviant" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: RouteComponent,
});

function RouteComponent() {
  const [showSignIn, setShowSignIn] = useState(false);

  return (
    <>
      <Authenticated>
        <AuthenticatedDashboard />
      </Authenticated>
      <Unauthenticated>
        <div className="bg-gradient-to-b from-background via-background to-muted/35 min-h-[calc(100vh-4rem)]">
          <div className="container mx-auto max-w-4xl px-4 py-8 sm:py-10">
            <div className="flex items-center justify-center py-12">
              <div className="w-full max-w-md">
                {showSignIn ? (
                  <SignInForm onSwitchToSignUp={() => setShowSignIn(false)} />
                ) : (
                  <SignUpForm onSwitchToSignIn={() => setShowSignIn(true)} />
                )}
              </div>
            </div>
          </div>
        </div>
      </Unauthenticated>
      <AuthLoading>
        <div className="bg-gradient-to-b from-background via-background to-muted/35 min-h-[calc(100vh-4rem)]">
          <div className="container mx-auto max-w-4xl px-4 py-8 sm:py-10">
            <div className="flex flex-col items-center justify-center py-20 gap-4">
              <div className="rounded-[1.2rem] border border-border/70 bg-card/70 px-6 py-8 text-sm text-muted-foreground">
                Loading...
              </div>
            </div>
          </div>
        </div>
      </AuthLoading>
    </>
  );
}

function AuthenticatedDashboard() {
  const currentUser = useQuery(api.user.getCurrentUser);
  const privateData = useQuery(api.privateData.get);

  if (currentUser === undefined) {
    return (
      <div className="bg-gradient-to-b from-background via-background to-muted/35 min-h-[calc(100vh-4rem)]">
        <div className="container mx-auto max-w-4xl px-4 py-8 sm:py-10">
          <div className="flex flex-col items-center justify-center py-20 gap-4">
            <div className="rounded-[1.2rem] border border-border/70 bg-card/70 px-6 py-8 text-sm text-muted-foreground">
              Loading...
            </div>
          </div>
        </div>
      </div>
    );
  }

  const userName = currentUser?.profile?.name || currentUser?.email || "User";
  const userEmail = currentUser?.email;

  return (
    <div className="bg-gradient-to-b from-background via-background to-muted/35">
      <div className="container mx-auto max-w-4xl px-4 py-8 sm:py-10">
        <div className="flex flex-col gap-8">
          {/* Header */}
          <header className="overflow-hidden rounded-[1.6rem] border border-border/70 bg-card/80 shadow-sm">
            <div className="bg-gradient-to-br from-background via-card to-muted/50 px-6 py-8 sm:px-8 sm:py-10">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className="flex items-center justify-center size-16 rounded-full bg-primary/10 text-primary font-bold text-2xl">
                    {userName.charAt(0).toUpperCase()}
                  </div>
                  <div className="flex flex-col gap-1">
                    <p className="text-xs font-semibold uppercase tracking-[0.24em] text-muted-foreground">
                      Welcome back
                    </p>
                    <h1 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
                      {userName.split(" ")[0]}
                    </h1>
                    <p className="text-sm text-muted-foreground">{userEmail}</p>
                  </div>
                </div>
                <UserMenu />
              </div>
            </div>
          </header>

          {/* Stats Grid */}
          <div className="grid gap-4 sm:grid-cols-3">
            <Card className="overflow-hidden rounded-[1.2rem] border-border/70 bg-card/80 py-0">
              <CardHeader className="border-b border-border/70 bg-muted/30 py-4 px-5">
                <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                  <svg className="size-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 18L9 11.25l4.306 4.307a11.95 11.95 0 015.814-5.519l2.74-1.22m0 0l-5.94-2.28m5.94 2.28l-2.28 5.941" />
                  </svg>
                  Reading Streak
                </CardTitle>
              </CardHeader>
              <CardContent className="px-5 py-5">
                <div className="text-3xl font-bold">0 days</div>
                <p className="text-xs text-muted-foreground mt-1">
                  Start reading to build your streak
                </p>
              </CardContent>
            </Card>

            <Card className="overflow-hidden rounded-[1.2rem] border-border/70 bg-card/80 py-0">
              <CardHeader className="border-b border-border/70 bg-muted/30 py-4 px-5">
                <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                  <svg className="size-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M17.593 3.322c1.1.128 1.907 1.077 1.907 2.185V21L12 17.25 4.5 21V5.507c0-1.108.806-2.057 1.907-2.185a48.507 48.507 0 0111.186 0z" />
                  </svg>
                  Bookmarks
                </CardTitle>
              </CardHeader>
              <CardContent className="px-5 py-5">
                <div className="text-3xl font-bold">0</div>
                <p className="text-xs text-muted-foreground mt-1">
                  Saved for later
                </p>
              </CardContent>
            </Card>

            <Card className="overflow-hidden rounded-[1.2rem] border-border/70 bg-card/80 py-0">
              <CardHeader className="border-b border-border/70 bg-muted/30 py-4 px-5">
                <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                  <svg className="size-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 7.5h1.5m-1.5 3h1.5m-7.5 3h7.5m-7.5 3h7.5m3-9h3.375c.621 0 1.125.504 1.125 1.125V18a2.25 2.25 0 01-2.25 2.25M16.5 7.5V18a2.25 2.25 0 002.25 2.25M16.5 7.5V4.875c0-.621-.504-1.125-1.125-1.125H4.125C3.504 3.75 3 4.254 3 4.875V18a2.25 2.25 0 002.25 2.25h13.5M6 7.5h3v3H6v-3z" />
                  </svg>
                  Articles Read
                </CardTitle>
              </CardHeader>
              <CardContent className="px-5 py-5">
                <div className="text-3xl font-bold">0</div>
                <p className="text-xs text-muted-foreground mt-1">This week</p>
              </CardContent>
            </Card>
          </div>

          {/* Quick Actions */}
          <section className="flex flex-col gap-4">
            <div className="flex items-center justify-between gap-4">
              <h2 className="text-lg font-semibold tracking-tight text-foreground">
                Quick Actions
              </h2>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Link to="/feed" className="block group">
                <Card className="overflow-hidden rounded-[1.2rem] border-border/70 bg-card/80 py-0 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg">
                  <CardContent className="flex items-center gap-4 p-6">
                    <div className="flex items-center justify-center size-14 rounded-full bg-primary/10 text-primary group-hover:bg-primary group-hover:text-primary-foreground transition-colors">
                      <svg className="size-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 7.5h1.5m-1.5 3h1.5m-7.5 3h7.5m-7.5 3h7.5m3-9h3.375c.621 0 1.125.504 1.125 1.125V18a2.25 2.25 0 01-2.25 2.25M16.5 7.5V18a2.25 2.25 0 002.25 2.25M16.5 7.5V4.875c0-.621-.504-1.125-1.125-1.125H4.125C3.504 3.75 3 4.254 3 4.875V18a2.25 2.25 0 002.25 2.25h13.5M6 7.5h3v3H6v-3z" />
                      </svg>
                    </div>
                    <div>
                      <h3 className="font-semibold text-lg">Browse Feed</h3>
                      <p className="text-sm text-muted-foreground">
                        See today&apos;s stories
                      </p>
                    </div>
                  </CardContent>
                </Card>
              </Link>

              <Link to="/bookmarks" className="block group">
                <Card className="overflow-hidden rounded-[1.2rem] border-border/70 bg-card/80 py-0 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg">
                  <CardContent className="flex items-center gap-4 p-6">
                    <div className="flex items-center justify-center size-14 rounded-full bg-primary/10 text-primary group-hover:bg-primary group-hover:text-primary-foreground transition-colors">
                      <svg className="size-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M17.593 3.322c1.1.128 1.907 1.077 1.907 2.185V21L12 17.25 4.5 21V5.507c0-1.108.806-2.057 1.907-2.185a48.507 48.507 0 0111.186 0z" />
                      </svg>
                    </div>
                    <div>
                      <h3 className="font-semibold text-lg">Bookmarks</h3>
                      <p className="text-sm text-muted-foreground">
                        Saved stories
                      </p>
                    </div>
                  </CardContent>
                </Card>
              </Link>

              <Card className="overflow-hidden rounded-[1.2rem] border-border/70 bg-card/80 py-0 opacity-60">
                <CardContent className="flex items-center gap-4 p-6">
                  <div className="flex items-center justify-center size-14 rounded-full bg-muted text-muted-foreground">
                    <svg className="size-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
                    </svg>
                  </div>
                  <div>
                    <h3 className="font-semibold text-lg">Profile</h3>
                    <p className="text-sm text-muted-foreground">Coming soon</p>
                  </div>
                </CardContent>
              </Card>

              <Card className="overflow-hidden rounded-[1.2rem] border-border/70 bg-card/80 py-0 opacity-60">
                <CardContent className="flex items-center gap-4 p-6">
                  <div className="flex items-center justify-center size-14 rounded-full bg-muted text-muted-foreground">
                    <svg className="size-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z" />
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                  </div>
                  <div>
                    <h3 className="font-semibold text-lg">Settings</h3>
                    <p className="text-sm text-muted-foreground">Coming soon</p>
                  </div>
                </CardContent>
              </Card>
            </div>
          </section>

          {/* Debug info - only in development */}
          {privateData?.message && (
            <div className="rounded-[1rem] bg-muted/50 border border-border/70 p-4">
              <p className="text-xs text-muted-foreground font-mono">
                Debug: {privateData.message}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
