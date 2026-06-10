import { type ReactNode } from "react";
import { Pressable, Text, View } from "react-native";

import { Icon, type IconName } from "@/components/ui/icon";
import { cn } from "@/lib/cn";

export function SettingsGroup({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <View className="gap-2">
      <Text className="px-1 text-xs font-semibold uppercase tracking-[1.8px] text-muted-foreground">
        {title}
      </Text>
      <View className="overflow-hidden rounded-xl border border-border/80 bg-card">
        {children}
      </View>
    </View>
  );
}

type SettingsRowProps = {
  icon: IconName;
  label: string;
  detail?: string;
  onPress?: () => void;
  trailing?: ReactNode;
  destructive?: boolean;
  isFirst?: boolean;
  accessibilityLabel?: string;
};

export function SettingsRow({
  icon,
  label,
  detail,
  onPress,
  trailing,
  destructive = false,
  isFirst = false,
  accessibilityLabel,
}: SettingsRowProps) {
  const content = (
    <>
      <Icon
        name={icon}
        size={20}
        className={destructive ? "text-destructive" : "text-muted-foreground"}
      />
      <View className="min-w-0 flex-1">
        <Text
          className={cn(
            "text-base",
            destructive ? "text-destructive" : "text-foreground",
          )}
        >
          {label}
        </Text>
        {detail ? (
          <Text numberOfLines={1} className="text-sm text-muted-foreground">
            {detail}
          </Text>
        ) : null}
      </View>
      {trailing ??
        (onPress ? (
          <Icon
            name="chevron-forward-outline"
            size={16}
            className="text-muted-foreground"
          />
        ) : null)}
    </>
  );

  const rowClassName = cn(
    "min-h-12 flex-row items-center gap-3 px-4 py-3",
    !isFirst && "border-t border-border/70",
  );

  if (!onPress) {
    return <View className={rowClassName}>{content}</View>;
  }

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      onPress={onPress}
      className={cn(rowClassName, "active:bg-accent")}
    >
      {content}
    </Pressable>
  );
}
