import { useEffect } from "react";
import type { StyleProp, ViewStyle } from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";

import { cn } from "@/lib/cn";

type SkeletonProps = {
  className?: string;
  style?: StyleProp<ViewStyle>;
};

export function Skeleton({ className, style }: SkeletonProps) {
  const opacity = useSharedValue(0.55);

  useEffect(() => {
    opacity.value = withRepeat(withTiming(1, { duration: 700 }), -1, true);
  }, [opacity]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
  }));

  return (
    <Animated.View
      accessibilityElementsHidden
      className={cn("rounded-lg bg-muted", className)}
      style={[animatedStyle, style]}
    />
  );
}
