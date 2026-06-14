import type { BottomSheetModal } from "@gorhom/bottom-sheet";
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
import { useAnalytics, useAnalyticsConsent } from "@/contexts/analytics-context";
import { useDeviceIdentity } from "@/contexts/device-identity-context";
import { useFollowedTopics } from "@/contexts/followed-topics-context";
import { useGuestActivity } from "@/contexts/guest-activity-context";
import { clearLocalGuestData } from "@/lib/clear-guest-data";
import {
  SettingsGroup,
  SettingsRow,
} from "@/components/settings/settings-group";
import { ConfirmSheet } from "@/components/ui/confirm-sheet";
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

function AnalyticsPicker() {
  const t = useT();
  const { optedOut, setOptedOut } = useAnalyticsConsent();

  const options: Array<SegmentedOption<"on" | "off">> = [
    { value: "on", label: t("native.privacy.analyticsOn") },
    { value: "off", label: t("native.privacy.analyticsOff") },
  ];

  return (
    <View className="gap-2.5">
      <Text className="text-sm leading-relaxed text-muted-foreground">
        {t("native.privacy.analyticsDescription")}
      </Text>
      <SegmentedPicker
        groupLabel={t("native.privacy.analyticsLabel")}
        options={options}
        selected={optedOut ? "off" : "on"}
        onSelect={(value) => setOptedOut(value === "off")}
        optionLabel={(label) =>
          t("native.privacy.analyticsOptionLabel").replace("{label}", label)
        }
      />
    </View>
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
      <View className="flex-row items-center gap-4 rounded-lg border border-border bg-card px-4 py-4">
        <Skeleton className="size-14 rounded-full" />
        <View className="flex-1 gap-2">
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-4 w-48" />
        </View>
      </View>
    );
  }

  if (!isAuthenticated || !currentUser) {
    // Typographic guest note — sign-in is an offer, never a wall.
    return (
      <View className="gap-2 rounded-lg border border-border bg-card px-4 py-5">
        <Text className="text-base font-semibold text-foreground">
          {t("native.profile.guestTitle")}
        </Text>
        <Text className="max-w-[455px] text-sm leading-relaxed text-muted-foreground">
          {t("native.profile.guestBody")}
        </Text>
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel={t("auth.signIn")}
          onPress={() => router.push("/auth")}
          className="mt-2 self-start"
          contentClassName="min-h-11 items-center justify-center rounded-lg bg-primary px-5"
        >
          <Text className="text-base font-medium text-primary-foreground">
            {t("auth.signIn")}
          </Text>
        </PressableScale>
      </View>
    );
  }

  const displayName = currentUser.profile?.name ?? currentUser.name ?? "—";

  return (
    <View className="flex-row items-center gap-4 rounded-lg border border-border bg-card px-4 py-4">
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
  const { clear: clearGuestActivity } = useGuestActivity();
  const { resetLocal: resetFollowedTopics } = useFollowedTopics();
  const { rotateDeviceId } = useDeviceIdentity();
  const { reset: resetAnalytics } = useAnalytics();
  const [isSigningOut, setIsSigningOut] = useState(false);
  const deleteSheetRef = useRef<BottomSheetModal>(null);
  const clearDataSheetRef = useRef<BottomSheetModal>(null);

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

  const performDeleteAccount = () => {
    authClient
      .deleteUser()
      .then(async () => {
        // Deletion must wipe even *unmerged* local guest data — unlike logout
        // (Ticket 3), there is no account left to retry a merge into, and the
        // ledger rows are already gone so the logout handler would otherwise
        // retain them (Ticket 5b). signOut() then triggers the session-sync
        // logout path, which resets analytics, the push token and the device id.
        await clearGuestActivity();
        resetFollowedTopics();
        await authClient.signOut();
      })
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
  };

  const handleClearGuestData = () => {
    void (async () => {
      // Erase every device-local guest store, then become a fresh anonymous
      // identity: reset the analytics person and rotate the device id (which
      // re-registers the new device_uuid super property). Ticket 5c.
      await clearLocalGuestData();
      await clearGuestActivity();
      resetFollowedTopics();
      resetAnalytics();
      await rotateDeviceId();
      Alert.alert(t("native.privacy.clearDataDone"));
    })();
  };

  return (
    <ScrollView
      className="flex-1"
      contentContainerClassName="gap-6 px-5 pb-8 pt-5"
    >
      <Text className="text-3xl font-semibold tracking-tight text-foreground">
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

      <SettingsGroup title={t("native.privacy.section")}>
        <PreferenceRow label={t("native.privacy.analyticsLabel")} isFirst>
          <AnalyticsPicker />
        </PreferenceRow>
        {!isAuthenticated ? (
          <SettingsRow
            label={t("native.privacy.clearDataLabel")}
            detail={t("native.privacy.clearDataDetail")}
            onPress={() => clearDataSheetRef.current?.present()}
            destructive
          />
        ) : null}
      </SettingsGroup>

      <SettingsGroup title={t("native.about.section")}>
        {ABOUT_PAGES.map((page, index) => (
          <SettingsRow
            key={page.slug}
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
            label={
              isSigningOut ? t("native.profile.signingOut") : t("auth.signOut")
            }
            onPress={() => void handleSignOut()}
            isFirst
          />
          <SettingsRow
            label={t("native.profile.deleteConfirmTitle")}
            detail={t("native.profile.deleteDetail")}
            onPress={() => deleteSheetRef.current?.present()}
            destructive
          />
        </SettingsGroup>
      ) : null}

      <ConfirmSheet
        ref={deleteSheetRef}
        title={t("native.profile.deleteConfirmTitle")}
        body={t("native.profile.deleteConfirmBody")}
        confirmLabel={t("native.profile.deleteConfirmAction")}
        cancelLabel={t("native.profile.deleteConfirmCancel")}
        destructive
        onConfirm={performDeleteAccount}
      />

      <ConfirmSheet
        ref={clearDataSheetRef}
        title={t("native.privacy.clearDataConfirmTitle")}
        body={t("native.privacy.clearDataConfirmBody")}
        confirmLabel={t("native.privacy.clearDataConfirmAction")}
        cancelLabel={t("native.privacy.clearDataConfirmCancel")}
        destructive
        onConfirm={handleClearGuestData}
      />
    </ScrollView>
  );
}
