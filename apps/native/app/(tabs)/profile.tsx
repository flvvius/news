import { api } from "@news-app/backend/convex/_generated/api";
import { useConvexAuth, useQuery } from "convex/react";
import { useRouter } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { useState } from "react";
import { Alert, Pressable, ScrollView, Text, View } from "react-native";

import { Screen } from "@/components/screen";
import {
  SettingsGroup,
  SettingsRow,
} from "@/components/settings/settings-group";
import { Icon, type IconName } from "@/components/ui/icon";
import { QueryBoundary } from "@/components/ui/query-boundary";
import { Skeleton } from "@/components/ui/skeleton";
import {
  useAppTheme,
  type ThemePreference,
} from "@/contexts/app-theme-context";
import { authClient } from "@/lib/auth-client";
import { cn } from "@/lib/cn";
import { ABOUT_PAGES, aboutPageUrl } from "@/lib/site";

const ABOUT_PAGE_ICONS: Record<string, IconName> = {
  about: "information-circle-outline",
  "how-it-works": "bulb-outline",
  "our-sources": "library-outline",
  contact: "mail-outline",
  partners: "people-outline",
  privacy: "shield-checkmark-outline",
  terms: "document-text-outline",
};

const THEME_OPTIONS: Array<{ value: ThemePreference; label: string }> = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

function openAboutPage(path: string) {
  WebBrowser.openBrowserAsync(path).catch(() => {
    Alert.alert(
      "Couldn't open page",
      "The in-app browser is unavailable right now. Please try again.",
    );
  });
}

export default function ProfileScreen() {
  return (
    <Screen>
      <QueryBoundary
        title="Couldn't load your profile"
        body="Something went wrong while loading your account. Try again."
      >
        <ProfileContent />
      </QueryBoundary>
    </Screen>
  );
}

function ThemePicker() {
  const { preference, setPreference } = useAppTheme();

  return (
    <View
      className="m-3 h-10 flex-row rounded-lg bg-muted p-1"
      accessibilityRole="radiogroup"
      accessibilityLabel="Theme"
    >
      {THEME_OPTIONS.map(({ value, label }) => {
        const isActive = preference === value;
        return (
          <Pressable
            key={value}
            accessibilityRole="radio"
            accessibilityLabel={`${label} theme`}
            accessibilityState={{ selected: isActive }}
            onPress={() => setPreference(value)}
            className={cn(
              "flex-1 items-center justify-center rounded-md",
              isActive && "bg-background",
            )}
          >
            <Text
              className={cn(
                "text-sm font-medium",
                isActive ? "text-foreground" : "text-muted-foreground",
              )}
            >
              {label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function AccountCard() {
  const router = useRouter();
  const { isAuthenticated, isLoading } = useConvexAuth();
  const currentUser = useQuery(
    api.user.getCurrentUser,
    isAuthenticated ? {} : "skip",
  );

  if (isLoading || (isAuthenticated && currentUser === undefined)) {
    return (
      <View className="flex-row items-center gap-4 rounded-xl border border-border/80 bg-card px-4 py-4">
        <Skeleton className="size-14 rounded-full" />
        <View className="flex-1 gap-2">
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-4 w-48" />
        </View>
      </View>
    );
  }

  if (!isAuthenticated || !currentUser) {
    return (
      <View className="items-center gap-3 rounded-xl border border-border/80 bg-card px-5 py-7">
        <View className="size-14 items-center justify-center rounded-full bg-primary/10">
          <Icon
            name="person-circle-outline"
            size={28}
            className="text-primary"
          />
        </View>
        <Text className="text-base font-semibold text-foreground">
          You're browsing as a guest
        </Text>
        <Text className="max-w-[34ch] text-center text-sm leading-relaxed text-muted-foreground">
          Sign in to bookmark events and keep your reading balanced across
          devices.
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Sign in"
          onPress={() => router.push("/auth")}
          className="mt-1 min-h-11 items-center justify-center rounded-full bg-primary px-6 active:opacity-80"
        >
          <Text className="text-sm font-medium text-primary-foreground">
            Sign in
          </Text>
        </Pressable>
      </View>
    );
  }

  const displayName =
    currentUser.profile?.name ?? currentUser.name ?? "Reader";

  return (
    <View className="flex-row items-center gap-4 rounded-xl border border-border/80 bg-card px-4 py-4">
      <View className="size-14 items-center justify-center rounded-full bg-primary/10">
        <Text className="text-xl font-semibold text-primary">
          {displayName.charAt(0).toUpperCase()}
        </Text>
      </View>
      <View className="min-w-0 flex-1">
        <Text className="text-base font-semibold text-foreground">
          {displayName}
        </Text>
        <Text numberOfLines={1} className="text-sm text-muted-foreground">
          {currentUser.email}
        </Text>
        {!currentUser.emailVerified ? (
          <Text className="mt-0.5 text-xs text-warning">
            Email not verified yet
          </Text>
        ) : null}
      </View>
    </View>
  );
}

function ProfileContent() {
  const router = useRouter();
  const { isAuthenticated } = useConvexAuth();
  const [isSigningOut, setIsSigningOut] = useState(false);

  const handleSignOut = async () => {
    if (isSigningOut) return;
    setIsSigningOut(true);
    try {
      // The Better Auth expo plugin purges its SecureStore entries here.
      await authClient.signOut();
    } catch {
      Alert.alert(
        "Sign out failed",
        "Something went wrong. Please try again.",
      );
    } finally {
      setIsSigningOut(false);
    }
  };

  const handleDeleteAccount = () => {
    Alert.alert(
      "Delete account",
      "This permanently deletes your account and reading history. This cannot be undone.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => {
            authClient
              .deleteUser()
              .then(() => authClient.signOut())
              .catch(() => {
                Alert.alert(
                  "Couldn't delete automatically",
                  "Account deletion needs a quick manual confirmation. Contact us and we'll remove your account and data.",
                  [
                    { text: "Close", style: "cancel" },
                    {
                      text: "Contact us",
                      onPress: () =>
                        openAboutPage(
                          aboutPageUrl(
                            ABOUT_PAGES.find(
                              (page) => page.slug === "contact",
                            ) ?? ABOUT_PAGES[0],
                          ),
                        ),
                    },
                  ],
                );
              });
          },
        },
      ],
    );
  };

  return (
    <ScrollView
      className="flex-1"
      contentContainerClassName="gap-6 px-4 pb-10 pt-5"
    >
      <Text className="text-3xl font-bold tracking-tight text-foreground">
        Profile
      </Text>

      <AccountCard />

      <SettingsGroup title="Appearance">
        <ThemePicker />
      </SettingsGroup>

      <SettingsGroup title="About Biviant">
        {ABOUT_PAGES.map((page, index) => (
          <SettingsRow
            key={page.slug}
            icon={ABOUT_PAGE_ICONS[page.slug] ?? "document-outline"}
            label={page.title}
            onPress={() => openAboutPage(aboutPageUrl(page))}
            isFirst={index === 0}
            accessibilityLabel={`Open ${page.title}`}
          />
        ))}
      </SettingsGroup>

      {isAuthenticated ? (
        <SettingsGroup title="Account">
          <SettingsRow
            icon="log-out-outline"
            label={isSigningOut ? "Signing out…" : "Sign out"}
            onPress={() => void handleSignOut()}
            isFirst
          />
          <SettingsRow
            icon="trash-outline"
            label="Delete account"
            detail="Permanently remove your account and data"
            onPress={handleDeleteAccount}
            destructive
          />
        </SettingsGroup>
      ) : null}
    </ScrollView>
  );
}
