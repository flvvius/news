import { Text, View } from "react-native";

import { cn } from "@/lib/cn";
import {
  DEFAULT_BIAS_THRESHOLDS,
  getBiasLabel,
  validateBiasThresholds,
} from "@/lib/bias";

type BiasIndicatorProps = {
  bias: number; // -5 (Left) to +5 (Right)
  size?: "sm" | "md" | "lg";
  /** Validated thresholds from config — passed by the parent to avoid per-row subscriptions. */
  thresholds?: number[];
};

const TRACK_SIZE = {
  sm: "h-1.5 w-20",
  md: "h-2 w-28",
  lg: "h-2.5 w-36",
} as const;

const DOT_SIZE = {
  sm: "size-3",
  md: "size-4",
  lg: "size-5",
} as const;

const TEXT_SIZE = {
  sm: "text-xs",
  md: "text-xs",
  lg: "text-sm",
} as const;

function dotColorClass(bias: number, thresholds: number[]) {
  if (bias < thresholds[0]) return "bg-bias-left";
  if (bias < thresholds[1]) return "bg-bias-left-muted";
  if (bias <= thresholds[2]) return "bg-bias-center";
  if (bias <= thresholds[3]) return "bg-bias-right-muted";
  return "bg-bias-right";
}

function textColorClass(bias: number, thresholds: number[]) {
  if (bias < thresholds[0]) return "text-bias-left";
  if (bias < thresholds[1]) return "text-bias-left-muted";
  if (bias <= thresholds[2]) return "text-bias-center";
  if (bias <= thresholds[3]) return "text-bias-right-muted";
  return "text-bias-right";
}

/**
 * Port of the web BiasIndicator. The web version paints a CSS gradient on
 * the track; natively we approximate it with three token-colored segments
 * at the same 40% opacity (no extra gradient dependency).
 */
export function BiasIndicator({
  bias,
  size = "md",
  thresholds: thresholdsProp,
}: BiasIndicatorProps) {
  const thresholds = validateBiasThresholds(
    thresholdsProp ?? DEFAULT_BIAS_THRESHOLDS,
  );
  const position = Math.max(0, Math.min(100, ((bias + 5) / 10) * 100));
  const label = getBiasLabel(bias, thresholds);

  return (
    <View
      className="flex-row items-center gap-2"
      accessibilityRole="image"
      accessibilityLabel={`Bias: ${label}`}
    >
      <View
        className={cn(
          "relative justify-center rounded-full bg-bias-track",
          TRACK_SIZE[size],
        )}
      >
        <View className="absolute inset-0 flex-row overflow-hidden rounded-full opacity-40">
          <View className="flex-1 bg-bias-left" />
          <View className="flex-1 bg-bias-center" />
          <View className="flex-1 bg-bias-right" />
        </View>
        <View
          className={cn(
            "absolute rounded-full border-2 border-card",
            dotColorClass(bias, thresholds),
            DOT_SIZE[size],
          )}
          style={{
            left: `${position}%`,
            transform: [{ translateX: "-50%" }],
          }}
        />
      </View>
      <Text
        className={cn(
          "font-medium",
          TEXT_SIZE[size],
          textColorClass(bias, thresholds),
        )}
      >
        {label}
      </Text>
    </View>
  );
}
