import { Text, View } from "react-native";

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
  const total = counts.left + counts.center + counts.right;
  if (total === 0) return null;

  return (
    <View
      className="gap-1.5"
      accessibilityRole="image"
      accessibilityLabel={`Source bias distribution: ${counts.left} left, ${counts.center} center, ${counts.right} right`}
    >
      <View className="h-1.5 flex-row overflow-hidden rounded-full bg-bias-track">
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
          <Text className="text-[11px] text-muted-foreground">
            {counts.left} left
          </Text>
          <Text className="text-[11px] text-muted-foreground">
            {counts.center} center
          </Text>
          <Text className="text-[11px] text-muted-foreground">
            {counts.right} right
          </Text>
        </View>
      ) : null}
    </View>
  );
}
