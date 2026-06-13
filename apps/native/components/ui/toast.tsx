import { useEffect } from "react";
import { Text } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  Easing,
  FadeInDown,
  FadeOutDown,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";

import { PressableScale } from "@/components/ui/pressable-scale";

const EASE_OUT = Easing.bezier(0.23, 1, 0.32, 1);
/** A flick dismisses regardless of distance (momentum-based dismissal). */
const DISMISS_VELOCITY = 800;
const DISMISS_DISTANCE = 48;

type ToastProps = {
  message: string;
  actionLabel?: string;
  onAction?: () => void;
  /** Must be referentially stable (useCallback) — drives the auto-hide timer. */
  onDismiss: () => void;
  durationMs?: number;
};

/**
 * Quiet bottom toast: bg-card + hairline, enters from below (250ms) and
 * dismisses the same direction it entered — by timer, or by swipe with
 * velocity passthrough. Dragging against the entry direction meets
 * friction, not a wall.
 */
export function Toast({
  message,
  actionLabel,
  onAction,
  onDismiss,
  durationMs = 4000,
}: ToastProps) {
  const translateY = useSharedValue(0);

  useEffect(() => {
    const timeout = setTimeout(onDismiss, durationMs);
    return () => clearTimeout(timeout);
  }, [durationMs, onDismiss]);

  const pan = Gesture.Pan()
    .onUpdate((event) => {
      translateY.value =
        event.translationY > 0
          ? event.translationY
          : event.translationY / 12;
    })
    .onEnd((event) => {
      if (
        event.velocityY > DISMISS_VELOCITY ||
        translateY.value > DISMISS_DISTANCE
      ) {
        translateY.value = withTiming(
          160,
          { duration: 200, easing: EASE_OUT },
          () => runOnJS(onDismiss)(),
        );
      } else {
        translateY.value = withSpring(0, {
          velocity: event.velocityY,
          damping: 18,
          stiffness: 220,
        });
      }
    });

  const dragStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
  }));

  return (
    <GestureDetector gesture={pan}>
      <Animated.View
        entering={FadeInDown.duration(250).easing(EASE_OUT)}
        exiting={FadeOutDown.duration(200)}
        style={dragStyle}
        accessibilityLiveRegion="polite"
        className="absolute bottom-4 left-5 right-5 flex-row items-center justify-between gap-3 rounded-lg border border-border bg-card px-4 py-2"
      >
        <Text className="min-w-0 flex-1 text-sm text-card-foreground">
          {message}
        </Text>
        {actionLabel && onAction ? (
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel={actionLabel}
            onPress={onAction}
            contentClassName="min-h-11 justify-center px-1"
          >
            <Text className="text-sm font-semibold text-primary">
              {actionLabel}
            </Text>
          </PressableScale>
        ) : null}
      </Animated.View>
    </GestureDetector>
  );
}
