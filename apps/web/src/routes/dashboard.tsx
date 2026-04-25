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
import {
  Bookmark,
  Loader2,
  Newspaper,
  Settings,
  TrendingUp,
  User,
} from "lucide-react";

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
        <div className="min-h-[calc(100vh-4rem)] flex items-center justify-center bg-muted/20 px-4 py-12">
          <div className="w-full max-w-md">
            {showSignIn ? (
              <SignInForm onSwitchToSignUp={() => setShowSignIn(false)} />
            ) : (
              <SignUpForm onSwitchToSignIn={() => setShowSignIn(true)} />
            )}
          </div>
        </div>
      </Unauthenticated>
      <AuthLoading>
        <div className="min-h-[calc(100vh-4rem)] flex items-center justify-center">
          <div className="flex flex-col items-center gap-4">
            <Loader2 className="size-8 text-primary animate-spin" />
            <p className="text-sm text-muted-foreground">Loading...</p>
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
      <div className="min-h-[calc(100vh-4rem)] flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="size-8 text-primary animate-spin" />
          <p className="text-sm text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  const userName = currentUser?.profile?.name || currentUser?.email || "User";
  const userEmail = currentUser?.email;

  return (
    <div className="min-h-[calc(100vh-4rem)]">
      {/* Page Header */}
      <div className="border-b border-border bg-muted/20">
        <div className="container mx-auto max-w-5xl px-4 py-8">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="flex items-center justify-center size-14 rounded-2xl bg-primary/10 text-primary font-bold text-xl">
                {userName.charAt(0).toUpperCase()}
              </div>
              <div>
                <h1 className="text-2xl font-bold tracking-tight">
                  Welcome back, {userName.split(" ")[0]}
                </h1>
                <p className="text-muted-foreground">{userEmail}</p>
              </div>
            </div>
            <UserMenu />
          </div>
        </div>
      </div>

      {/* Dashboard Content */}
      <div className="container mx-auto max-w-5xl px-4 py-8">
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {/* Quick Stats */}
          <Card className="border-border">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Reading Streak
              </CardTitle>
              <TrendingUp className="size-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">0 days</div>
              <p className="text-xs text-muted-foreground mt-1">
                Start reading to build your streak
              </p>
            </CardContent>
          </Card>

          <Card className="border-border">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Bookmarks
              </CardTitle>
              <Bookmark className="size-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">0</div>
              <p className="text-xs text-muted-foreground mt-1">
                Saved for later
              </p>
            </CardContent>
          </Card>

          <Card className="border-border">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Articles Read
              </CardTitle>
              <Newspaper className="size-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">0</div>
              <p className="text-xs text-muted-foreground mt-1">This week</p>
            </CardContent>
          </Card>
        </div>

        {/* Quick Actions */}
        <div className="mt-8">
          <h2 className="text-lg font-semibold mb-4">Quick Actions</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Link to="/feed" className="block">
              <Card className="border-border hover:border-primary/30 transition-colors cursor-pointer h-full">
                <CardContent className="flex items-center gap-4 p-6">
                  <div className="flex items-center justify-center size-12 rounded-xl bg-primary/10 text-primary">
                    <Newspaper className="size-6" />
                  </div>
                  <div>
                    <h3 className="font-semibold">Browse Feed</h3>
                    <p className="text-sm text-muted-foreground">
                      See today&apos;s stories
                    </p>
                  </div>
                </CardContent>
              </Card>
            </Link>

            <Link to="/bookmarks" className="block">
              <Card className="border-border hover:border-primary/30 transition-colors cursor-pointer h-full">
                <CardContent className="flex items-center gap-4 p-6">
                  <div className="flex items-center justify-center size-12 rounded-xl bg-primary/10 text-primary">
                    <Bookmark className="size-6" />
                  </div>
                  <div>
                    <h3 className="font-semibold">Bookmarks</h3>
                    <p className="text-sm text-muted-foreground">
                      Saved stories
                    </p>
                  </div>
                </CardContent>
              </Card>
            </Link>

            <Card className="border-border opacity-60 h-full">
              <CardContent className="flex items-center gap-4 p-6">
                <div className="flex items-center justify-center size-12 rounded-xl bg-muted text-muted-foreground">
                  <User className="size-6" />
                </div>
                <div>
                  <h3 className="font-semibold">Profile</h3>
                  <p className="text-sm text-muted-foreground">Coming soon</p>
                </div>
              </CardContent>
            </Card>

            <Card className="border-border opacity-60 h-full">
              <CardContent className="flex items-center gap-4 p-6">
                <div className="flex items-center justify-center size-12 rounded-xl bg-muted text-muted-foreground">
                  <Settings className="size-6" />
                </div>
                <div>
                  <h3 className="font-semibold">Settings</h3>
                  <p className="text-sm text-muted-foreground">Coming soon</p>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>

        {/* Debug info - only in development */}
        {privateData?.message && (
          <div className="mt-8 p-4 rounded-lg bg-muted/50 border border-border">
            <p className="text-xs text-muted-foreground font-mono">
              Debug: {privateData.message}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
