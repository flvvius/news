import { Text, View } from "react-native";
import { Container } from "@/components/container";
import { useConvexAuth, useQuery } from "convex/react";
import { api } from "@news-app/backend/convex/_generated/api";
import { authClient } from "@/lib/auth-client";
import { SignIn } from "@/components/sign-in";
import { SignUp } from "@/components/sign-up";
import { Ionicons } from "@expo/vector-icons";
import { Card, Chip, useThemeColor } from "heroui-native";

export default function Home() {
	const healthCheck = useQuery(api.healthCheck.get);
	const { isAuthenticated } = useConvexAuth();
	const user = useQuery(api.auth.getCurrentUser, isAuthenticated ? {} : "skip");
	const mutedColor = useThemeColor("muted");
	const successColor = useThemeColor("success");
	const dangerColor = useThemeColor("danger");

	const isConnected = healthCheck === "OK";
	const isLoading = healthCheck === undefined;

	return (
		<Container className="p-6">
			<View className="py-4 mb-6">
				<Text className="text-4xl font-bold text-foreground mb-2">
					BETTER T STACK
				</Text>
			</View>
		</Container>
	);
}
