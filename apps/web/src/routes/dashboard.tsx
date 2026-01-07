import SignInForm from "@/components/sign-in-form";
import SignUpForm from "@/components/sign-up-form";
import UserMenu from "@/components/user-menu";
import { api } from "@news-app/backend/convex/_generated/api";
import { createFileRoute } from "@tanstack/react-router";
import {
  Authenticated,
  AuthLoading,
  Unauthenticated,
  useQuery,
} from "convex/react";
import { useState } from "react";

export const Route = createFileRoute("/dashboard")({
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
        {showSignIn ? (
          <SignInForm onSwitchToSignUp={() => setShowSignIn(false)} />
        ) : (
          <SignUpForm onSwitchToSignIn={() => setShowSignIn(true)} />
        )}
      </Unauthenticated>
      <AuthLoading>
        <div className="flex items-center justify-center h-full">
          <div className="animate-pulse text-muted-foreground">Loading...</div>
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
      <div className="flex items-center justify-center h-full">
        <div className="animate-pulse text-muted-foreground">Loading...</div>
      </div>
    );
  }

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-4">Dashboard</h1>
      {currentUser && (
        <p className="text-muted-foreground mb-4">
          Welcome, {currentUser.profile?.name || currentUser.email}!
        </p>
      )}
      <p className="text-sm text-muted-foreground">
        privateData: {privateData?.message}
      </p>
      <UserMenu />
    </div>
  );
}
