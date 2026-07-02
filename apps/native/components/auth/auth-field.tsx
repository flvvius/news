import { Text, TextInput, View, type TextInputProps } from "react-native";

type AuthFieldProps = {
  label: string;
  error?: string;
} & Pick<
  TextInputProps,
  | "value"
  | "onChangeText"
  | "placeholder"
  | "secureTextEntry"
  | "keyboardType"
  | "autoCapitalize"
  | "autoComplete"
  | "textContentType"
  | "editable"
  | "onSubmitEditing"
  | "returnKeyType"
>;

export function AuthField({ label, error, ...inputProps }: AuthFieldProps) {
  return (
    <View className="gap-1.5">
      <Text className="text-sm font-medium text-foreground">{label}</Text>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColorClassName="accent-muted-foreground"
        className="h-11 rounded-md border border-input bg-background px-3 text-base text-foreground"
        autoCorrect={false}
        {...inputProps}
      />
      {error ? (
        <Text
          accessibilityRole="alert"
          accessibilityLiveRegion="polite"
          className="text-sm text-destructive"
        >
          {error}
        </Text>
      ) : null}
    </View>
  );
}
