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
  useMutation,
} from "convex/react";
import { useState, useEffect } from "react";

export const Route = createFileRoute("/dashboard")({
  component: RouteComponent,
});

function RouteComponent() {
  const [showSignIn, setShowSignIn] = useState(false);
  const privateData = useQuery(api.privateData.get);

  return (
    <>
      <Authenticated>
        <AuthenticatedDashboard privateData={privateData} />
      </Authenticated>
      <Unauthenticated>
        {showSignIn ? (
          <SignInForm onSwitchToSignUp={() => setShowSignIn(false)} />
        ) : (
          <SignUpForm onSwitchToSignIn={() => setShowSignIn(true)} />
        )}
      </Unauthenticated>
      <AuthLoading>
        <div>Loading...</div>
      </AuthLoading>
    </>
  );
}

function AuthenticatedDashboard({ privateData }: { privateData: any }) {
  const getOrCreateUser = useMutation(api.user.getOrCreateUser);
  const currentUser = useQuery(api.user.getCurrentUser);
  const [userSetupAttempted, setUserSetupAttempted] = useState(false);

  useEffect(() => {
    if (currentUser === null && !userSetupAttempted) {
      setUserSetupAttempted(true);

      const attemptCreateUser = async () => {
        const result = await getOrCreateUser();
        if (result === null) {
          setTimeout(async () => {
            try {
              await getOrCreateUser();
            } catch (err) {
              console.error("Failed to create user after retry:", err);
            }
          }, 1000);
        }
      };

      attemptCreateUser().catch(console.error);
    }
  }, [currentUser, getOrCreateUser, userSetupAttempted]);

  return (
    <div>
      <h1>Dashboard</h1>
      <p>privateData: {privateData?.message}</p>
      <UserMenu />
    </div>
  );
}
