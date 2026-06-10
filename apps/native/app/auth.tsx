import { Text, View } from "react-native";

import { Screen } from "@/components/screen";

export default function AuthScreen() {
  return (
    <Screen>
      <View className="flex-1 items-center justify-center">
        <Text className="text-sm text-muted-foreground">Coming up</Text>
      </View>
    </Screen>
  );
}
