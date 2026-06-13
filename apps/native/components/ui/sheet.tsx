import {
  BottomSheetBackdrop,
  BottomSheetModal,
  BottomSheetView,
  type BottomSheetBackdropProps,
} from "@gorhom/bottom-sheet";
import { forwardRef, useCallback, type ReactNode } from "react";
import { View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useTokenColor } from "@/lib/use-token-color";

type SheetProps = {
  children: ReactNode;
  /** Fired when the sheet is dismissed (swipe, backdrop, or programmatic). */
  onDismiss?: () => void;
};

/**
 * Bottom-sheet shell: backdrop, card background, top-only radius, grabber, and
 * safe-area padding. Dynamically sized to its content. The single place those
 * sheet mechanics live — ConfirmSheet and the sign-in gate both render through
 * it, differing only in their children.
 */
export const Sheet = forwardRef<BottomSheetModal, SheetProps>(function Sheet(
  { children, onDismiss },
  ref,
) {
  const insets = useSafeAreaInsets();
  const cardColor = useTokenColor("--color-card");
  const mutedForeground = useTokenColor("--color-muted-foreground");

  const renderBackdrop = useCallback(
    (props: BottomSheetBackdropProps) => (
      <BottomSheetBackdrop
        {...props}
        appearsOnIndex={0}
        disappearsOnIndex={-1}
      />
    ),
    [],
  );

  return (
    <BottomSheetModal
      ref={ref}
      enableDynamicSizing
      onDismiss={onDismiss}
      backdropComponent={renderBackdrop}
      backgroundStyle={{
        backgroundColor: cardColor,
        borderTopLeftRadius: 14,
        borderTopRightRadius: 14,
        borderBottomLeftRadius: 0,
        borderBottomRightRadius: 0,
      }}
      handleIndicatorStyle={{ backgroundColor: mutedForeground }}
    >
      <BottomSheetView>
        <View
          className="gap-3 px-5 pt-1"
          style={{ paddingBottom: Math.max(insets.bottom, 16) }}
        >
          {children}
        </View>
      </BottomSheetView>
    </BottomSheetModal>
  );
});
