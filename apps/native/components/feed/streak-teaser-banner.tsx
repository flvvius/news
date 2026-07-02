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
import { markFiredOncePerSession } from "@/lib/analytics-session";
import { reportError } from "@/lib/error-monitoring";
import { clearPendingIntent, savePendingIntent } from "@/lib/pending-intent";
import {
  loadStreakTeaserState,
  registerImpression,
  saveStreakTeaserState,
  shouldShowStreakTeaser,
  STREAK_TEASER_MIN_STREAK,
} from "@/lib/streak-teaser";

/**
 * Inline (never modal) teaser shown to a guest once their reading streak reaches
 * {@link STREAK_TEASER_MIN_STREAK}+ days. The streak count is real — read from
 * the local guest queue — so the copy never over-claims. Trigger is widened
 * (Ticket 15): instead of a hard 2–3 day window, it shows at streak ≥ 2 bounded
 * by an impression cap + 30-day cooldown, so an engaged guest is re-surfaced
 * later rather than nagged every launch. Renders nothing once signed in.
 */
export function StreakTeaserBanner() {
  const t = useT();
  const router = useRouter();
  const { isAuthenticated } = useConvexAuth();
  const { guestStreak } = useGuestActivity();
  const { track } = useAnalytics();

  const sheetRef = useRef<BottomSheetModal>(null);
  const [stateLoaded, setStateLoaded] = useState(false);
  // Whether the impression cap/cooldown allows showing this session — frozen at
  // load so recording the impression doesn't hide the banner mid-session.
  const [impressionAllowed, setImpressionAllowed] = useState(false);
  // Dismiss/engage hides it immediately for the rest of the session.
  const [dismissed, setDismissed] = useState(false);
  const impressionRecordedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    loadStreakTeaserState()
      .then((state) => {
        if (cancelled) return;
        // Pass MIN_STREAK so this reflects only the impression-cap/cooldown part.
        setImpressionAllowed(
          shouldShowStreakTeaser(STREAK_TEASER_MIN_STREAK, state, Date.now()),
        );
        setStateLoaded(true);
      })
      .catch(() => {
        if (!cancelled) {
          setImpressionAllowed(true);
          setStateLoaded(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const streak = guestStreak.currentStreak;
  const bannerVisible =
    stateLoaded &&
    !dismissed &&
    impressionAllowed &&
    streak >= STREAK_TEASER_MIN_STREAK;

  useEffect(() => {
    if (!bannerVisible || impressionRecordedRef.current) return;
    impressionRecordedRef.current = true;
    // Count this impression toward the cap (persisted for future sessions);
    // visibility stays frozen via impressionAllowed for this session.
    void (async () => {
      const state = await loadStreakTeaserState();
      await saveStreakTeaserState(registerImpression(state, Date.now()));
    })();
    // Analytics impression fires once per session, not once per mount (T16).
    if (markFiredOncePerSession("gate_shown:streak_teaser")) {
      track({ name: "gate_shown", properties: { reason: "streak_teaser" } });
    }
  }, [bannerVisible, track]);

  // Signed-in users never see this gate, and don't need the sheet mounted.
  if (isAuthenticated) {
    return null;
  }

  const suppress = () => {
    setDismissed(true);
  };

  const handleCreateAccount = () => {
    // Source attribution for signup_completed; consumed in session-sync.
    savePendingIntent({ gate: "streak_teaser" }).catch((error) => {
      reportError(error, { scope: "streak-teaser.savePendingIntent" });
    });
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
          clearPendingIntent().catch((error) => {
            reportError(error, { scope: "streak-teaser.clearPendingIntent" });
          });
        }}
      />
    </>
  );
}
