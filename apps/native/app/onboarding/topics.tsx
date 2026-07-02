import { api } from "@news-app/backend/convex/_generated/api";
import type { Id } from "@news-app/backend/convex/_generated/dataModel";
import { useQuery } from "convex/react";
import { useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { ScrollView, Text, View } from "react-native";

import { TopicPickerGrid } from "@/components/onboarding/topic-picker-grid";
import { Screen } from "@/components/screen";
import { PressableScale } from "@/components/ui/pressable-scale";
import { useAnalytics } from "@/contexts/analytics-context";
import { useDeviceIdentity } from "@/contexts/device-identity-context";
import { useFollowedTopics } from "@/contexts/followed-topics-context";
import { useT } from "@/contexts/locale-context";
import { cn } from "@/lib/cn";

/**
 * Screen B — topic picker. Multi-select grid, 1 minimum to continue, prominent
 * Skip. Selections persist (local now, account at signup) and shape the first
 * feed render via the boost model. Completing OR skipping marks onboarding
 * done and lands the user in the feed.
 */
export default function OnboardingTopicsScreen() {
  const t = useT();
  const router = useRouter();
  const { track } = useAnalytics();
  const { completeOnboarding } = useDeviceIdentity();
  const { setFollowedTopics } = useFollowedTopics();
  const topics = useQuery(api.topics.getTopics);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(
    () => new Set(),
  );

  const toggle = useCallback((topicId: Id<"topics">) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      const key = String(topicId);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }, []);

  // Marking onboarding complete flips the root guard; replace() lands the feed.
  const finish = useCallback(() => {
    completeOnboarding();
    router.replace("/");
  }, [completeOnboarding, router]);

  const handleContinue = () => {
    const ids = Array.from(selectedIds) as Id<"topics">[];
    if (ids.length === 0) return;
    setFollowedTopics(ids);
    track({ name: "topics_selected", properties: { count: ids.length } });
    finish();
  };

  const handleSkip = () => {
    track({ name: "topics_skipped" });
    finish();
  };

  const canContinue = selectedIds.size > 0;

  return (
    <Screen>
      <View className="flex-1">
        <ScrollView contentContainerClassName="gap-6 px-5 pb-6 pt-8">
          <View className="gap-2">
            <Text className="text-3xl font-semibold tracking-tight text-foreground">
              {t("onboarding.topics.title")}
            </Text>
            <Text className="max-w-[455px] text-base leading-relaxed text-muted-foreground">
              {t("onboarding.topics.subtitle")}
            </Text>
          </View>
          <Text className="text-[11px] font-semibold uppercase tracking-[1.6px] text-muted-foreground">
            {t("onboarding.topics.hint")}
          </Text>
          <TopicPickerGrid
            topics={topics}
            selectedIds={selectedIds}
            onToggle={toggle}
          />
        </ScrollView>

        {/* Footer: Continue (needs ≥1) over a prominent, always-available Skip. */}
        <View className="gap-3 border-t border-border px-5 pb-8 pt-4">
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel={t("onboarding.topics.continue")}
            accessibilityState={{ disabled: !canContinue }}
            disabled={!canContinue}
            onPress={handleContinue}
            contentClassName={cn(
              "min-h-12 items-center justify-center rounded-lg bg-primary",
              !canContinue && "opacity-50",
            )}
          >
            <Text className="text-base font-medium text-primary-foreground">
              {t("onboarding.topics.continue")}
            </Text>
          </PressableScale>
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel={t("onboarding.topics.skip")}
            onPress={handleSkip}
            contentClassName="min-h-12 items-center justify-center rounded-lg"
          >
            <Text className="text-base font-medium text-muted-foreground">
              {t("onboarding.topics.skip")}
            </Text>
          </PressableScale>
        </View>
      </View>
    </Screen>
  );
}
