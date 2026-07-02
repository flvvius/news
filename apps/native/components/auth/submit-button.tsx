import { ActivityIndicator, Pressable, Text } from "react-native";

import { cn } from "@/lib/cn";

type SubmitButtonProps = {
  label: string;
  loadingLabel: string;
  isLoading: boolean;
  onPress: () => void;
};

export function SubmitButton({
  label,
  loadingLabel,
  isLoading,
  onPress,
}: SubmitButtonProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={isLoading ? loadingLabel : label}
      accessibilityState={{ disabled: isLoading, busy: isLoading }}
      disabled={isLoading}
      onPress={onPress}
      className={cn(
        "min-h-11 flex-row items-center justify-center gap-2 rounded-md bg-primary active:opacity-80",
        isLoading && "opacity-70",
      )}
    >
      {isLoading ? (
        <ActivityIndicator
          size="small"
          colorClassName="accent-primary-foreground"
        />
      ) : null}
      <Text className="text-sm font-medium text-primary-foreground">
        {isLoading ? loadingLabel : label}
      </Text>
    </Pressable>
  );
}
