import { type ReactNode } from "react";
import {
  Pressable,
  type GestureResponderEvent,
  type PressableProps,
} from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";

/** Strong ease-out — built-in curves are too weak to read as intentional. */
const EASE_OUT = Easing.bezier(0.23, 1, 0.32, 1);

type PressableScaleProps = Omit<PressableProps, "children" | "style"> & {
  children: ReactNode;
  /** Pressed scale; keep subtle (0.95–0.98). */
  scaleTo?: number;
  /** Layout classes for the scaled content wrapper. */
  contentClassName?: string;
  className?: string;
};

/**
 * Pressable with physical press feedback: scales down on press-in (120ms)
 * and releases slightly slower (160ms). Transform-only — runs on the UI
 * thread and respects reduced motion by being imperceptible at 2–3%.
 */
export function PressableScale({
  children,
  scaleTo = 0.97,
  contentClassName,
  onPressIn,
  onPressOut,
  ...pressableProps
}: PressableScaleProps) {
  const pressed = useSharedValue(0);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: 1 - pressed.value * (1 - scaleTo) }],
  }));

  const handlePressIn = (event: GestureResponderEvent) => {
    pressed.value = withTiming(1, { duration: 120, easing: EASE_OUT });
    onPressIn?.(event);
  };

  const handlePressOut = (event: GestureResponderEvent) => {
    pressed.value = withTiming(0, { duration: 160, easing: EASE_OUT });
    onPressOut?.(event);
  };

  return (
    <Pressable
      {...pressableProps}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
    >
      <Animated.View style={animatedStyle} className={contentClassName}>
        {children}
      </Animated.View>
    </Pressable>
  );
}
