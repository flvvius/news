import { Alert, Text, View, Pressable } from "react-native";
import { Container } from "@/components/container";
import { useConvexAuth, useQuery } from "convex/react";
import { api } from "@news-app/backend/convex/_generated/api";
import { authClient } from "@/lib/auth-client";
import { SignIn } from "@/components/sign-in";
import { SignUp } from "@/components/sign-up";
import { Ionicons } from "@expo/vector-icons";
import { Card, Chip, useThemeColor } from "heroui-native";
import { useState } from "react";

export default function Home() {
  const healthCheck = useQuery(api.healthCheck.get);
  const { isAuthenticated } = useConvexAuth();
  const user = useQuery(api.user.getCurrentUser, isAuthenticated ? {} : "skip");
  const mutedColor = useThemeColor("muted");
  const successColor = useThemeColor("success");
  const dangerColor = useThemeColor("danger");

  const isConnected = healthCheck === "OK";
  const isLoading = healthCheck === undefined;
  const [showSignIn, setShowSignIn] = useState(true);
  const [isSigningOut, setIsSigningOut] = useState(false);

  return (
    <Container className="p-6">
      <View className="py-4 mb-6">
        <Text className="text-4xl font-bold text-foreground mb-2">Biviant</Text>
        <View className="flex-row items-center gap-2 mb-4">
          <Chip
            variant="secondary"
            color={isLoading ? "default" : isConnected ? "success" : "danger"}
            size="sm"
          >
            <Chip.Label>
              {isLoading
                ? "Connecting..."
                : isConnected
                  ? "Connected"
                  : "Offline"}
            </Chip.Label>
          </Chip>
        </View>
      </View>

      {isAuthenticated ? (
        <View>
          <Card variant="secondary" className="p-4 mb-4">
            <Card.Title className="mb-2">Welcome back</Card.Title>
            <Card.Description>
              {user?.profile?.name ?? user?.email ?? "Loading..."}
            </Card.Description>
          </Card>
          <Pressable
            onPress={async () => {
              if (isSigningOut) return;
              setIsSigningOut(true);
              try {
                await authClient.signOut();
              } catch (error) {
                Alert.alert(
                  "Sign Out Failed",
                  "Something went wrong. Please try again.",
                );
              } finally {
                setIsSigningOut(false);
              }
            }}
            disabled={isSigningOut}
            accessibilityRole="button"
            accessibilityLabel="Sign Out"
            accessibilityState={{ disabled: isSigningOut }}
            className={`bg-danger/10 p-4 rounded-lg active:opacity-70 ${isSigningOut ? "opacity-50" : ""}`}
          >
            <Text className="text-danger font-medium text-center">
              {isSigningOut ? "Signing Out..." : "Sign Out"}
            </Text>
          </Pressable>
        </View>
      ) : (
        <View>
          {showSignIn ? <SignIn /> : <SignUp />}
          <Pressable
            onPress={() => setShowSignIn((prev) => !prev)}
            accessibilityRole="button"
            accessibilityLabel={
              showSignIn ? "Switch to Sign Up" : "Switch to Sign In"
            }
            className="mt-4 p-2"
          >
            <Text className="text-muted text-center text-sm">
              {showSignIn
                ? "Need an account? Sign Up"
                : "Already have an account? Sign In"}
            </Text>
          </Pressable>
        </View>
      )}
    </Container>
  );
}
