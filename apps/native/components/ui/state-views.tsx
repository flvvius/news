import { Text, View } from "react-native";

import type { IconName } from "@/components/ui/icon";
import { PressableScale } from "@/components/ui/pressable-scale";
import { useT } from "@/contexts/locale-context";
import { cn } from "@/lib/cn";

type StateViewProps = {
  /** Accepted for API compatibility; states are typographic, never illustrated. */
  icon?: IconName;
  title: string;
  body?: string;
  actionLabel?: string;
  onAction?: () => void;
  className?: string;
};

/**
 * Typographic state view: one line, one action. No boxes, no dashed
 * borders, no icon mascots — an empty screen should read like a quiet
 * editorial note, not an error costume.
 */
function StateView({ title, body, actionLabel, onAction, className }: StateViewProps) {
  return (
    <View className={cn("items-start gap-2 py-10", className)}>
      <Text className="text-lg font-semibold tracking-tight text-foreground">
        {title}
      </Text>
      {body ? (
        <Text className="max-w-[455px] text-base leading-relaxed text-muted-foreground">
          {body}
        </Text>
      ) : null}
      {actionLabel && onAction ? (
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel={actionLabel}
          onPress={onAction}
          className="mt-2"
          contentClassName="min-h-11 items-center justify-center rounded-lg bg-primary px-5"
        >
          <Text className="text-base font-medium text-primary-foreground">
            {actionLabel}
          </Text>
        </PressableScale>
      ) : null}
    </View>
  );
}

export function EmptyState(props: StateViewProps) {
  return <StateView {...props} />;
}

type ErrorStateProps = Partial<StateViewProps>;

export function ErrorState({
  title,
  body,
  actionLabel,
  onAction,
  className,
}: ErrorStateProps) {
  const t = useT();

  return (
    <StateView
      title={title ?? t("native.error.title")}
      body={body ?? t("native.error.body")}
      actionLabel={onAction ? (actionLabel ?? t("native.error.retry")) : undefined}
      onAction={onAction}
      className={className}
    />
  );
}
