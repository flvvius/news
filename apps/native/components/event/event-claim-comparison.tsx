import { api } from "@news-app/backend/convex/_generated/api";
import type { Id } from "@news-app/backend/convex/_generated/dataModel";
import { useQuery } from "convex/react";
import * as WebBrowser from "expo-web-browser";
import { useMemo, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";

import { SourceAvatar } from "@/components/source-avatar";
import { Icon, type IconName } from "@/components/ui/icon";
import { SectionCard } from "@/components/ui/section-card";
import { cn } from "@/lib/cn";
import type {
  ClaimStatus,
  ClaimVariant,
  EventArticle,
  EventClaim,
  EventSource,
} from "@/lib/event-types";

const STATUS_ORDER: ClaimStatus[] = [
  "divergence",
  "framing",
  "agreement",
  "exclusive_left",
  "exclusive_right",
  "exclusive_center",
];

const STATUS_ICONS: Record<ClaimStatus, IconName> = {
  agreement: "checkmark-circle-outline",
  divergence: "warning-outline",
  framing: "chatbox-ellipses-outline",
  exclusive_left: "remove-circle-outline",
  exclusive_right: "remove-circle-outline",
  exclusive_center: "remove-circle-outline",
};

const STATUS_LABEL: Record<ClaimStatus, string> = {
  agreement: "Agreement",
  divergence: "Divergence",
  framing: "Framing",
  exclusive_left: "Left exclusive",
  exclusive_right: "Right exclusive",
  exclusive_center: "Center exclusive",
};

const STATUS_HEADING: Record<ClaimStatus, string> = {
  agreement: "Agreements",
  divergence: "Divergences",
  framing: "Framing differences",
  exclusive_left: "Left-only reporting",
  exclusive_right: "Right-only reporting",
  exclusive_center: "Center-only reporting",
};

const STATUS_BODY: Record<ClaimStatus, string> = {
  agreement: "Facts that sources across the spectrum report the same way.",
  divergence: "Claims where sources report materially different facts.",
  framing: "The same facts, presented with different emphasis or tone.",
  exclusive_left: "Reported only by left-leaning sources in this event.",
  exclusive_right: "Reported only by right-leaning sources in this event.",
  exclusive_center: "Reported only by center sources in this event.",
};

type FilterKey = "agreements" | "divergences" | "framing" | "exclusives";

const FILTER_STATUSES: Record<FilterKey, ClaimStatus[]> = {
  agreements: ["agreement"],
  divergences: ["divergence"],
  framing: ["framing"],
  exclusives: ["exclusive_left", "exclusive_right", "exclusive_center"],
};

function formatLean(value: string) {
  return value
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("-");
}

function ClaimVariantRow({
  variant,
  articlesById,
  sourcesById,
}: {
  variant: ClaimVariant;
  articlesById: Map<string, EventArticle>;
  sourcesById: Map<string, EventSource>;
}) {
  const article = articlesById.get(String(variant.articleId));
  const source =
    article?.source ?? sourcesById.get(String(variant.sourceId)) ?? null;

  return (
    <View className="border-l-2 border-border py-3 pl-4">
      <View className="flex-row items-start gap-3">
        <SourceAvatar
          name={source?.name ?? "S"}
          logoUrl={source?.logoUrl}
          recyclingKey={source?._id}
          sizeClassName="size-8"
          sizePx={32}
          className="shrink-0"
        />
        <View className="min-w-0 flex-1">
          <View className="mb-1.5 flex-row flex-wrap items-center gap-2">
            <Text className="text-sm font-semibold text-card-foreground">
              {source?.name ?? "Unknown source"}
            </Text>
            <View className="rounded-full bg-muted px-2 py-0.5">
              <Text className="text-[11px] font-medium text-muted-foreground">
                {formatLean(variant.sourceLean)}
              </Text>
            </View>
            {variant.value ? (
              <View className="rounded-full border border-border px-2 py-0.5">
                <Text className="text-[11px] font-medium text-foreground">
                  {variant.value}
                </Text>
              </View>
            ) : null}
          </View>

          <Text className="max-w-[65ch] text-sm leading-relaxed text-card-foreground">
            {variant.statement}
          </Text>

          {article ? (
            <Pressable
              accessibilityRole="link"
              accessibilityLabel="Read the source article"
              onPress={() =>
                WebBrowser.openBrowserAsync(article.canonicalUrl).catch(() => {
                  // Browser unavailable — nothing to recover here.
                })
              }
              hitSlop={8}
              className="mt-2 min-h-11 flex-row items-center gap-1.5 self-start active:opacity-70"
            >
              <Text className="text-xs font-medium text-primary">
                Read source article
              </Text>
              <Icon name="open-outline" size={12} className="text-primary" />
            </Pressable>
          ) : null}
        </View>
      </View>
    </View>
  );
}

function ClaimCard({
  claim,
  articlesById,
  sourcesById,
}: {
  claim: EventClaim;
  articlesById: Map<string, EventArticle>;
  sourcesById: Map<string, EventSource>;
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  const sourceCount = new Set(
    claim.variants.map((variant) => String(variant.sourceId)),
  ).size;

  const showExpandButton = claim.variants.length > 2;
  const remainingCount = claim.variants.length - 2;
  const visibleVariants = isExpanded
    ? claim.variants
    : claim.variants.slice(0, 2);

  return (
    <View className="overflow-hidden rounded-xl border border-border bg-card">
      <View className="px-4 py-4">
        <View className="mb-3 flex-row items-start justify-between gap-3">
          <View className="flex-row flex-wrap items-center gap-2">
            <View className="flex-row items-center gap-1.5 rounded-full bg-muted px-2.5 py-1">
              <Icon
                name={STATUS_ICONS[claim.status]}
                size={13}
                className="text-muted-foreground"
              />
              <Text className="text-xs font-medium text-muted-foreground">
                {STATUS_LABEL[claim.status]}
              </Text>
            </View>
            <Text className="text-xs text-muted-foreground">
              {claim.importance}/5 importance
            </Text>
          </View>
          <Text className="shrink-0 text-xs text-muted-foreground">
            {sourceCount === 1 ? "1 source" : `${sourceCount} sources`}
          </Text>
        </View>

        <Text className="max-w-[65ch] text-base font-semibold leading-snug tracking-tight text-card-foreground">
          {claim.canonicalStatement}
        </Text>
      </View>

      <View className="border-t border-border bg-muted/30 px-4 py-3">
        <View>
          {visibleVariants.map((variant, index) => (
            <View
              key={`${variant.articleId}-${variant.sourceFactIndex ?? index}-${index}`}
              className={cn(index > 0 && "border-t border-border/50")}
            >
              <ClaimVariantRow
                variant={variant}
                articlesById={articlesById}
                sourcesById={sourcesById}
              />
            </View>
          ))}
        </View>

        {showExpandButton ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={
              isExpanded ? "Show fewer variants" : "Show more variants"
            }
            accessibilityState={{ expanded: isExpanded }}
            onPress={() => setIsExpanded((value) => !value)}
            className="mt-3 min-h-11 flex-row items-center justify-center gap-1.5 rounded-lg border border-border bg-card py-2 active:bg-accent"
          >
            <Text className="text-xs font-medium text-muted-foreground">
              {isExpanded
                ? "Show less"
                : remainingCount === 1
                  ? "Show 1 more"
                  : `Show ${remainingCount} more`}
            </Text>
            <Icon
              name={isExpanded ? "chevron-up-outline" : "chevron-down-outline"}
              size={13}
              className="text-muted-foreground"
            />
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

function StatCard({
  label,
  count,
  isActive,
  onPress,
}: {
  label: string;
  count: number;
  isActive: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Filter claims: ${label}`}
      accessibilityState={{ selected: isActive }}
      onPress={onPress}
      className={cn(
        "min-h-11 flex-1 items-center justify-center rounded-xl border px-3 py-3",
        isActive
          ? "border-primary bg-primary/5"
          : "border-border bg-card active:bg-accent",
      )}
    >
      <Text className="text-2xl font-bold tabular-nums text-card-foreground">
        {count}
      </Text>
      <Text className="mt-0.5 text-center text-xs font-medium text-muted-foreground">
        {label}
      </Text>
    </Pressable>
  );
}

export function EventClaimComparison({
  eventId,
  articles,
}: {
  eventId: Id<"events">;
  articles: EventArticle[];
}) {
  const [activeFilter, setActiveFilter] = useState<FilterKey | null>(null);

  const claims = useQuery(api.claimDivergence.getEventClaims, {
    eventId,
    limit: 24,
  });

  const articlesById = useMemo(
    () => new Map(articles.map((article) => [String(article._id), article])),
    [articles],
  );
  const sourcesById = useMemo(
    () =>
      new Map(
        articles
          .map((article) => article.source)
          .filter((source): source is EventSource => Boolean(source))
          .map((source) => [String(source._id), source]),
      ),
    [articles],
  );

  if (claims === undefined) {
    return (
      <SectionCard title="Claim breakdown">
        <View
          className="flex-row items-center gap-3"
          accessibilityLiveRegion="polite"
        >
          <ActivityIndicator size="small" colorClassName="accent-primary" />
          <Text className="text-sm text-muted-foreground">
            Analyzing claims across sources…
          </Text>
        </View>
      </SectionCard>
    );
  }

  if (claims.length === 0) {
    return (
      <SectionCard title="Claim breakdown">
        <View className="items-center rounded-xl border border-dashed border-border bg-muted/20 px-4 py-8">
          <Text className="text-sm font-medium text-card-foreground">
            Claim analysis not available yet
          </Text>
          <Text className="mt-1.5 max-w-[55ch] text-center text-sm text-muted-foreground">
            We compare key claims once enough sources cover this event. Check
            back soon.
          </Text>
        </View>
      </SectionCard>
    );
  }

  const claimsByStatus = new Map<ClaimStatus, EventClaim[]>();
  for (const claim of claims) {
    claimsByStatus.set(claim.status, [
      ...(claimsByStatus.get(claim.status) ?? []),
      claim,
    ]);
  }

  const summaryCounts: Record<FilterKey, number> = {
    agreements: claimsByStatus.get("agreement")?.length ?? 0,
    divergences: claimsByStatus.get("divergence")?.length ?? 0,
    framing: claimsByStatus.get("framing")?.length ?? 0,
    exclusives:
      (claimsByStatus.get("exclusive_left")?.length ?? 0) +
      (claimsByStatus.get("exclusive_right")?.length ?? 0) +
      (claimsByStatus.get("exclusive_center")?.length ?? 0),
  };

  const filteredStatuses = activeFilter
    ? FILTER_STATUSES[activeFilter]
    : STATUS_ORDER;
  const visibleStatuses = filteredStatuses.filter(
    (status) => (claimsByStatus.get(status)?.length ?? 0) > 0,
  );

  const toggleFilter = (filter: FilterKey) => {
    setActiveFilter((current) => (current === filter ? null : filter));
  };

  return (
    <SectionCard
      title="Claim breakdown"
      subtitle="How sources agree, diverge, and frame this story."
      unpadded
    >
      <View className="border-b border-border bg-card px-4 py-4">
        <View className="gap-2">
          <View className="flex-row gap-2">
            <StatCard
              label="Agreements"
              count={summaryCounts.agreements}
              isActive={activeFilter === "agreements"}
              onPress={() => toggleFilter("agreements")}
            />
            <StatCard
              label="Divergences"
              count={summaryCounts.divergences}
              isActive={activeFilter === "divergences"}
              onPress={() => toggleFilter("divergences")}
            />
          </View>
          <View className="flex-row gap-2">
            <StatCard
              label="Framing"
              count={summaryCounts.framing}
              isActive={activeFilter === "framing"}
              onPress={() => toggleFilter("framing")}
            />
            <StatCard
              label="Exclusives"
              count={summaryCounts.exclusives}
              isActive={activeFilter === "exclusives"}
              onPress={() => toggleFilter("exclusives")}
            />
          </View>
        </View>

        {activeFilter ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Clear claim filter"
            onPress={() => setActiveFilter(null)}
            hitSlop={8}
            className="mt-3 self-start active:opacity-70"
          >
            <Text className="text-xs font-medium text-primary">
              Clear filter
            </Text>
          </Pressable>
        ) : null}
      </View>

      <View className="gap-8 px-4 py-5">
        {visibleStatuses.map((status) => {
          const statusClaims = claimsByStatus.get(status) ?? [];
          return (
            <View key={status} className="gap-4">
              <View className="border-l-2 border-primary pl-3">
                <Text className="text-base font-semibold tracking-tight text-card-foreground">
                  {STATUS_HEADING[status]}
                </Text>
                <Text className="max-w-[55ch] text-sm text-muted-foreground">
                  {STATUS_BODY[status]}
                </Text>
              </View>
              <View className="gap-4">
                {statusClaims.map((claim) => (
                  <ClaimCard
                    key={claim._id}
                    claim={claim}
                    articlesById={articlesById}
                    sourcesById={sourcesById}
                  />
                ))}
              </View>
            </View>
          );
        })}
      </View>
    </SectionCard>
  );
}
