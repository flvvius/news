import { useRouter } from "expo-router";
import { useEffect, useMemo } from "react";
import { Text, View } from "react-native";

import { EventRow } from "@/components/event-row";
import { Screen } from "@/components/screen";
import { PressableScale } from "@/components/ui/pressable-scale";
import { useAnalytics } from "@/contexts/analytics-context";
import { useT } from "@/contexts/locale-context";
import { buildOnboardingFixtureEvent } from "@/lib/onboarding-fixture";

/**
 * Screen A — the promise. One headline, one real story card (rendered from a
 * bundled fixture so nothing blocks first paint), one Continue. No carousel,
 * no page dots, no illustrations. The card is display-only.
 */
export default function OnboardingPromiseScreen() {
  const t = useT();
  const router = useRouter();
  const { track } = useAnalytics();

  useEffect(() => {
    track({ name: "onboarding_started" });
  }, [track]);

  const fixture = useMemo(
    () =>
      buildOnboardingFixtureEvent(
        t("onboarding.promise.cardTitle"),
        t("onboarding.promise.cardSummary"),
        t("onboarding.promise.cardKicker"),
      ),
    [t],
  );

  const handleContinue = () => {
    track({ name: "promise_continue" });
    router.push("/onboarding/topics");
  };

  return (
    <Screen>
      <View className="flex-1 justify-between px-5 pb-8 pt-8">
        <View className="gap-8">
          <Text className="text-3xl font-semibold leading-tight tracking-tight text-foreground">
            {t("onboarding.promise.headline")}
          </Text>
          {/* Display-only sample: the real EventRow fed bundled data. */}
          <View
            pointerEvents="none"
            className="rounded-lg border border-border bg-card px-4"
          >
            <EventRow
              event={fixture.event}
              topicNamesById={fixture.topicNamesById}
              variant="lead"
            />
          </View>
        </View>

        <PressableScale
          accessibilityRole="button"
          accessibilityLabel={t("onboarding.promise.continue")}
          onPress={handleContinue}
          contentClassName="min-h-12 items-center justify-center rounded-lg bg-primary"
        >
          <Text className="text-base font-medium text-primary-foreground">
            {t("onboarding.promise.continue")}
          </Text>
        </PressableScale>
      </View>
    </Screen>
  );
}
