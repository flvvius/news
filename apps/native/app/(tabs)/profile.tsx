import { api } from "@news-app/backend/convex/_generated/api";
import { useConvexAuth, useQuery } from "convex/react";
import { useRouter } from "expo-router";
import * as Haptics from "expo-haptics";
import * as WebBrowser from "expo-web-browser";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Alert,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";

import { Screen } from "@/components/screen";
import {
  SettingsGroup,
  SettingsRow,
} from "@/components/settings/settings-group";
import { Icon, type IconName } from "@/components/ui/icon";
import { PressableScale } from "@/components/ui/pressable-scale";
import { QueryBoundary } from "@/components/ui/query-boundary";
import { Skeleton } from "@/components/ui/skeleton";
import {
  useAppTheme,
  type ThemePreference,
} from "@/contexts/app-theme-context";
import {
  useLocaleContext,
  useT,
  type LanguagePreference,
} from "@/contexts/locale-context";
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

export default function ProfileScreen() {
  const t = useT();

  return (
    <Screen>
      <QueryBoundary
        title={t("native.profile.errorTitle")}
        body={t("native.profile.errorBody")}
      >
        <ProfileContent />
      </QueryBoundary>
    </Screen>
  );
}

type SegmentedOption<Value extends string> = {
  value: Value;
  label: string;
};

function SegmentedPicker<Value extends string>({
  groupLabel,
  options,
  selected,
  onSelect,
  optionLabel,
}: {
  groupLabel: string;
  options: Array<SegmentedOption<Value>>;
  selected: Value;
  onSelect: (value: Value) => void;
  optionLabel: (label: string) => string;
}) {
  const [trackWidth, setTrackWidth] = useState(0);
  const segmentWidth = trackWidth > 0 ? trackWidth / options.length : 0;
  const selectedIndex = Math.max(
    0,
    options.findIndex((option) => option.value === selected),
  );

  // Thumb slides between segments; the first layout pass positions it
  // without animation — motion only for changes the user caused.
  const thumbX = useSharedValue(0);
  const hasMeasuredRef = useRef(false);
  useEffect(() => {
    if (segmentWidth === 0) return;
    const target = selectedIndex * segmentWidth;
    if (!hasMeasuredRef.current) {
      hasMeasuredRef.current = true;
      thumbX.value = target;
      return;
    }
    thumbX.value = withTiming(target, {
      duration: 180,
      easing: Easing.bezier(0.23, 1, 0.32, 1),
    });
  }, [selectedIndex, segmentWidth, thumbX]);

  const thumbStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: thumbX.value }],
  }));

  return (
    <View
      className="h-10 rounded-lg bg-muted p-1"
      accessibilityRole="radiogroup"
      accessibilityLabel={groupLabel}
    >
      <View
        className="relative flex-1 flex-row"
        onLayout={(event) => setTrackWidth(event.nativeEvent.layout.width)}
      >
        {segmentWidth > 0 ? (
          <Animated.View
            style={[{ width: segmentWidth }, thumbStyle]}
            className="absolute bottom-0 top-0 rounded-md bg-background"
          />
        ) : null}
        {options.map(({ value, label }) => {
          const isActive = selected === value;
          return (
            <Pressable
              key={value}
              accessibilityRole="radio"
              accessibilityLabel={optionLabel(label)}
              accessibilityState={{ selected: isActive }}
              onPress={() => {
                if (Platform.OS === "ios") {
                  Haptics.selectionAsync().catch(() => {});
                }
                onSelect(value);
              }}
              className="flex-1 items-center justify-center rounded-md"
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
    </View>
  );
}

function PreferenceRow({
  label,
  isFirst = false,
  children,
}: {
  label: string;
  isFirst?: boolean;
  children: ReactNode;
}) {
  return (
    <View
      className={cn(
        "gap-2.5 px-4 py-3.5",
        !isFirst && "border-t border-border/70",
      )}
    >
      <Text className="text-sm font-medium text-foreground">{label}</Text>
      {children}
    </View>
  );
}

function ThemePicker() {
  const t = useT();
  const { preference, setPreference } = useAppTheme();

  const options: Array<SegmentedOption<ThemePreference>> = [
    { value: "system", label: t("native.theme.system") },
    { value: "light", label: t("native.theme.light") },
    { value: "dark", label: t("native.theme.dark") },
  ];

  return (
    <SegmentedPicker
      groupLabel={t("profile.theme")}
      options={options}
      selected={preference}
      onSelect={setPreference}
      optionLabel={(label) =>
        t("native.theme.optionLabel").replace("{label}", label)
      }
    />
  );
}

function LanguagePicker() {
  const t = useT();
  const { preference, setPreference } = useLocaleContext();

  const options: Array<SegmentedOption<LanguagePreference>> = [
    { value: "system", label: t("native.language.system") },
    { value: "ro", label: t("settings.language.ro") },
    { value: "en", label: t("settings.language.en") },
  ];

  return (
    <SegmentedPicker
      groupLabel={t("settings.language")}
      options={options}
      selected={preference}
      onSelect={setPreference}
      optionLabel={(label) =>
        t("native.language.optionLabel").replace("{label}", label)
      }
    />
  );
}

function AccountCard() {
  const router = useRouter();
  const t = useT();
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
          {t("native.profile.guestTitle")}
        </Text>
        <Text className="max-w-[240px] text-center text-sm leading-relaxed text-muted-foreground">
          {t("native.profile.guestBody")}
        </Text>
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel={t("auth.signIn")}
          onPress={() => router.push("/auth")}
          className="mt-1"
          contentClassName="min-h-11 items-center justify-center rounded-full bg-primary px-6"
        >
          <Text className="text-sm font-medium text-primary-foreground">
            {t("auth.signIn")}
          </Text>
        </PressableScale>
      </View>
    );
  }

  const displayName = currentUser.profile?.name ?? currentUser.name ?? "—";

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
            {t("native.profile.emailUnverified")}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

function ProfileContent() {
  const t = useT();
  const { isAuthenticated } = useConvexAuth();
  const [isSigningOut, setIsSigningOut] = useState(false);

  const openAboutPage = (url: string) => {
    WebBrowser.openBrowserAsync(url).catch(() => {
      Alert.alert(
        t("native.about.browserErrorTitle"),
        t("native.about.browserErrorBody"),
      );
    });
  };

  const handleSignOut = async () => {
    if (isSigningOut) return;
    setIsSigningOut(true);
    try {
      // The Better Auth expo plugin purges its SecureStore entries here.
      await authClient.signOut();
    } catch {
      Alert.alert(t("auth.signOut"), t("auth.signOutError"));
    } finally {
      setIsSigningOut(false);
    }
  };

  const handleDeleteAccount = () => {
    Alert.alert(
      t("native.profile.deleteConfirmTitle"),
      t("native.profile.deleteConfirmBody"),
      [
        { text: t("native.profile.deleteConfirmCancel"), style: "cancel" },
        {
          text: t("native.profile.deleteConfirmAction"),
          style: "destructive",
          onPress: () => {
            authClient
              .deleteUser()
              .then(() => authClient.signOut())
              .catch(() => {
                const contactPage =
                  ABOUT_PAGES.find((page) => page.slug === "contact") ??
                  ABOUT_PAGES[0];
                Alert.alert(
                  t("native.profile.deleteFallbackTitle"),
                  t("native.profile.deleteFallbackBody"),
                  [
                    {
                      text: t("native.profile.deleteFallbackClose"),
                      style: "cancel",
                    },
                    {
                      text: t("native.profile.deleteFallbackContact"),
                      onPress: () => openAboutPage(aboutPageUrl(contactPage)),
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
      contentContainerClassName="gap-6 px-4 pb-28 pt-5"
    >
      <Text className="text-3xl font-bold tracking-tight text-foreground">
        {t("tabs.profile")}
      </Text>

      <AccountCard />

      <SettingsGroup title={t("native.profile.preferences")}>
        <PreferenceRow label={t("profile.theme")} isFirst>
          <ThemePicker />
        </PreferenceRow>
        <PreferenceRow label={t("settings.language")}>
          <LanguagePicker />
        </PreferenceRow>
      </SettingsGroup>

      <SettingsGroup title={t("native.about.section")}>
        {ABOUT_PAGES.map((page, index) => (
          <SettingsRow
            key={page.slug}
            icon={ABOUT_PAGE_ICONS[page.slug] ?? "document-outline"}
            label={t(page.titleKey)}
            onPress={() => openAboutPage(aboutPageUrl(page))}
            isFirst={index === 0}
            accessibilityLabel={t("native.about.openLabel").replace(
              "{title}",
              t(page.titleKey),
            )}
          />
        ))}
      </SettingsGroup>

      {isAuthenticated ? (
        <SettingsGroup title={t("profile.accountSection")}>
          <SettingsRow
            icon="log-out-outline"
            label={
              isSigningOut ? t("native.profile.signingOut") : t("auth.signOut")
            }
            onPress={() => void handleSignOut()}
            isFirst
          />
          <SettingsRow
            icon="trash-outline"
            label={t("native.profile.deleteConfirmTitle")}
            detail={t("native.profile.deleteDetail")}
            onPress={handleDeleteAccount}
            destructive
          />
        </SettingsGroup>
      ) : null}
    </ScrollView>
  );
}
