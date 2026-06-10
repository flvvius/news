import { View } from "react-native";

import { Skeleton } from "@/components/ui/skeleton";

/** Card-shaped placeholder matching EventCard proportions. */
export function EventCardSkeleton() {
  return (
    <View className="overflow-hidden rounded-[1.2rem] border border-border/80 bg-card/95">
      <Skeleton className="w-full rounded-none" style={{ aspectRatio: 16 / 10 }} />
      <View className="gap-4 px-5 pb-6 pt-5">
        <View className="flex-row items-center justify-between">
          <Skeleton className="h-3 w-28" />
          <View className="flex-row gap-2">
            <Skeleton className="size-9 rounded-full" />
            <Skeleton className="size-9 rounded-full" />
          </View>
        </View>
        <View className="gap-2">
          <Skeleton className="h-6 w-full" />
          <Skeleton className="h-6 w-3/4" />
        </View>
        <View className="gap-2">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-5/6" />
        </View>
        <View className="flex-row items-center gap-3 border-t border-border/70 pt-4">
          <View className="flex-row">
            <Skeleton className="size-10 rounded-full" />
            <Skeleton className="-ml-3 size-10 rounded-full" />
            <Skeleton className="-ml-3 size-10 rounded-full" />
          </View>
          <View className="flex-1 gap-1.5">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-3 w-16" />
          </View>
        </View>
      </View>
    </View>
  );
}
