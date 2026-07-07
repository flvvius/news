import { api } from "@news-app/backend/convex/_generated/api";
import type { Id } from "@news-app/backend/convex/_generated/dataModel";
import { useQuery } from "convex/react";
import * as WebBrowser from "expo-web-browser";
import { useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import Animated, { FadeIn } from "react-native-reanimated";

import { Icon } from "@/components/ui/icon";
import { useT } from "@/contexts/locale-context";
import { cn } from "@/lib/cn";
import type {
  ClaimStatus,
  ClaimVariant,
  EventArticle,
  EventClaim,
  EventSource,
} from "@/lib/event-types";

/** Most informative first: divergence and exclusives, then framing, agreement. */
const STATUS_ORDER: ClaimStatus[] = [
  "divergence",
  "exclusive_left",
  "exclusive_right",
  "exclusive_center",
  "framing",
  "agreement",
];

/**
 * Status mark colors. Bias tokens only where the status itself is
 * directional; the rest stay grayscale so the list never reads as a
 * traffic light.
 */
const STATUS_MARK: Record<ClaimStatus, string> = {
  divergence: "bg-foreground",
  framing: "bg-muted-foreground",
  agreement: "bg-border",
  exclusive_left: "bg-bias-left",
  exclusive_right: "bg-bias-right",
  exclusive_center: "bg-bias-center",
};

const STATUS_LABEL_KEY = {
  agreement: "claim.agreement",
  divergence: "claim.divergence",
  framing: "claim.framing",
  exclusive_left: "claim.leftExclusive",
  exclusive_right: "claim.rightExclusive",
  exclusive_center: "claim.centerExclusive",
} as const;

const STATUS_HEADING_KEY = {
  agreement: "claim.agreements",
  divergence: "claim.divergences",
  framing: "claim.framings",
  exclusive_left: "claim.leftExclusives",
  exclusive_right: "claim.rightExclusives",
  exclusive_center: "claim.centerExclusives",
} as const;

const STATUS_BODY_KEY = {
  agreement: "claim.agreementBody",
  divergence: "claim.divergenceBody",
  framing: "claim.framingBody",
  exclusive_left: "claim.leftExclusiveBody",
  exclusive_right: "claim.rightExclusiveBody",
  exclusive_center: "claim.centerExclusiveBody",
} as const;

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
  const t = useT();
  const article = articlesById.get(String(variant.articleId));
  const source =
    article?.source ?? sourcesById.get(String(variant.sourceId)) ?? null;

  return (
    <View className="gap-1 py-3">
      <View className="flex-row flex-wrap items-baseline gap-x-2">
        <Text className="text-base font-semibold text-foreground">
          {source?.name ?? t("claim.unknownSource")}
        </Text>
        <Text className="text-sm text-muted-foreground">
          {formatLean(variant.sourceLean)}
          {variant.value ? ` · ${variant.value}` : ""}
        </Text>
      </View>
      <Text className="max-w-[455px] text-base leading-relaxed text-muted-foreground">
        {variant.statement}
      </Text>
      {article ? (
        <Pressable
          accessibilityRole="link"
          accessibilityLabel={t("claim.readSourceArticle")}
          onPress={() =>
            WebBrowser.openBrowserAsync(article.canonicalUrl).catch(() => {
              // Browser unavailable — nothing to recover here.
            })
          }
          hitSlop={8}
          className="min-h-9 flex-row items-center gap-1 self-start active:opacity-70"
        >
          <Text className="text-base font-medium text-primary">
            {t("claim.readSourceArticle")}
          </Text>
          <Icon name="open-outline" size={12} className="text-primary" />
        </Pressable>
      ) : null}
    </View>
  );
}

function ClaimRow({
  claim,
  articlesById,
  sourcesById,
  isLast,
}: {
  claim: EventClaim;
  articlesById: Map<string, EventArticle>;
  sourcesById: Map<string, EventSource>;
  isLast: boolean;
}) {
  const t = useT();
  const [isExpanded, setIsExpanded] = useState(false);
  const sourceCount = new Set(
    claim.variants.map((variant) => String(variant.sourceId)),
  ).size;

  const disclosureLabel =
    sourceCount === 1
      ? t("native.event.claimVariants.one")
      : t("native.event.claimVariants.many").replace(
          "{count}",
          String(sourceCount),
        );

  return (
    <View className={cn("gap-2 py-4", !isLast && "border-b border-border/70")}>
      <View className="flex-row gap-3">
        {/* Status tick — token-colored, 3px, the only mark on the row. */}
        <View
          className={cn(
            "mt-1.5 h-4 w-[3px] rounded-full",
            STATUS_MARK[claim.status],
          )}
        />
        <View className="min-w-0 flex-1 gap-1.5">
          <Text className="max-w-[455px] text-base font-medium leading-snug text-foreground">
            {claim.canonicalStatement}
          </Text>
          <Text className="text-sm text-muted-foreground">
            {t(STATUS_LABEL_KEY[claim.status])}
            {" · "}
            {sourceCount === 1
              ? t("claim.source.one")
              : t("claim.source.many").replace(
                  "{count}",
                  String(sourceCount),
                )}
          </Text>
        </View>
      </View>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={disclosureLabel}
        accessibilityState={{ expanded: isExpanded }}
        onPress={() => setIsExpanded((value) => !value)}
        hitSlop={6}
        className="ml-[15px] min-h-9 flex-row items-center gap-1 self-start active:opacity-70"
      >
        <Text className="text-base font-medium text-muted-foreground">
          {disclosureLabel}
        </Text>
        <Icon
          name={isExpanded ? "chevron-up" : "chevron-down"}
          size={13}
          className="text-muted-foreground"
        />
      </Pressable>

      {isExpanded ? (
        <Animated.View
          entering={FadeIn.duration(150)}
          className="ml-[15px] border-l border-border pl-4"
        >
          {claim.variants.map((variant, index) => (
            <View
              key={`${variant.articleId}-${variant.sourceFactIndex ?? index}-${index}`}
              className={cn(index > 0 && "border-t border-border/60")}
            >
              <ClaimVariantRow
                variant={variant}
                articlesById={articlesById}
                sourcesById={sourcesById}
              />
            </View>
          ))}
        </Animated.View>
      ) : null}
    </View>
  );
}

export function EventClaimComparison({
  eventId,
  articles,
}: {
  eventId: Id<"events">;
  articles: EventArticle[];
}) {
  const t = useT();

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

  // Claim analysis feature-flagged off (BIV-602) — hide the section entirely.
  if (claims === null) {
    return null;
  }

  if (claims === undefined) {
    return (
      <View className="gap-4">
        <Text className="text-sm font-semibold uppercase tracking-[1.2px] text-muted-foreground">
          {t("native.event.claimsTitle")}
        </Text>
        <Text
          accessibilityLiveRegion="polite"
          className="text-base text-muted-foreground"
        >
          {t("claim.loading")}
        </Text>
      </View>
    );
  }

  if (claims.length === 0) {
    return (
      <View className="gap-4">
        <Text className="text-sm font-semibold uppercase tracking-[1.2px] text-muted-foreground">
          {t("native.event.claimsTitle")}
        </Text>
        <Text className="max-w-[455px] text-base leading-relaxed text-muted-foreground">
          {t("claim.unavailableBody")}
        </Text>
      </View>
    );
  }

  const claimsByStatus = new Map<ClaimStatus, EventClaim[]>();
  for (const claim of claims) {
    claimsByStatus.set(claim.status, [
      ...(claimsByStatus.get(claim.status) ?? []),
      claim,
    ]);
  }
  const visibleStatuses = STATUS_ORDER.filter(
    (status) => (claimsByStatus.get(status)?.length ?? 0) > 0,
  );

  return (
    <View className="gap-2">
      <Text className="text-2xl font-semibold tracking-tight text-foreground">
        {t("native.event.claimsTitle")}
      </Text>
      <Text className="max-w-[455px] text-base text-muted-foreground">
        {t("claim.subtitle")}
      </Text>

      <View className="gap-7 pt-3">
        {visibleStatuses.map((status) => {
          const statusClaims = claimsByStatus.get(status) ?? [];
          return (
            <View key={status}>
              <View className="flex-row items-center gap-2 pb-1">
                <View
                  className={cn(
                    "h-3.5 w-[3px] rounded-full",
                    STATUS_MARK[status],
                  )}
                />
                {/* Subheading level: 15 medium, sentence case — sits below
                    the uppercase zone label without competing with it. */}
                <Text className="text-sm font-medium text-foreground">
                  {t(STATUS_HEADING_KEY[status])}
                </Text>
              </View>
              <Text className="max-w-[455px] pb-1 text-base text-muted-foreground">
                {t(STATUS_BODY_KEY[status])}
              </Text>
              <View>
                {statusClaims.map((claim, index) => (
                  <ClaimRow
                    key={claim._id}
                    claim={claim}
                    articlesById={articlesById}
                    sourcesById={sourcesById}
                    isLast={index === statusClaims.length - 1}
                  />
                ))}
              </View>
            </View>
          );
        })}
      </View>
    </View>
  );
}
