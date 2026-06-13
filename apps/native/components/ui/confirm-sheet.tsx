import {
  BottomSheetBackdrop,
  BottomSheetModal,
  BottomSheetView,
  type BottomSheetBackdropProps,
} from "@gorhom/bottom-sheet";
import { forwardRef, useCallback } from "react";
import { Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { PressableScale } from "@/components/ui/pressable-scale";
import { cn } from "@/lib/cn";
import { useTokenColor } from "@/lib/use-token-color";

type ConfirmSheetProps = {
  title: string;
  body?: string;
  confirmLabel: string;
  cancelLabel: string;
  destructive?: boolean;
  onConfirm: () => void;
};

/**
 * Confirmation bottom sheet for consequential actions: title, plain body,
 * one decisive button, one quiet way out. Spring drag and the grabber come
 * from the sheet library; radius is top-only by design.
 */
export const ConfirmSheet = forwardRef<BottomSheetModal, ConfirmSheetProps>(
  function ConfirmSheet(
    { title, body, confirmLabel, cancelLabel, destructive = false, onConfirm },
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

    const dismiss = () => {
      if (ref && "current" in ref) {
        ref.current?.dismiss();
      }
    };

    return (
      <BottomSheetModal
        ref={ref}
        enableDynamicSizing
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
          <Text className="text-lg font-semibold tracking-tight text-card-foreground">
            {title}
          </Text>
          {body ? (
            <Text className="max-w-[455px] text-base leading-relaxed text-muted-foreground">
              {body}
            </Text>
          ) : null}
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel={confirmLabel}
            onPress={() => {
              dismiss();
              onConfirm();
            }}
            className="mt-2"
            contentClassName={cn(
              "min-h-12 items-center justify-center rounded-lg",
              destructive ? "bg-destructive" : "bg-primary",
            )}
          >
            <Text
              className={cn(
                "text-base font-medium",
                destructive
                  ? "text-destructive-foreground"
                  : "text-primary-foreground",
              )}
            >
              {confirmLabel}
            </Text>
          </PressableScale>
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel={cancelLabel}
            onPress={dismiss}
            contentClassName="min-h-12 items-center justify-center rounded-lg"
          >
            <Text className="text-base font-medium text-muted-foreground">
              {cancelLabel}
            </Text>
          </PressableScale>
          </View>
        </BottomSheetView>
      </BottomSheetModal>
    );
  },
);
