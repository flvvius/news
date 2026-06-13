import { BottomSheetModal } from "@gorhom/bottom-sheet";
import { useConvexAuth } from "convex/react";
import { useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";

import { SignInSheet } from "@/components/auth/sign-in-sheet";
import { Icon } from "@/components/ui/icon";
import { useAnalytics } from "@/contexts/analytics-context";
import { useGuestActivity } from "@/contexts/guest-activity-context";
import { useT } from "@/contexts/locale-context";
import { clearPendingIntent, savePendingIntent } from "@/lib/pending-intent";
import {
  loadStreakTeaserDismissedAt,
  setStreakTeaserDismissedAt,
  STREAK_TEASER_SUPPRESS_MS,
} from "@/lib/streak-teaser";

/** Streak lengths that trigger the teaser — the 2nd–3rd reading day. */
const TEASER_STREAK_DAYS = new Set([2, 3]);

/**
 * Inline (never modal) teaser shown to a guest on their 2nd–3rd consecutive
 * reading day. The streak count is real — read from the local guest queue
 * (steps 5–6) — so the copy never over-claims. The CTA opens the sign-in gate;
 * dismissing (or engaging) suppresses it device-locally for 30 days. Renders
 * nothing once signed in.
 */
export function StreakTeaserBanner() {
  const t = useT();
  const router = useRouter();
  const { isAuthenticated } = useConvexAuth();
  const { guestStreak } = useGuestActivity();
  const { track } = useAnalytics();

  const sheetRef = useRef<BottomSheetModal>(null);
  const [dismissalLoaded, setDismissalLoaded] = useState(false);
  // Assume suppressed until the stored dismissal loads, so the banner never
  // flashes before we know whether it was dismissed.
  const [suppressed, setSuppressed] = useState(true);
  const shownTrackedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    loadStreakTeaserDismissedAt()
      .then((dismissedAt) => {
        if (cancelled) return;
        const isSuppressed =
          dismissedAt !== null &&
          Date.now() - dismissedAt < STREAK_TEASER_SUPPRESS_MS;
        setSuppressed(isSuppressed);
        setDismissalLoaded(true);
      })
      .catch(() => {
        if (!cancelled) {
          setSuppressed(false);
          setDismissalLoaded(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const streak = guestStreak.currentStreak;
  const bannerVisible =
    dismissalLoaded && !suppressed && TEASER_STREAK_DAYS.has(streak);

  useEffect(() => {
    if (bannerVisible && !shownTrackedRef.current) {
      shownTrackedRef.current = true;
      track({ name: "gate_shown", properties: { reason: "streak_teaser" } });
    }
  }, [bannerVisible, track]);

  // Signed-in users never see this gate, and don't need the sheet mounted.
  if (isAuthenticated) {
    return null;
  }

  const suppress = () => {
    setSuppressed(true);
    setStreakTeaserDismissedAt(Date.now()).catch(() => {});
  };

  const handleCreateAccount = () => {
    // Source attribution for signup_completed; consumed in session-sync.
    savePendingIntent({ gate: "streak_teaser" }).catch(() => {});
    suppress();
    sheetRef.current?.present();
  };

  const handleDismiss = () => {
    suppress();
    track({ name: "gate_dismissed", properties: { reason: "streak_teaser" } });
  };

  return (
    <>
      {bannerVisible ? (
        <View className="mx-5 mt-4 flex-row items-center gap-3 rounded-lg border border-border bg-card px-4 py-3">
          <Icon name="flame" size={20} className="text-primary" />
          <View className="min-w-0 flex-1 gap-1">
            <Text className="text-sm leading-snug text-card-foreground">
              {t("gate.streak.body").replace("{count}", String(streak))}
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("gate.streak.action")}
              onPress={handleCreateAccount}
              hitSlop={6}
            >
              <Text className="text-sm font-semibold text-primary">
                {t("gate.streak.action")}
              </Text>
            </Pressable>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("gate.streak.dismiss")}
            onPress={handleDismiss}
            hitSlop={8}
            className="size-8 items-center justify-center active:opacity-70"
          >
            <Icon name="close" size={16} className="text-muted-foreground" />
          </Pressable>
        </View>
      ) : null}

      <SignInSheet
        ref={sheetRef}
        title={t("gate.streak.title")}
        body={t("gate.streak.sheetBody")}
        onSuccess={() => {}}
        onEmail={() => router.push("/auth")}
        onCancel={() => {
          track({
            name: "gate_dismissed",
            properties: { reason: "streak_teaser" },
          });
          clearPendingIntent().catch(() => {});
        }}
      />
    </>
  );
}
