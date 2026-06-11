import { type ReactNode } from "react";
import { View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { OfflineBanner } from "@/components/ui/offline-banner";
import { cn } from "@/lib/cn";

type ScreenProps = {
  children: ReactNode;
  className?: string;
  /** Apply the top safe-area inset (off for screens with their own header). */
  withTopInset?: boolean;
};

export function Screen({
  children,
  className,
  withTopInset = true,
}: ScreenProps) {
  const insets = useSafeAreaInsets();

  return (
    <View
      className={cn("flex-1 bg-background", className)}
      style={withTopInset ? { paddingTop: insets.top } : undefined}
    >
      <OfflineBanner />
      {children}
    </View>
  );
}
