import { Text, View } from "react-native";

import { useT } from "@/contexts/locale-context";
import { biasBucketBgClass, type BiasBucket } from "@/lib/bias";

type BiasDistributionBarProps = {
  counts: { left: number; center: number; right: number };
  /** Show the Left/Center/Right count captions under the bar. */
  withLabels?: boolean;
};

const BUCKETS: BiasBucket[] = ["left", "center", "right"];

/** Horizontal bias spectrum bar, mirrors the web event-card distribution. */
export function BiasDistributionBar({
  counts,
  withLabels = true,
}: BiasDistributionBarProps) {
  const t = useT();
  const total = counts.left + counts.center + counts.right;
  if (total === 0) return null;

  return (
    <View
      className="gap-1.5"
      accessibilityRole="image"
      accessibilityLabel={t("event.biasDistribution")
        .replace("{left}", String(counts.left))
        .replace("{center}", String(counts.center))
        .replace("{right}", String(counts.right))}
    >
      {/* 4px — the signature element; thin enough to annotate, never to shout. */}
      <View className="h-1 flex-row overflow-hidden rounded-full bg-bias-track">
        {BUCKETS.map((bucket) => {
          const count = counts[bucket];
          if (count === 0) return null;
          return (
            <View
              key={bucket}
              className={biasBucketBgClass(bucket)}
              style={{ flex: count / total }}
            />
          );
        })}
      </View>
      {withLabels ? (
        <View className="flex-row items-center justify-between">
          <Text className="text-xs text-muted-foreground">
            {t("event.bias.left").replace("{count}", String(counts.left))}
          </Text>
          <Text className="text-xs text-muted-foreground">
            {t("event.bias.center").replace("{count}", String(counts.center))}
          </Text>
          <Text className="text-xs text-muted-foreground">
            {t("event.bias.right").replace("{count}", String(counts.right))}
          </Text>
        </View>
      ) : null}
    </View>
  );
}
