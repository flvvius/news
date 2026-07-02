import * as Haptics from "expo-haptics";
import { Tabs } from "expo-router";
import { Platform, Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Icon, type IconName } from "@/components/ui/icon";
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

/**
 * Flat, full-width tab bar: bg-background + top hairline. No blur, no
 * shadow, no float — the bar is furniture, not a feature. State reads
 * through icon fill and text color, never through animation (frequency
 * law: tab switches happen dozens of times a day).
 */
function EditorialTabBar({ state, descriptors, navigation }: TabBarProps) {
  const insets = useSafeAreaInsets();

  return (
    <View
      className="border-t border-border bg-background"
      style={{ paddingBottom: Math.max(insets.bottom, 8) }}
    >
      <View className="h-[52px] flex-row items-stretch">
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
              className="flex-1 items-center justify-center gap-1 active:opacity-70"
            >
              <Icon
                name={isFocused ? icons.active : icons.idle}
                size={22}
                className={isFocused ? "text-foreground" : "text-muted-foreground"}
              />
              <Text
                numberOfLines={1}
                className={cn(
                  "text-[11px]",
                  isFocused
                    ? "font-semibold text-foreground"
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
  );
}

export default function TabsLayout() {
  const t = useT();

  return (
    <Tabs
      tabBar={(props) => <EditorialTabBar {...(props as TabBarProps)} />}
      screenOptions={{ headerShown: false }}
    >
      <Tabs.Screen name="index" options={{ title: t("tabs.feed") }} />
      <Tabs.Screen name="saved" options={{ title: t("tabs.saved") }} />
      <Tabs.Screen name="activity" options={{ title: t("tabs.activity") }} />
      <Tabs.Screen name="profile" options={{ title: t("tabs.profile") }} />
    </Tabs>
  );
}
