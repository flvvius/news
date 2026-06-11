import { Pressable, Text, View } from "react-native";

import { Icon, type IconName } from "@/components/ui/icon";
import { useT } from "@/contexts/locale-context";
import { cn } from "@/lib/cn";

type StateViewProps = {
  icon?: IconName;
  title: string;
  body?: string;
  actionLabel?: string;
  onAction?: () => void;
  className?: string;
};

function StateView({
  icon,
  title,
  body,
  actionLabel,
  onAction,
  className,
}: StateViewProps) {
  return (
    <View
      className={cn(
        "items-center gap-3 rounded-xl border border-dashed border-border bg-muted/20 px-5 py-10",
        className,
      )}
    >
      {icon ? (
        <View className="size-14 items-center justify-center rounded-full bg-primary/10">
          <Icon name={icon} size={26} className="text-primary" />
        </View>
      ) : null}
      <Text className="text-center text-base font-semibold text-foreground">
        {title}
      </Text>
      {body ? (
        <Text className="max-w-[240px] text-center text-sm leading-relaxed text-muted-foreground">
          {body}
        </Text>
      ) : null}
      {actionLabel && onAction ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={actionLabel}
          onPress={onAction}
          className="mt-1 min-h-11 items-center justify-center rounded-full bg-primary px-6 active:opacity-80"
        >
          <Text className="text-sm font-medium text-primary-foreground">
            {actionLabel}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export function EmptyState(props: StateViewProps) {
  return <StateView icon="albums-outline" {...props} />;
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
      icon="cloud-offline-outline"
      title={title ?? t("native.error.title")}
      body={body ?? t("native.error.body")}
      actionLabel={onAction ? (actionLabel ?? t("native.error.retry")) : undefined}
      onAction={onAction}
      className={className}
    />
  );
}
