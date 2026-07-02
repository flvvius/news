import { BottomSheetModal } from "@gorhom/bottom-sheet";
import { forwardRef } from "react";
import { Text } from "react-native";

import { PressableScale } from "@/components/ui/pressable-scale";
import { Sheet } from "@/components/ui/sheet";
import { cn } from "@/lib/cn";

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
 * one decisive button, one quiet way out. Renders through the shared {@link Sheet}
 * shell — radius, grabber, and spring drag come from there.
 */
export const ConfirmSheet = forwardRef<BottomSheetModal, ConfirmSheetProps>(
  function ConfirmSheet(
    { title, body, confirmLabel, cancelLabel, destructive = false, onConfirm },
    ref,
  ) {
    const dismiss = () => {
      if (ref && "current" in ref) {
        ref.current?.dismiss();
      }
    };

    return (
      <Sheet ref={ref}>
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
      </Sheet>
    );
  },
);
