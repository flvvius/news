import { Link, Stack } from "expo-router";
import { Pressable, Text, View } from "react-native";

import { Screen } from "@/components/screen";
import { useT } from "@/contexts/locale-context";

export default function NotFoundScreen() {
  const t = useT();

  return (
    <>
      <Stack.Screen options={{ title: t("router.notFound") }} />
      <Screen>
        <View className="flex-1 items-center justify-center gap-3 px-6">
          <Text className="text-2xl font-semibold tracking-tight text-foreground">
            {t("router.notFound")}
          </Text>
          <Text className="max-w-[34ch] text-center text-sm leading-relaxed text-muted-foreground">
            {t("native.notFound.body")}
          </Text>
          <Link href="/" asChild>
            <Pressable
              accessibilityRole="link"
              accessibilityLabel={t("native.notFound.cta")}
              className="mt-2 min-h-11 items-center justify-center rounded-full bg-primary px-6 active:opacity-80"
            >
              <Text className="text-sm font-medium text-primary-foreground">
                {t("native.notFound.cta")}
              </Text>
            </Pressable>
          </Link>
        </View>
      </Screen>
    </>
  );
}
