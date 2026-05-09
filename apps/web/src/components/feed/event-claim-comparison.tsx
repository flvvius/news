import { api } from "@news-app/backend/convex/_generated/api";
import type { Doc, Id } from "@news-app/backend/convex/_generated/dataModel";
import { Link } from "@tanstack/react-router";
import { useQuery } from "convex/react";
import {
  AlertTriangleIcon,
  CheckCircle2Icon,
  ExternalLinkIcon,
  MessageSquareTextIcon,
  MinusCircleIcon,
  ChevronDownIcon,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useT } from "@/lib/i18n/LocaleContext";
import { cn } from "@/lib/utils";
import { useState } from "react";

type ClaimStatus = Doc<"eventClaims">["status"];
type ClaimVariant = Doc<"eventClaims">["variants"][number];

type ClaimArticle = {
  _id: Id<"articles">;
  title: string;
  canonicalUrl: string;
  source: {
    _id: Id<"sources">;
    name: string;
    logoUrl?: string;
    baseBias: number;
    mbfcCategory?: string;
  } | null;
};

const STATUS_ORDER: ClaimStatus[] = [
  "divergence",
  "framing",
  "agreement",
  "exclusive_left",
  "exclusive_right",
  "exclusive_center",
];

const STATUS_ICONS: Record<ClaimStatus, typeof AlertTriangleIcon> = {
  agreement: CheckCircle2Icon,
  divergence: AlertTriangleIcon,
  framing: MessageSquareTextIcon,
  exclusive_left: MinusCircleIcon,
  exclusive_right: MinusCircleIcon,
  exclusive_center: MinusCircleIcon,
};

function formatLean(value: string) {
  return value
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("-");
}

function getVariantSource(
  variant: ClaimVariant,
  articlesById: Map<string, ClaimArticle>,
  sourcesById: Map<string, NonNullable<ClaimArticle["source"]>>,
) {
  return (
    articlesById.get(String(variant.articleId))?.source ??
    sourcesById.get(String(variant.sourceId)) ??
    null
  );
}

function ClaimVariantRow({
  variant,
  articlesById,
  sourcesById,
}: {
  variant: ClaimVariant;
  articlesById: Map<string, ClaimArticle>;
  sourcesById: Map<string, NonNullable<ClaimArticle["source"]>>;
}) {
  const t = useT();
  const article = articlesById.get(String(variant.articleId));
  const source = getVariantSource(variant, articlesById, sourcesById);

  return (
    <div className="group relative border-l-2 border-border pl-4 py-3 transition-colors hover:border-primary/50">
      <div className="flex items-start gap-3">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full border border-border bg-card">
          {source?.logoUrl ? (
            <img
              src={source.logoUrl}
              alt={source.name}
              className="h-full w-full object-contain p-1.5"
              loading="lazy"
            />
          ) : (
            <span className="text-xs font-semibold text-muted-foreground">
              {(source?.name ?? "S").charAt(0)}
            </span>
          )}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2 mb-1.5">
            {source ? (
              <Link
                to="/source/$sourceId"
                params={{ sourceId: source._id }}
                className="text-sm font-semibold text-card-foreground hover:text-primary transition-colors"
              >
                {source.name}
              </Link>
            ) : (
              <span className="text-sm font-semibold text-muted-foreground">
                {t("claim.unknownSource")}
              </span>
            )}
            <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
              {formatLean(variant.sourceLean)}
            </span>
            {variant.value && (
              <span className="rounded-full border border-border px-2 py-0.5 text-[11px] font-medium text-foreground">
                {variant.value}
              </span>
            )}
          </div>

          <p className="text-sm leading-relaxed text-card-foreground max-w-[65ch]">
            {variant.statement}
          </p>

          {article && (
            <a
              href={article.canonicalUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2 inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline"
            >
              {t("claim.readSourceArticle")}
              <ExternalLinkIcon className="size-3" />
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

function ClaimCard({
  claim,
  articlesById,
  sourcesById,
  status,
}: {
  claim: Doc<"eventClaims">;
  articlesById: Map<string, ClaimArticle>;
  sourcesById: Map<string, NonNullable<ClaimArticle["source"]>>;
  status: ClaimStatus;
}) {
  const t = useT();
  const [isExpanded, setIsExpanded] = useState(false);
  const Icon = STATUS_ICONS[status];
  const sourceCount = new Set(
    claim.variants.map((variant) => String(variant.sourceId)),
  ).size;

  const showExpandButton = claim.variants.length > 2;
  const remainingVariantCount = claim.variants.length - 2;
  const visibleVariants = isExpanded
    ? claim.variants
    : claim.variants.slice(0, 2);

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <div className="px-4 py-4 sm:px-5">
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">
              <Icon className="size-3.5" />
              {status === "agreement"
                ? t("claim.agreement")
                : status === "divergence"
                  ? t("claim.divergence")
                  : status === "framing"
                    ? t("claim.framing")
                    : status === "exclusive_left"
                      ? t("claim.leftExclusive")
                      : status === "exclusive_right"
                        ? t("claim.rightExclusive")
                        : t("claim.centerExclusive")}
            </span>
            <span className="text-xs text-muted-foreground">
              {claim.importance}/5 {t("claim.importance")}
            </span>
          </div>
          <span className="shrink-0 text-xs text-muted-foreground">
            {sourceCount === 1
              ? t("claim.source.one")
              : t("claim.source.many").replace("{count}", String(sourceCount))}
          </span>
        </div>

        <h4 className="text-base font-semibold leading-snug tracking-tight text-card-foreground max-w-[65ch]">
          {claim.canonicalStatement}
        </h4>
      </div>

      <div className="border-t border-border bg-muted/30 px-4 py-3 sm:px-5">
        <div className="space-y-0 divide-y divide-border/50">
          {visibleVariants.map((variant, index) => (
            <ClaimVariantRow
              key={`${variant.articleId}-${variant.sourceFactIndex ?? index}-${index}`}
              variant={variant}
              articlesById={articlesById}
              sourcesById={sourcesById}
            />
          ))}
        </div>

        {showExpandButton && (
          <button
            type="button"
            aria-expanded={isExpanded}
            onClick={() => setIsExpanded(!isExpanded)}
            className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-lg border border-border bg-card py-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            {isExpanded
              ? t("claim.showLess")
              : remainingVariantCount === 1
                ? t("claim.showMore.one")
                : t("claim.showMore.many").replace(
                    "{count}",
                    String(remainingVariantCount),
                  )}
            <ChevronDownIcon
              className={cn(
                "size-3.5 transition-transform",
                isExpanded && "rotate-180",
              )}
            />
          </button>
        )}
      </div>
    </div>
  );
}

function StatCard({
  label,
  count,
  isActive,
  onClick,
}: {
  label: string;
  count: number;
  isActive: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={isActive}
      onClick={onClick}
      className={cn(
        "flex flex-col items-center justify-center rounded-xl border px-4 py-3 transition-all text-center",
        isActive
          ? "border-primary bg-primary/5 ring-1 ring-primary/20"
          : "border-border bg-card hover:border-primary/30 hover:bg-accent",
      )}
    >
      <span className="text-2xl font-bold text-card-foreground tabular-nums">
        {count}
      </span>
      <span className="text-xs font-medium text-muted-foreground mt-0.5">
        {label}
      </span>
    </button>
  );
}

export default function EventClaimComparison({
  eventId,
  articles,
}: {
  eventId: Id<"events">;
  articles: ClaimArticle[];
}) {
  const t = useT();
  const [activeFilter, setActiveFilter] = useState<string | null>(null);

  const claims = useQuery(api.claimDivergence.getEventClaims, {
    eventId,
    limit: 24,
  });

  const articlesById = new Map(
    articles.map((article) => [String(article._id), article]),
  );
  const sourcesById = new Map(
    articles
      .map((article) => article.source)
      .filter((source): source is NonNullable<typeof source> => Boolean(source))
      .map((source) => [String(source._id), source]),
  );

  if (claims === undefined) {
    return (
      <Card className="overflow-hidden border-border py-0">
        <CardHeader className="border-b border-border bg-muted/30 py-5">
          <CardTitle className="text-xl tracking-tight">
            {t("claim.title")}
          </CardTitle>
        </CardHeader>
        <CardContent className="px-4 py-6 sm:px-6">
          <div className="flex items-center gap-3">
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            <span className="text-sm text-muted-foreground">
              {t("claim.loading")}
            </span>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (claims.length === 0) {
    return (
      <Card className="overflow-hidden border-border py-0">
        <CardHeader className="border-b border-border bg-muted/30 py-5">
          <CardTitle className="text-xl tracking-tight">
            {t("claim.title")}
          </CardTitle>
        </CardHeader>
        <CardContent className="px-4 py-6 sm:px-6">
          <div className="rounded-xl border border-dashed border-border bg-muted/20 px-4 py-8 text-center">
            <p className="text-sm font-medium text-card-foreground">
              {t("claim.unavailable")}
            </p>
            <p className="mt-1.5 text-sm text-muted-foreground max-w-[55ch] mx-auto">
              {t("claim.unavailableBody")}
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  const claimsByStatus = new Map<ClaimStatus, Doc<"eventClaims">[]>();
  for (const claim of claims) {
    claimsByStatus.set(claim.status, [
      ...(claimsByStatus.get(claim.status) ?? []),
      claim,
    ]);
  }

  const summaryCounts = {
    agreements: claimsByStatus.get("agreement")?.length ?? 0,
    divergences: claimsByStatus.get("divergence")?.length ?? 0,
    framing: claimsByStatus.get("framing")?.length ?? 0,
    exclusives:
      (claimsByStatus.get("exclusive_left")?.length ?? 0) +
      (claimsByStatus.get("exclusive_right")?.length ?? 0) +
      (claimsByStatus.get("exclusive_center")?.length ?? 0),
  };

  const getFilteredStatuses = () => {
    if (!activeFilter) return STATUS_ORDER;

    switch (activeFilter) {
      case "agreements":
        return ["agreement"] as ClaimStatus[];
      case "divergences":
        return ["divergence"] as ClaimStatus[];
      case "framing":
        return ["framing"] as ClaimStatus[];
      case "exclusives":
        return [
          "exclusive_left",
          "exclusive_right",
          "exclusive_center",
        ] as ClaimStatus[];
      default:
        return STATUS_ORDER;
    }
  };

  const filteredStatuses = getFilteredStatuses();
  const visibleStatuses = filteredStatuses.filter(
    (status) => (claimsByStatus.get(status)?.length ?? 0) > 0,
  );

  const toggleFilter = (filter: string) => {
    setActiveFilter(activeFilter === filter ? null : filter);
  };

  return (
    <Card className="overflow-hidden border-border py-0">
      <CardHeader className="border-b border-border bg-muted/30 py-5">
        <div className="flex flex-col gap-1">
          <CardTitle className="text-xl tracking-tight">
            {t("claim.title")}
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            {t("claim.subtitle")}
          </p>
        </div>
      </CardHeader>

      <CardContent className="p-0">
        {/* Stats Grid - Clickable Filters */}
        <div className="border-b border-border bg-card px-4 py-4 sm:px-6">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3">
            <StatCard
              label={t("claim.agreements")}
              count={summaryCounts.agreements}
              isActive={activeFilter === "agreements"}
              onClick={() => toggleFilter("agreements")}
            />
            <StatCard
              label={t("claim.divergences")}
              count={summaryCounts.divergences}
              isActive={activeFilter === "divergences"}
              onClick={() => toggleFilter("divergences")}
            />
            <StatCard
              label={t("claim.framings")}
              count={summaryCounts.framing}
              isActive={activeFilter === "framing"}
              onClick={() => toggleFilter("framing")}
            />
            <StatCard
              label={t("claim.centerExclusives")}
              count={summaryCounts.exclusives}
              isActive={activeFilter === "exclusives"}
              onClick={() => toggleFilter("exclusives")}
            />
          </div>

          {activeFilter && (
            <button
              type="button"
              onClick={() => setActiveFilter(null)}
              className="mt-3 text-xs font-medium text-primary hover:underline"
            >
              {t("claim.clearFilter")}
            </button>
          )}
        </div>

        {/* Claims List */}
        <div className="px-4 py-5 sm:px-6">
          <div className="space-y-8">
            {visibleStatuses.map((status) => {
              const statusClaims = claimsByStatus.get(status) ?? [];
              return (
                <section key={status} className="space-y-4">
                  <div className="border-l-2 border-primary pl-3">
                    <h3 className="text-base font-semibold tracking-tight text-card-foreground">
                      {status === "agreement"
                        ? t("claim.agreements")
                        : status === "divergence"
                          ? t("claim.divergences")
                          : status === "framing"
                            ? t("claim.framings")
                            : status === "exclusive_left"
                              ? t("claim.leftExclusives")
                              : status === "exclusive_right"
                                ? t("claim.rightExclusives")
                                : t("claim.centerExclusives")}
                    </h3>
                    <p className="text-sm text-muted-foreground max-w-[55ch]">
                      {status === "agreement"
                        ? t("claim.agreementBody")
                        : status === "divergence"
                          ? t("claim.divergenceBody")
                          : status === "framing"
                            ? t("claim.framingBody")
                            : status === "exclusive_left"
                              ? t("claim.leftExclusiveBody")
                              : status === "exclusive_right"
                                ? t("claim.rightExclusiveBody")
                                : t("claim.centerExclusiveBody")}
                    </p>
                  </div>
                  <div className="grid gap-4">
                    {statusClaims.map((claim) => (
                      <ClaimCard
                        key={claim._id}
                        claim={claim}
                        articlesById={articlesById}
                        sourcesById={sourcesById}
                        status={status}
                      />
                    ))}
                  </div>
                </section>
              );
            })}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
