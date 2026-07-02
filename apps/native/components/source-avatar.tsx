import { Text, View } from "react-native";

import { Image } from "@/components/ui/image";
import { cn } from "@/lib/cn";

type SourceAvatarProps = {
  name: string;
  logoUrl?: string;
  /** Diameter in Tailwind size units (e.g. "size-10"). */
  sizeClassName?: string;
  /** Pixel size hint for expo-image decode. */
  sizePx?: number;
  className?: string;
  recyclingKey?: string;
};

export function SourceAvatar({
  name,
  logoUrl,
  sizeClassName = "size-10",
  sizePx = 40,
  className,
  recyclingKey,
}: SourceAvatarProps) {
  return (
    <View
      accessibilityLabel={logoUrl ? undefined : name}
      className={cn(
        "items-center justify-center overflow-hidden rounded-full border border-border bg-background",
        sizeClassName,
        className,
      )}
    >
      {logoUrl ? (
        <Image
          source={{ uri: logoUrl }}
          recyclingKey={recyclingKey ?? logoUrl}
          contentFit="contain"
          className="size-full p-1.5"
          style={{ width: sizePx, height: sizePx }}
          accessibilityLabel={name}
          transition={100}
        />
      ) : (
        <Text className="text-xs font-medium text-foreground">
          {name.charAt(0)}
        </Text>
      )}
    </View>
  );
}

type SourceAvatarStackProps = {
  sources: Array<{ _id: string; name: string; logoUrl?: string }>;
  max?: number;
};

/** Overlapping avatar row, mirrors the web `-space-x-3` stack. */
export function SourceAvatarStack({ sources, max = 5 }: SourceAvatarStackProps) {
  const visibleCount = sources.slice(0, max).length;

  return (
    <View
      accessibilityRole="list"
      accessibilityLabel={`${visibleCount} sources`}
      className="flex-row"
    >
      {sources.slice(0, max).map((source, index) => (
        <SourceAvatar
          key={source._id}
          name={source.name}
          logoUrl={source.logoUrl}
          recyclingKey={source._id}
          className={cn("border-2 border-background bg-background", {
            "-ml-3": index > 0,
          })}
        />
      ))}
    </View>
  );
}
