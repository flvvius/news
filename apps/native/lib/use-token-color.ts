import type { ColorValue } from "react-native";
import { useCSSVariable } from "uniwind";

/**
 * Theme-aware token color for places that need a color *value* instead of a
 * className (React Navigation chrome, bottom-sheet backgrounds). Components
 * themselves must keep using token classNames.
 */
export function useTokenColor(name: `--color-${string}`): ColorValue | undefined {
  const value = useCSSVariable(name);
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.trim() === "") return undefined;
  return value as ColorValue;
}
