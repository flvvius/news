import { Ionicons } from "@expo/vector-icons";
import { withUniwind } from "uniwind";

/**
 * Ionicons is a third-party component, so it must be wrapped with
 * withUniwind to accept token classNames (core RN components must not be).
 */
export const Icon = withUniwind(Ionicons);

export type IconName = keyof typeof Ionicons.glyphMap;
