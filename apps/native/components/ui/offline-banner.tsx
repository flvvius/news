import { useNetworkState } from "expo-network";
import { Text, View } from "react-native";

import { Icon } from "@/components/ui/icon";
import { useT } from "@/contexts/locale-context";

/**
 * Shown whenever the device reports no internet. Convex queries silently wait
 * for reconnection, so without this the user just sees skeletons forever.
 */
export function OfflineBanner() {
  const t = useT();
  const networkState = useNetworkState();

  // `isInternetReachable` starts undefined while probing — only warn when
  // the platform explicitly reports the connection as down.
  if (networkState.isInternetReachable !== false) {
    return null;
  }

  return (
    <View
      accessibilityLiveRegion="polite"
      className="flex-row items-center justify-center gap-2 border-b border-warning/30 bg-warning/15 px-4 py-2"
    >
      <Icon name="cloud-offline-outline" size={14} className="text-warning" />
      <Text className="text-xs font-medium text-warning">
        {t("native.offline.banner")}
      </Text>
    </View>
  );
}
