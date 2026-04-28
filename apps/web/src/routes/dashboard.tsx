import SignInForm from "@/components/sign-in-form";
import SignUpForm from "@/components/sign-up-form";
import UserMenu from "@/components/user-menu";
import EarlyAccessApplyCard from "@/components/early-access-apply-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@news-app/backend/convex/_generated/api";
import type { Id } from "@news-app/backend/convex/_generated/dataModel";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation as useTanStackMutation } from "@tanstack/react-query";
import { useConvexMutation } from "@convex-dev/react-query";
import {
  Authenticated,
  AuthLoading,
  Unauthenticated,
  useMutation as useConvexMutationHook,
  useQuery,
} from "convex/react";
import type { FormEvent } from "react";
import { useEffect, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { authClient } from "@/lib/auth-client";
import {
  isAuthRedirectPath,
  type AuthRedirectPath,
} from "@/lib/auth-redirect";
import { consumeBetaWelcomeToast } from "@/lib/beta-welcome";
import { z } from "zod";

const searchSchema = z.object({
  code: z.string().optional(),
  mode: z.enum(["signin", "signup"]).optional(),
  redirect: z.string().optional(),
});

export const Route = createFileRoute("/dashboard")({
  validateSearch: searchSchema,
  head: () => ({
    meta: [
      { title: "Dashboard — Biviant" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: RouteComponent,
});

function RouteComponent() {
  const search = Route.useSearch();
  const redirectTo: AuthRedirectPath = search.redirect &&
    isAuthRedirectPath(search.redirect)
      ? search.redirect
      : "/feed";
  const invitePreview = useQuery(
    api.waitlist.getInvitePreview,
    search.code ? { inviteCode: search.code } : "skip",
  );
  const [showSignIn, setShowSignIn] = useState(search.mode === "signin");
  const userToggledAuthModeRef = useRef(false);

  useEffect(() => {
    if (userToggledAuthModeRef.current) {
      return;
    }

    if (search.mode === "signin") {
      setShowSignIn(true);
      return;
    }

    if (invitePreview?.isValid && invitePreview.status === "invited") {
      setShowSignIn(false);
      return;
    }

    setShowSignIn(true);
  }, [invitePreview, search.mode]);

  const inviteIsLoading = search.code && invitePreview === undefined;
  const validInvite = invitePreview?.isValid ? invitePreview : null;
  const showInviteSignup =
    validInvite?.status === "invited" && !showSignIn;
  const showInvitedEmail = Boolean(validInvite?.email);

  return (
    <>
      <Authenticated>
        <AuthenticatedDashboard />
      </Authenticated>
      <Unauthenticated>
        <div className="bg-gradient-to-b from-background via-background to-muted/35 min-h-[calc(100vh-4rem)]">
          <div className="container mx-auto max-w-6xl px-4 py-8 sm:py-12">
            <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
              <div className="space-y-5">
                <div className="space-y-3">
                  <p className="text-xs font-semibold uppercase tracking-[0.22em] text-muted-foreground">
                    Biviant Beta
                  </p>
                  <h1 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
                    {validInvite?.status === "invited"
                      ? "Your beta access is ready"
                      : "Access your beta account"}
                  </h1>
                  <p className="max-w-[60ch] text-sm text-muted-foreground sm:text-base">
                    {validInvite?.status === "invited"
                      ? showInvitedEmail
                        ? `This invite is reserved for ${validInvite.email}. Create your account with that email to unlock the beta.`
                        : "This invite is active. Create your account with the same email address from your invite email to unlock the beta."
                      : validInvite?.status === "converted"
                        ? showInvitedEmail
                          ? `This email already has access. Sign in with ${validInvite.email} to continue.`
                          : "This invite has already been used. Sign in with the same email address from your invite email to continue."
                        : "Biviant is currently running as a private beta. If you've already been invited, sign in. If not, apply for early access below."}
                  </p>
                </div>

                {inviteIsLoading ? (
                  <div className="rounded-[1.2rem] border border-border/70 bg-card/80 px-6 py-8 text-sm text-muted-foreground">
                    Checking your invite...
                  </div>
                ) : (
                  <div className="w-full max-w-md">
                    {showInviteSignup ? (
                      <SignUpForm
                        key={`invite-signup-${validInvite?.email ?? "default"}`}
                        initialEmail={validInvite?.email ?? ""}
                        emailLocked={showInvitedEmail}
                        redirectTo={redirectTo}
                        title="Create your beta account"
                        subtitle={
                          showInvitedEmail
                            ? `Your access is reserved for ${validInvite?.email}. You can sign up with Google or email and password as long as you use that same email address.`
                            : "Use the same email address from your invite email to create your beta account, whether you choose Google or email and password."
                        }
                        submitLabel="Create beta account"
                        showGoogle
                        onSwitchToSignIn={() => {
                          userToggledAuthModeRef.current = true;
                          setShowSignIn(true);
                        }}
                      />
                    ) : (
                      <SignInForm
                        key={`signin-${validInvite?.email ?? "default"}`}
                        initialEmail={validInvite?.email ?? ""}
                        redirectTo={redirectTo}
                        title={
                          validInvite?.status === "converted"
                            ? "Sign in to continue"
                            : "Welcome back"
                        }
                        subtitle={
                          validInvite?.status === "converted"
                            ? showInvitedEmail
                              ? `Use ${validInvite.email} to access your beta account.`
                              : "Use the same email address from your invite email to access your beta account."
                            : "Sign in if your email already has beta access."
                        }
                        onSwitchToSignUp={
                          validInvite?.status === "invited"
                            ? () => {
                                userToggledAuthModeRef.current = true;
                                setShowSignIn(false);
                              }
                            : undefined
                        }
                      />
                    )}
                  </div>
                )}
              </div>

              <div className="space-y-6">
                {!validInvite ? (
                  <EarlyAccessApplyCard />
                ) : (
                  <Card className="border-border/70 bg-card/90">
                    <CardHeader>
                      <CardTitle className="text-lg">How beta access works</CardTitle>
                      <p className="text-sm text-muted-foreground">
                        Access is tied to the email address we invited from the waitlist.
                      </p>
                    </CardHeader>
                    <CardContent className="space-y-2 text-sm text-muted-foreground">
                      <p>1. Open your invite email.</p>
                      <p>2. Create or sign in with the invited email address.</p>
                      <p>3. Head straight into the feed once you're in.</p>
                    </CardContent>
                  </Card>
                )}

                {search.code && !inviteIsLoading && !validInvite && (
                  <Card className="border-border/70 bg-card/90">
                    <CardHeader>
                      <CardTitle className="text-lg">This invite link isn't active</CardTitle>
                    </CardHeader>
                    <CardContent className="text-sm text-muted-foreground">
                      If you already have access, sign in with your invited email. Otherwise, apply for early access and we’ll email you when your slot is ready.
                    </CardContent>
                  </Card>
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
  const access = useQuery(api.user.getCurrentUserAccess);

  useEffect(() => {
    if (access?.hasBetaAccess) {
      consumeBetaWelcomeToast();
    }
  }, [access?.hasBetaAccess]);

  if (access === undefined) {
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

  if (!access.hasBetaAccess) {
    return (
      <div className="bg-gradient-to-b from-background via-background to-muted/35 min-h-[calc(100vh-4rem)]">
        <div className="container mx-auto max-w-4xl px-4 py-8 sm:py-10">
          <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
            <Card className="border-border/70 bg-card/90">
              <CardHeader>
                <p className="text-xs font-semibold uppercase tracking-[0.22em] text-muted-foreground">
                  Beta Access
                </p>
                <CardTitle className="text-3xl tracking-tight">
                  {access.waitlistStatus === "pending"
                    ? "You're on the waitlist"
                    : "This email isn't enabled yet"}
                </CardTitle>
                <p className="text-sm text-muted-foreground">
                  {access.waitlistStatus === "pending"
                    ? `You're signed in as ${access.email}. We'll email this address as soon as your beta access is ready${access.waitlistPosition ? ` (#${access.waitlistPosition} on the waitlist)` : ""}.`
                    : `You're signed in as ${access.email}, but beta access is still limited to invited emails. If you joined the waitlist with another email, sign out and use that one instead.`}
                </p>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-3">
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
                <Button asChild variant="ghost">
                  <Link to="/">Back to homepage</Link>
                </Button>
              </CardContent>
            </Card>

            {access.waitlistStatus === "pending" ? (
              <Card className="border-border/70 bg-card/90">
                <CardHeader>
                  <CardTitle className="text-lg">What happens next</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 text-sm text-muted-foreground">
                  <p>1. We'll keep moving through the waitlist in order.</p>
                  <p>2. You'll receive a beta invite email when your slot opens.</p>
                  <p>3. Use that same email to sign back in and access the feed.</p>
                </CardContent>
              </Card>
            ) : (
              <EarlyAccessApplyCard compact />
            )}
          </div>
        </div>
      </div>
    );
  }

  return <AuthorizedDashboard />;
}

function AuthorizedDashboard() {
  const currentUser = useQuery(api.user.getCurrentUser);
  const privateData = useQuery(api.privateData.get);
  const isAdmin = useQuery(api.user.isCurrentUserAdmin);
  const waitlistOverview = useQuery(
    api.waitlist.getWaitlistAdminOverview,
    isAdmin ? { limit: 10 } : "skip",
  );
  const topicDiagnostics = useQuery(
    api.clustering.getRecentTopicInferenceDiagnosticsForAdmin,
    isAdmin ? { limit: 10 } : "skip",
  );
  const setConfig = useConvexMutationHook(api.config.set);
  const convexInviteWaitlistUser = useConvexMutation(
    api.waitlist.inviteWaitlistUser,
  );
  const convexInviteNextPendingUsers = useConvexMutation(
    api.waitlist.inviteNextPendingUsers,
  );
  const inviteWaitlistUser = useTanStackMutation({
    mutationFn: convexInviteWaitlistUser,
  });
  const inviteNextPendingUsers = useTanStackMutation({
    mutationFn: convexInviteNextPendingUsers,
  });
  const [minScoreInput, setMinScoreInput] = useState("");
  const [confidenceRatioInput, setConfidenceRatioInput] = useState("");
  const [maxTopicsInput, setMaxTopicsInput] = useState("");
  const [configMessage, setConfigMessage] = useState("");
  const [isSavingConfig, setIsSavingConfig] = useState(false);
  const [waitlistMessage, setWaitlistMessage] = useState("");
  const [invitingWaitlistId, setInvitingWaitlistId] = useState<string | null>(
    null,
  );
  const currentSettings = topicDiagnostics?.[0]?.settings;

  useEffect(() => {
    if (!currentSettings) return;
    setMinScoreInput(String(currentSettings.minScore));
    setConfidenceRatioInput(String(currentSettings.confidenceRatio));
    setMaxTopicsInput(String(currentSettings.maxTopics));
  }, [
    currentSettings?.minScore,
    currentSettings?.confidenceRatio,
    currentSettings?.maxTopics,
  ]);

  if (currentUser === undefined || isAdmin === undefined) {
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

  const hasConfigChanges =
    !!currentSettings &&
    (minScoreInput !== String(currentSettings.minScore) ||
      confidenceRatioInput !== String(currentSettings.confidenceRatio) ||
      maxTopicsInput !== String(currentSettings.maxTopics));

  const handleResetConfig = () => {
    if (!currentSettings) return;
    setMinScoreInput(String(currentSettings.minScore));
    setConfidenceRatioInput(String(currentSettings.confidenceRatio));
    setMaxTopicsInput(String(currentSettings.maxTopics));
    setConfigMessage("");
  };

  const handleSaveConfig = async (event: FormEvent) => {
    event.preventDefault();
    if (!currentSettings || isSavingConfig) return;

    const minScore = Number(minScoreInput);
    const confidenceRatio = Number(confidenceRatioInput);
    const maxTopics = Number(maxTopicsInput);

    if (!Number.isFinite(minScore) || minScore < 1 || minScore > 20) {
      setConfigMessage("Min score must be a number between 1 and 20.");
      return;
    }
    if (
      !Number.isFinite(confidenceRatio) ||
      confidenceRatio < 0.1 ||
      confidenceRatio > 1
    ) {
      setConfigMessage("Confidence ratio must be between 0.1 and 1.");
      return;
    }
    if (
      !Number.isInteger(maxTopics) ||
      maxTopics < 1 ||
      maxTopics > 5
    ) {
      setConfigMessage("Max topics must be a whole number between 1 and 5.");
      return;
    }

    setIsSavingConfig(true);
    setConfigMessage("");

    try {
      await Promise.all([
        setConfig({
          key: "topic_inference_min_score",
          value: JSON.stringify(minScore),
          description:
            "Minimum weighted lexical score required before a topic is attached to a clustered event.",
        }),
        setConfig({
          key: "topic_inference_confidence_ratio",
          value: JSON.stringify(confidenceRatio),
          description:
            "Relative score threshold for keeping additional inferred topics alongside the top-scoring topic.",
        }),
        setConfig({
          key: "topic_inference_max_topics",
          value: JSON.stringify(maxTopics),
          description:
            "Maximum number of inferred topics attached to an event during clustering.",
        }),
      ]);
      setConfigMessage("Topic inference settings saved.");
    } catch (error) {
      console.error("Failed to save topic inference settings:", error);
      setConfigMessage("Could not save settings. Please try again.");
    } finally {
      setIsSavingConfig(false);
    }
  };

  const userName = currentUser?.profile?.name || currentUser?.email || "User";
  const userEmail = currentUser?.email;
  const waitlistStats = waitlistOverview?.stats;

  const handleInviteNextPendingUsers = (count: number) => {
    inviteNextPendingUsers.reset();
    inviteWaitlistUser.reset();
    setInvitingWaitlistId(null);
    setWaitlistMessage("");
    inviteNextPendingUsers.mutate(
      { count },
      {
        onSuccess: (result) => {
          setWaitlistMessage(
            result.invitedCount > 0
              ? `Invited ${result.invitedCount} waitlist ${result.invitedCount === 1 ? "user" : "users"}.`
              : "No pending waitlist users left to invite.",
          );
        },
      },
    );
  };

  const handleInviteSingleUser = (waitlistId: Id<"waitlist">) => {
    inviteWaitlistUser.reset();
    inviteNextPendingUsers.reset();
    setWaitlistMessage("");
    setInvitingWaitlistId(waitlistId);
    inviteWaitlistUser.mutate(
      { waitlistId },
      {
        onSuccess: (result) => {
          setWaitlistMessage(`Invite sent to ${result.email}.`);
        },
        onSettled: () => {
          setInvitingWaitlistId(null);
        },
      },
    );
  };

  return (
    <div className="bg-linear-to-b from-background via-background to-muted/35">
      <div className="container mx-auto max-w-4xl px-4 py-8 sm:py-10">
        <div className="flex flex-col gap-8">
          {/* Header */}
          <header className="overflow-hidden rounded-[1.6rem] border border-border/70 bg-card/80 shadow-sm">
            <div className="bg-linear-to-br from-background via-card to-muted/50 px-6 py-8 sm:px-8 sm:py-10">
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

          {isAdmin && (
            <section className="space-y-4">
              <div className="flex flex-col gap-2">
                <h2 className="text-xl font-semibold">Waitlist Invites</h2>
                <p className="text-sm text-muted-foreground">
                  Move people from the waitlist into the beta and send their invite emails through Resend.
                </p>
              </div>

              {waitlistOverview === undefined ? (
                <div className="rounded-xl border border-border/60 bg-card p-4 text-sm text-muted-foreground">
                  Loading waitlist overview...
                </div>
              ) : (
                <>
                  <div className="grid gap-3 sm:grid-cols-3">
                    <MetricCard
                      label="Pending"
                      value={String(waitlistStats?.pending ?? 0)}
                    />
                    <MetricCard
                      label="Invited"
                      value={String(waitlistStats?.invited ?? 0)}
                    />
                    <MetricCard
                      label="Converted"
                      value={String(waitlistStats?.converted ?? 0)}
                    />
                  </div>

                  <Card className="rounded-[1.2rem] border-border/70 bg-card/80 py-0">
                    <CardHeader className="border-b border-border/70 bg-muted/30 py-4">
                      <CardTitle className="text-base">Invite the next batch</CardTitle>
                    </CardHeader>
                    <CardContent className="flex flex-wrap items-center gap-3 px-5 py-5">
                      <Button
                        size="sm"
                        onClick={() => handleInviteNextPendingUsers(10)}
                        disabled={
                          inviteNextPendingUsers.isPending ||
                          inviteWaitlistUser.isPending
                        }
                      >
                        {inviteNextPendingUsers.isPending
                          ? "Sending..."
                          : "Invite next 10"}
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleInviteNextPendingUsers(25)}
                        disabled={
                          inviteNextPendingUsers.isPending ||
                          inviteWaitlistUser.isPending
                        }
                      >
                        Invite next 25
                      </Button>
                      {waitlistMessage && !inviteNextPendingUsers.isError && !inviteWaitlistUser.isError && (
                        <p className="text-sm text-muted-foreground">{waitlistMessage}</p>
                      )}
                      {inviteNextPendingUsers.isError && (
                        <p className="text-sm text-destructive">
                          {inviteNextPendingUsers.error instanceof Error
                            ? inviteNextPendingUsers.error.message
                            : "Could not send invites right now."}
                        </p>
                      )}
                      {inviteWaitlistUser.isError && !inviteNextPendingUsers.isError && (
                        <p className="text-sm text-destructive">
                          {inviteWaitlistUser.error instanceof Error
                            ? inviteWaitlistUser.error.message
                            : "Could not send that invite."}
                        </p>
                      )}
                    </CardContent>
                  </Card>

                  <Card className="rounded-[1.2rem] border-border/70 bg-card/80 py-0">
                    <CardHeader className="border-b border-border/70 bg-muted/30 py-4">
                      <CardTitle className="text-base">Next in line</CardTitle>
                    </CardHeader>
                    <CardContent className="px-5 py-5">
                      {waitlistOverview.nextPending.length === 0 ? (
                        <p className="text-sm text-muted-foreground">
                          No pending users left in the waitlist.
                        </p>
                      ) : (
                        <div className="space-y-3">
                          {waitlistOverview.nextPending.map((entry) => (
                            <div
                              key={entry._id}
                              className="flex flex-col gap-3 rounded-xl border border-border/60 bg-background/70 p-4 sm:flex-row sm:items-center sm:justify-between"
                            >
                              <div className="space-y-1">
                                <p className="text-sm font-medium text-foreground">
                                  #{entry.position} {entry.name ?? entry.email}
                                </p>
                                <p className="text-xs text-muted-foreground">
                                  {entry.name ? entry.email : "No name provided"}
                                </p>
                              </div>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => handleInviteSingleUser(entry._id)}
                                disabled={
                                  inviteNextPendingUsers.isPending
                                    ? true
                                    : inviteWaitlistUser.isPending &&
                                      invitingWaitlistId === entry._id
                                }
                              >
                                {invitingWaitlistId === entry._id &&
                                inviteWaitlistUser.isPending
                                  ? "Sending..."
                                  : "Send invite"}
                              </Button>
                            </div>
                          ))}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </>
              )}
            </section>
          )}

          {/* Admin diagnostics - visible to admins only */}
          {isAdmin && (
            <section className="mt-10 space-y-6">
              <div className="space-y-2">
                <h2 className="text-xl font-semibold">Topic Inference Diagnostics</h2>
                <p className="text-sm text-muted-foreground">
                  Review recent event topic assignments and the strongest candidate
                  scores behind them.
                </p>
              </div>

              {topicDiagnostics === undefined ? (
                <div className="rounded-xl border border-border/60 bg-card p-4 text-sm text-muted-foreground">
                  Loading topic diagnostics...
                </div>
              ) : topicDiagnostics.length === 0 ? (
                <div className="rounded-xl border border-border/60 bg-card p-4 text-sm text-muted-foreground">
                  No published events available for diagnostics yet.
                </div>
              ) : (
                <>
                  <div className="rounded-xl border border-border/60 bg-card p-4">
                    <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                      Current Thresholds
                    </h3>
                    <div className="mt-3 grid gap-3 sm:grid-cols-3">
                      <MetricCard
                        label="Min score"
                        value={String(topicDiagnostics[0]?.settings.minScore ?? "-")}
                      />
                      <MetricCard
                        label="Confidence ratio"
                        value={String(
                          topicDiagnostics[0]?.settings.confidenceRatio ?? "-",
                        )}
                      />
                      <MetricCard
                        label="Max topics"
                        value={String(topicDiagnostics[0]?.settings.maxTopics ?? "-")}
                      />
                    </div>
                    {currentSettings && (
                      <form onSubmit={handleSaveConfig} className="mt-5 space-y-4">
                        <div className="grid gap-3 md:grid-cols-3">
                          <div className="space-y-2">
                            <label
                              htmlFor="topic-inference-min-score"
                              className="text-xs font-semibold uppercase tracking-wide text-muted-foreground"
                            >
                              Min score
                            </label>
                            <Input
                              id="topic-inference-min-score"
                              inputMode="decimal"
                              value={minScoreInput}
                              onChange={(e) => setMinScoreInput(e.target.value)}
                              disabled={isSavingConfig}
                            />
                          </div>
                          <div className="space-y-2">
                            <label
                              htmlFor="topic-inference-confidence-ratio"
                              className="text-xs font-semibold uppercase tracking-wide text-muted-foreground"
                            >
                              Confidence ratio
                            </label>
                            <Input
                              id="topic-inference-confidence-ratio"
                              inputMode="decimal"
                              value={confidenceRatioInput}
                              onChange={(e) =>
                                setConfidenceRatioInput(e.target.value)
                              }
                              disabled={isSavingConfig}
                            />
                          </div>
                          <div className="space-y-2">
                            <label
                              htmlFor="topic-inference-max-topics"
                              className="text-xs font-semibold uppercase tracking-wide text-muted-foreground"
                            >
                              Max topics
                            </label>
                            <Input
                              id="topic-inference-max-topics"
                              inputMode="numeric"
                              value={maxTopicsInput}
                              onChange={(e) => setMaxTopicsInput(e.target.value)}
                              disabled={isSavingConfig}
                            />
                          </div>
                        </div>
                        <div className="flex flex-wrap items-center gap-3">
                          <Button
                            type="submit"
                            size="sm"
                            disabled={isSavingConfig || !hasConfigChanges}
                          >
                            {isSavingConfig ? "Saving..." : "Save settings"}
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={handleResetConfig}
                            disabled={isSavingConfig || !hasConfigChanges}
                          >
                            Reset
                          </Button>
                          {configMessage && (
                            <p className="text-sm text-muted-foreground">
                              {configMessage}
                            </p>
                          )}
                        </div>
                      </form>
                    )}
                  </div>

                  <div className="space-y-4">
                    {topicDiagnostics.map((event) => (
                      <article
                        key={event.eventId}
                        className="rounded-2xl border border-border/60 bg-card p-5"
                      >
                        <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                          <div className="space-y-1">
                            <h3 className="text-lg font-semibold">{event.eventTitle}</h3>
                            <p className="text-sm text-muted-foreground">
                              {event.articleCount} article
                              {event.articleCount === 1 ? "" : "s"} in cluster
                            </p>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            <TopicChipList
                              label="Attached"
                              topics={event.attachedTopics.map((topic) => topic.displayName)}
                            />
                            <TopicChipList
                              label="Inferred"
                              topics={event.inferredTopics.map((topic) => topic.displayName)}
                            />
                          </div>
                        </div>

                        <div className="mt-4 grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
                          <section className="space-y-3">
                            <div>
                              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                                Inference Input
                              </p>
                              <div className="mt-2 space-y-2 text-sm text-muted-foreground">
                                <p>{event.inferenceInput.title}</p>
                                {event.inferenceInput.summary && (
                                  <p>{event.inferenceInput.summary}</p>
                                )}
                                {event.inferenceInput.rssSnippet && (
                                  <p>{event.inferenceInput.rssSnippet}</p>
                                )}
                              </div>
                            </div>

                            {event.inferenceInput.atomicFacts.length > 0 && (
                              <div>
                                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                                  Facts Used
                                </p>
                                <div className="mt-2 flex flex-wrap gap-2">
                                  {event.inferenceInput.atomicFacts.map((fact) => (
                                    <span
                                      key={fact}
                                      className="rounded-full bg-muted px-3 py-1 text-xs text-muted-foreground"
                                    >
                                      {fact}
                                    </span>
                                  ))}
                                </div>
                              </div>
                            )}

                            <div>
                              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                                Recent Articles
                              </p>
                              <div className="mt-2 space-y-2">
                                {event.articles.map((article) => (
                                  <div
                                    key={article._id}
                                    className="rounded-xl border border-border/50 p-3"
                                  >
                                    <p className="text-sm font-medium">{article.title}</p>
                                    {(article.summary || article.rssSnippet) && (
                                      <p className="mt-1 text-sm text-muted-foreground">
                                        {article.summary ?? article.rssSnippet}
                                      </p>
                                    )}
                                  </div>
                                ))}
                              </div>
                            </div>
                          </section>

                          <section>
                            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                              Top Candidate Scores
                            </p>
                            <div className="mt-2 space-y-2">
                              {event.topCandidates.map((candidate) => (
                                <div
                                  key={candidate.slug}
                                  className="rounded-xl border border-border/50 p-3"
                                >
                                  <div className="flex items-center justify-between gap-3">
                                    <div>
                                      <p className="text-sm font-medium">
                                        {candidate.displayName}
                                      </p>
                                      <p className="text-xs text-muted-foreground">
                                        {candidate.signalCount} signal
                                        {candidate.signalCount === 1 ? "" : "s"}
                                      </p>
                                    </div>
                                    <div className="text-right">
                                      <p className="text-sm font-semibold">
                                        {candidate.score}
                                      </p>
                                      <p className="text-xs text-muted-foreground">
                                        weighted score
                                      </p>
                                    </div>
                                  </div>
                                  <div className="mt-3 flex flex-wrap gap-2">
                                    <BreakdownChip
                                      label="Title phrases"
                                      value={candidate.breakdown.titlePhraseHits}
                                    />
                                    <BreakdownChip
                                      label="Summary phrases"
                                      value={candidate.breakdown.summaryPhraseHits}
                                    />
                                    <BreakdownChip
                                      label="Snippet phrases"
                                      value={candidate.breakdown.snippetPhraseHits}
                                    />
                                    <BreakdownChip
                                      label="Fact phrases"
                                      value={candidate.breakdown.factPhraseHits}
                                    />
                                    <BreakdownChip
                                      label="Title keywords"
                                      value={candidate.breakdown.titleKeywordHits}
                                    />
                                    <BreakdownChip
                                      label="Summary keywords"
                                      value={candidate.breakdown.summaryKeywordHits}
                                    />
                                    <BreakdownChip
                                      label="Snippet keywords"
                                      value={candidate.breakdown.snippetKeywordHits}
                                    />
                                    <BreakdownChip
                                      label="Fact keywords"
                                      value={candidate.breakdown.factKeywordHits}
                                    />
                                  </div>
                                </div>
                              ))}
                            </div>
                          </section>
                        </div>
                      </article>
                    ))}
                  </div>
                </>
              )}
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border/50 bg-background/60 p-3">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 text-lg font-semibold">{value}</p>
    </div>
  );
}

function TopicChipList({
  label,
  topics,
}: {
  label: string;
  topics: string[];
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      {topics.length > 0 ? (
        topics.map((topic) => (
          <span
            key={`${label}-${topic}`}
            className="rounded-full bg-muted px-3 py-1 text-xs"
          >
            {topic}
          </span>
        ))
      ) : (
        <span className="rounded-full bg-muted px-3 py-1 text-xs text-muted-foreground">
          None
        </span>
      )}
    </div>
  );
}

function BreakdownChip({
  label,
  value,
}: {
  label: string;
  value: number;
}) {
  return (
    <span className="rounded-full bg-muted px-3 py-1 text-xs text-muted-foreground">
      {label}: {value}
    </span>
  );
}
