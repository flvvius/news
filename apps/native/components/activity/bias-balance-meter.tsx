import { Text, View } from "react-native";

import { useT } from "@/contexts/locale-context";

type BiasBalanceMeterProps = {
  value: number;
};

function getBiasBalanceLabel(value: number, t: ReturnType<typeof useT>) {
  const absolute = Math.abs(value);
  if (absolute < 15) {
    return t("bias.label.balanced");
  }
  if (value < 0) {
    return absolute >= 60 ? t("bias.label.leftStrong") : t("bias.label.left");
  }
  return absolute >= 60 ? t("bias.label.rightStrong") : t("bias.label.right");
}

function getBiasBalanceCopy(value: number, t: ReturnType<typeof useT>) {
  const absolute = Math.abs(value);
  if (absolute < 15) {
    return t("bias.copy.balanced");
  }
  if (value < 0) {
    return absolute >= 60 ? t("bias.copy.leftStrong") : t("bias.copy.left");
  }
  return absolute >= 60 ? t("bias.copy.rightStrong") : t("bias.copy.right");
}

/** Native port of the web bias-balance-meter (apps/web). */
export function BiasBalanceMeter({ value }: BiasBalanceMeterProps) {
  const t = useT();
  const clampedValue = Math.max(-100, Math.min(100, Math.round(value)));
  // RN cannot translate by percentages, so keep the dot fully on the track
  // by clamping and centering it with negative margins instead.
  const indicatorPosition = Math.min(
    95,
    Math.max(5, ((clampedValue + 100) / 200) * 100),
  );
  const label = getBiasBalanceLabel(clampedValue, t);
  const copy = getBiasBalanceCopy(clampedValue, t);

  return (
    <View className="gap-3">
      <View className="flex-row items-center justify-between gap-3">
        <View className="min-w-0 flex-1">
          <Text className="text-lg font-semibold text-card-foreground">
            {label}
          </Text>
          <Text className="text-xs text-muted-foreground">{copy}</Text>
        </View>
        <View className="items-end">
          <Text className="text-2xl font-bold tabular-nums text-card-foreground">
            {clampedValue > 0 ? "+" : ""}
            {clampedValue}
          </Text>
          <Text className="text-[12px] uppercase tracking-[2px] text-muted-foreground">
            {t("bias.balance")}
          </Text>
        </View>
      </View>

      <View className="gap-2">
        <View className="h-3 overflow-hidden rounded-full bg-muted">
          <View className="absolute bottom-0 left-0 top-0 w-1/2 bg-bias-left-muted/70" />
          <View className="absolute bottom-0 right-0 top-0 w-1/2 bg-bias-right-muted/70" />
          <View className="absolute bottom-0 left-1/2 top-0 w-px bg-border" />
          <View
            accessibilityElementsHidden
            className="absolute size-4 rounded-full border-2 border-background bg-card"
            style={{
              left: `${indicatorPosition}%`,
              top: "50%",
              marginLeft: -8,
              marginTop: -8,
            }}
          />
        </View>
        <View className="flex-row items-center justify-between">
          <Text className="text-[12px] text-muted-foreground">
            {t("bias.leftHeavy")}
          </Text>
          <Text className="text-[12px] text-muted-foreground">
            {t("bias.center")}
          </Text>
          <Text className="text-[12px] text-muted-foreground">
            {t("bias.rightHeavy")}
          </Text>
        </View>
      </View>
    </View>
  );
}
