import { type ReactNode } from "react";
import { Text, View } from "react-native";

import { cn } from "@/lib/cn";

type SectionCardProps = {
  title: string;
  subtitle?: string;
  children: ReactNode;
  /** Remove default body padding (for edge-to-edge content). */
  unpadded?: boolean;
  className?: string;
};

/** Card with a muted bordered header — the web event page section card. */
export function SectionCard({
  title,
  subtitle,
  children,
  unpadded = false,
  className,
}: SectionCardProps) {
  return (
    <View
      className={cn(
        "overflow-hidden rounded-xl border border-border/80 bg-card",
        className,
      )}
    >
      <View className="border-b border-border/70 bg-muted/30 px-5 py-4">
        <Text className="text-xl font-semibold tracking-tight text-card-foreground">
          {title}
        </Text>
        {subtitle ? (
          <Text className="mt-1 text-sm text-muted-foreground">{subtitle}</Text>
        ) : null}
      </View>
      <View className={cn(!unpadded && "px-5 py-5")}>{children}</View>
    </View>
  );
}
