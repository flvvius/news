import { useEffect, type ReactNode } from "react";
import { Text, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";

const EASE_OUT = Easing.bezier(0.23, 1, 0.32, 1);
/** A flick removes regardless of distance (momentum-based dismissal). */
const DISMISS_VELOCITY = 800;
const DISMISS_FRACTION = 0.4;

type SwipeToRemoveRowProps = {
  children: ReactNode;
  onRemove: () => void;
  /** Visible label of the revealed action; also the screen-reader action. */
  actionLabel: string;
  /**
   * Identity of the rendered item. List virtualization recycles component
   * instances, so the drag offset must reset when the row is reused.
   */
  resetKey: string;
};

/**
 * Left-swipe-to-remove with velocity dismissal: a quick flick removes the
 * row even before the distance threshold; dragging the wrong way meets
 * friction. The revealed layer is a flat token surface with a text label —
 * never an alarm-red panel.
 */
export function SwipeToRemoveRow({
  children,
  onRemove,
  actionLabel,
  resetKey,
}: SwipeToRemoveRowProps) {
  const translateX = useSharedValue(0);
  const rowWidth = useSharedValue(0);

  useEffect(() => {
    translateX.value = 0;
  }, [resetKey, translateX]);

  const pan = Gesture.Pan()
    // Horizontal intent only — vertical motion stays with the list scroll.
    .activeOffsetX([-16, 16])
    .failOffsetY([-12, 12])
    .onUpdate((event) => {
      translateX.value =
        event.translationX < 0
          ? event.translationX
          : event.translationX / 12;
    })
    .onEnd((event) => {
      const width = rowWidth.value || 1;
      const flick = event.velocityX < -DISMISS_VELOCITY;
      const pastThreshold = translateX.value < -DISMISS_FRACTION * width;
      if (flick || pastThreshold) {
        translateX.value = withTiming(
          -width,
          { duration: 200, easing: EASE_OUT },
          () => runOnJS(onRemove)(),
        );
      } else {
        translateX.value = withSpring(0, {
          velocity: event.velocityX,
          damping: 20,
          stiffness: 240,
        });
      }
    });

  const contentStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }],
  }));
  const actionStyle = useAnimatedStyle(() => ({
    opacity: Math.min(1, -translateX.value / 64),
  }));

  return (
    <View
      accessibilityActions={[
        { name: "activate", label: actionLabel },
        { name: "magicTap", label: actionLabel },
      ]}
      onAccessibilityAction={(event) => {
        if (
          event.nativeEvent.actionName === "activate" ||
          event.nativeEvent.actionName === "magicTap"
        ) {
          onRemove();
        }
      }}
      onLayout={(event) => {
        rowWidth.value = event.nativeEvent.layout.width;
      }}
    >
      <Animated.View
        style={actionStyle}
        pointerEvents="none"
        className="absolute bottom-0 left-0 right-0 top-0 flex-row items-center justify-end rounded-lg bg-destructive/10 pr-5"
      >
        <Text className="text-sm font-semibold text-destructive">
          {actionLabel}
        </Text>
      </Animated.View>
      <GestureDetector gesture={pan}>
        {/* Opaque background so the action layer stays hidden at rest. */}
        <Animated.View style={contentStyle} className="bg-background">
          {children}
        </Animated.View>
      </GestureDetector>
    </View>
  );
}
