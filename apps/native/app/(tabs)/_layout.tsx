import { Ionicons } from "@expo/vector-icons";
import { Tabs } from "expo-router";
import { useTokenColor } from "@/lib/use-token-color";

export default function TabsLayout() {
  const background = useTokenColor("--color-background");
  const border = useTokenColor("--color-border");
  const primary = useTokenColor("--color-primary");
  const mutedForeground = useTokenColor("--color-muted-foreground");

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: primary,
        tabBarInactiveTintColor: mutedForeground,
        tabBarStyle: {
          backgroundColor: background,
          borderTopColor: border,
        },
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: "500",
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Feed",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="newspaper-outline" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="saved"
        options={{
          title: "Saved",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="bookmark-outline" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: "Profile",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="person-circle-outline" size={size} color={color} />
          ),
        }}
      />
    </Tabs>
  );
}
