import { Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Container } from "@/components/container";
import { Card, useThemeColor } from "heroui-native";

export default function TodosScreen() {
	const mutedColor = useThemeColor("muted");

	return (
		<Container className="p-6">
			<View className="flex-1 justify-center items-center">
				<Card variant="secondary" className="p-8 items-center">
					<Ionicons
						name="construct-outline"
						size={64}
						color={mutedColor}
						style={{ marginBottom: 16 }}
					/>
					<Card.Title className="text-xl text-center mb-2">
						Coming Soon
					</Card.Title>
					<Card.Description className="text-center">
						Bookmarked articles and reading lists are on the way.
					</Card.Description>
				</Card>
			</View>
		</Container>
	);
}
