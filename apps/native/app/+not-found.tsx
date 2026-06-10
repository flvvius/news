import { Link, Stack } from "expo-router";
import { Pressable, Text, View } from "react-native";

import { Screen } from "@/components/screen";

export default function NotFoundScreen() {
  return (
    <>
      <Stack.Screen options={{ title: "Not found" }} />
      <Screen>
        <View className="flex-1 items-center justify-center gap-3 px-6">
          <Text className="text-2xl font-semibold tracking-tight text-foreground">
            Page not found
          </Text>
          <Text className="max-w-[34ch] text-center text-sm leading-relaxed text-muted-foreground">
            The page you're looking for doesn't exist.
          </Text>
          <Link href="/" asChild>
            <Pressable
              accessibilityRole="link"
              accessibilityLabel="Go to feed"
              className="mt-2 min-h-11 items-center justify-center rounded-full bg-primary px-6 active:opacity-80"
            >
              <Text className="text-sm font-medium text-primary-foreground">
                Go to feed
              </Text>
            </Pressable>
          </Link>
        </View>
      </Screen>
    </>
  );
}
