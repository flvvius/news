import { BlurView } from "expo-blur";
import * as Haptics from "expo-haptics";
import { Tabs } from "expo-router";
import { Platform, Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Icon, type IconName } from "@/components/ui/icon";
import { useAppTheme } from "@/contexts/app-theme-context";
import { useT } from "@/contexts/locale-context";
import { cn } from "@/lib/cn";

/** Filled icon when active, outline when idle — the iOS state signifier. */
const TAB_ICONS: Record<string, { active: IconName; idle: IconName }> = {
  index: { active: "newspaper", idle: "newspaper-outline" },
  saved: { active: "bookmark", idle: "bookmark-outline" },
  activity: { active: "stats-chart", idle: "stats-chart-outline" },
  profile: { active: "person-circle", idle: "person-circle-outline" },
};

/**
 * Structural subset of @react-navigation/bottom-tabs' BottomTabBarProps —
 * the package isn't directly importable under pnpm's strict node linking.
 */
type TabBarProps = {
  state: { index: number; routes: Array<{ key: string; name: string }> };
  descriptors: Record<
    string,
    { options: { title?: string; tabBarAccessibilityLabel?: string } }
  >;
  navigation: {
    emit: (event: {
      type: "tabPress";
      target: string;
      canPreventDefault: true;
    }) => { defaultPrevented: boolean };
    navigate: (name: string) => void;
  };
};

function FloatingTabBar({ state, descriptors, navigation }: TabBarProps) {
  const insets = useSafeAreaInsets();
  const { activeTheme } = useAppTheme();

  return (
    <View
      pointerEvents="box-none"
      className="absolute left-6 right-6"
      style={{ bottom: Math.max(insets.bottom - 14, 8) }}
    >
      <View
        className="overflow-hidden rounded-full border border-border/60"
        style={{
          // Soft, layered elevation — visible lift without a harsh halo.
          shadowColor: "#000",
          shadowOpacity: 0.14,
          shadowRadius: 18,
          shadowOffset: { width: 0, height: 10 },
          elevation: 10,
        }}
      >
        <BlurView
          intensity={100}
          tint={
            activeTheme === "dark"
              ? "systemChromeMaterialDark"
              : "systemChromeMaterialLight"
          }
          style={{ position: "absolute", top: 0, bottom: 0, left: 0, right: 0 }}
        />
        {/* Thin scrim over the blur keeps icon/label contrast on busy content. */}
        <View className="absolute bottom-0 left-0 right-0 top-0 bg-card/30" />
        <View className="h-[64px] flex-row items-center px-1.5">
        {state.routes.map((route, index) => {
          const { options } = descriptors[route.key];
          const isFocused = state.index === index;
          const icons = TAB_ICONS[route.name] ?? {
            active: "ellipse",
            idle: "ellipse-outline",
          };
          const label = options.title ?? route.name;

          const handlePress = () => {
            if (Platform.OS === "ios") {
              Haptics.selectionAsync().catch(() => {});
            }
            const event = navigation.emit({
              type: "tabPress",
              target: route.key,
              canPreventDefault: true,
            });
            if (!isFocused && !event.defaultPrevented) {
              navigation.navigate(route.name);
            }
          };

          return (
            <Pressable
              key={route.key}
              accessibilityRole="tab"
              accessibilityState={{ selected: isFocused }}
              accessibilityLabel={options.tabBarAccessibilityLabel ?? label}
              onPress={handlePress}
              className="h-full flex-1 items-center justify-center gap-0.5 active:opacity-70"
            >
              <Icon
                name={isFocused ? icons.active : icons.idle}
                size={23}
                className={isFocused ? "text-primary" : "text-muted-foreground"}
              />
              <Text
                numberOfLines={1}
                className={cn(
                  "text-[11px]",
                  isFocused
                    ? "font-semibold text-primary"
                    : "font-medium text-muted-foreground",
                )}
              >
                {label}
              </Text>
            </Pressable>
          );
        })}
        </View>
      </View>
    </View>
  );
}

export default function TabsLayout() {
  const t = useT();

  return (
    <Tabs
      tabBar={(props) => <FloatingTabBar {...(props as TabBarProps)} />}
      screenOptions={{ headerShown: false }}
    >
      <Tabs.Screen name="index" options={{ title: t("tabs.feed") }} />
      <Tabs.Screen name="saved" options={{ title: t("tabs.saved") }} />
      <Tabs.Screen name="activity" options={{ title: t("tabs.activity") }} />
      <Tabs.Screen name="profile" options={{ title: t("tabs.profile") }} />
    </Tabs>
  );
}
