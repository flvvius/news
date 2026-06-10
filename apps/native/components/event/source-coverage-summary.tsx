import { Text, View } from "react-native";

import { BiasIndicator } from "@/components/bias-indicator";
import { SourceAvatar } from "@/components/source-avatar";
import { SectionCard } from "@/components/ui/section-card";
import { biasBucketBgClass, getBiasBucket, type BiasBucket } from "@/lib/bias";
import { uniqueEventSources, type EventArticle } from "@/lib/event-types";

const BUCKET_LABEL: Record<BiasBucket, string> = {
  left: "Left-leaning",
  center: "Center",
  right: "Right-leaning",
};

type SourceCoverageSummaryProps = {
  articles: EventArticle[];
  biasThresholds?: number[];
};

export function SourceCoverageSummary({
  articles,
  biasThresholds,
}: SourceCoverageSummaryProps) {
  const sources = uniqueEventSources(articles);

  const counts: Record<BiasBucket, number> = { left: 0, center: 0, right: 0 };
  for (const source of sources) {
    counts[getBiasBucket(source)]++;
  }
  const total = Math.max(1, sources.length);
  const buckets: BiasBucket[] = ["left", "center", "right"];

  return (
    <SectionCard title="Coverage by source">
      <View className="gap-5">
        <View className="gap-3">
          <View className="h-2 flex-row overflow-hidden rounded-full bg-muted">
            {buckets.map((bucket) => {
              const count = counts[bucket];
              if (count === 0) return null;
              return (
                <View
                  key={bucket}
                  className={biasBucketBgClass(bucket)}
                  style={{ flex: count / total }}
                />
              );
            })}
          </View>

          <View className="flex-row gap-2">
            {buckets.map((bucket) => (
              <View
                key={bucket}
                className="flex-1 rounded-lg border border-border/70 bg-background/55 px-3 py-2"
              >
                <Text className="text-xs text-muted-foreground">
                  {BUCKET_LABEL[bucket]}
                </Text>
                <Text className="text-lg font-semibold text-card-foreground">
                  {counts[bucket]}
                </Text>
              </View>
            ))}
          </View>
        </View>

        <View className="gap-3">
          {sources.map((source) => (
            <View
              key={source._id}
              className="flex-row items-center gap-3 rounded-lg border border-border/70 bg-background/55 px-3 py-3"
            >
              <SourceAvatar
                name={source.name}
                logoUrl={source.logoUrl}
                recyclingKey={source._id}
                className="shrink-0"
              />
              <View className="min-w-0 flex-1 gap-1">
                <View className="flex-row items-center justify-between gap-2">
                  <Text
                    numberOfLines={1}
                    className="shrink text-sm font-medium text-card-foreground"
                  >
                    {source.name}
                  </Text>
                  <View className="shrink-0 rounded-full border border-border/70 px-2 py-0.5">
                    <Text className="text-[11px] text-muted-foreground">
                      {source.reliabilityScore}/10
                    </Text>
                  </View>
                </View>
                <BiasIndicator
                  bias={source.baseBias}
                  size="sm"
                  thresholds={biasThresholds}
                />
                {source.mbfcFactual || source.mbfcCredibility ? (
                  <Text
                    numberOfLines={1}
                    className="text-xs text-muted-foreground"
                  >
                    {[
                      source.mbfcFactual
                        ? `Factual: ${source.mbfcFactual}`
                        : null,
                      source.mbfcCredibility
                        ? `Credibility: ${source.mbfcCredibility}`
                        : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </Text>
                ) : null}
              </View>
            </View>
          ))}
        </View>
      </View>
    </SectionCard>
  );
}
