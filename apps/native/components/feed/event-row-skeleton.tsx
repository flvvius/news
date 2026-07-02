import { View } from "react-native";

import { Skeleton } from "@/components/ui/skeleton";

/**
 * Mirrors EventRow geometry exactly (kicker, three title lines, bar,
 * meta, 80px thumbnail) so loaded content causes zero layout shift.
 */
export function EventRowSkeleton({ lead = false }: { lead?: boolean }) {
  return (
    <View className={lead ? "gap-2.5 py-5" : "gap-2.5 py-4"}>
      <View className="flex-row gap-4">
        <View className="min-w-0 flex-1 gap-1.5">
          <Skeleton className="h-3 w-20" />
          <View className="gap-1.5 pt-0.5">
            <Skeleton className={lead ? "h-6 w-full" : "h-5 w-full"} />
            <Skeleton className={lead ? "h-6 w-3/4" : "h-5 w-2/3"} />
          </View>
        </View>
        {!lead ? <Skeleton className="size-20 shrink-0 rounded-lg" /> : null}
      </View>
      {lead ? (
        <Skeleton className="w-full rounded-lg" style={{ aspectRatio: 3 / 2 }} />
      ) : null}
      <Skeleton className="h-1 w-full rounded-full" />
      <Skeleton className="h-3 w-32" />
    </View>
  );
}
