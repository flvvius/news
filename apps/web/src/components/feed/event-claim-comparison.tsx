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
import { SectionTitle } from "@/components/ui/section-title";
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

function getStatusLabel(t: ReturnType<typeof useT>, status: ClaimStatus) {
  switch (status) {
    case "agreement":
      return t("claim.agreement");
    case "divergence":
      return t("claim.divergence");
    case "framing":
      return t("claim.framing");
    case "exclusive_left":
      return t("claim.leftExclusive");
    case "exclusive_right":
      return t("claim.rightExclusive");
    case "exclusive_center":
      return t("claim.centerExclusive");
  }
}

function getStatusHeading(t: ReturnType<typeof useT>, status: ClaimStatus) {
  switch (status) {
    case "agreement":
      return t("claim.agreements");
    case "divergence":
      return t("claim.divergences");
    case "framing":
      return t("claim.framings");
    case "exclusive_left":
      return t("claim.leftExclusives");
    case "exclusive_right":
      return t("claim.rightExclusives");
    case "exclusive_center":
      return t("claim.centerExclusives");
  }
}

function getStatusBody(t: ReturnType<typeof useT>, status: ClaimStatus) {
  switch (status) {
    case "agreement":
      return t("claim.agreementBody");
    case "divergence":
      return t("claim.divergenceBody");
    case "framing":
      return t("claim.framingBody");
    case "exclusive_left":
      return t("claim.leftExclusiveBody");
    case "exclusive_right":
      return t("claim.rightExclusiveBody");
    case "exclusive_center":
      return t("claim.centerExclusiveBody");
  }
}

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

          <p className="text-sm leading-relaxed text-card-foreground">
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
    <div className="py-4">
      <div>
        {/* Status + weight as one meta line; the chip-and-panel treatment made
            every claim look like a separate widget. */}
        <div className="mb-2 flex items-start justify-between gap-3 text-xs text-muted-foreground">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="inline-flex items-center gap-1.5 font-medium text-foreground">
              <Icon className="size-3.5" />
              {getStatusLabel(t, status)}
            </span>
            <span aria-hidden="true">·</span>
            <span>
              {claim.importance}/5 {t("claim.importance")}
            </span>
          </span>
          <span className="shrink-0">
            {sourceCount === 1
              ? t("claim.source.one")
              : t("claim.source.many").replace("{count}", String(sourceCount))}
          </span>
        </div>

        <h4 className="text-base font-semibold leading-snug tracking-tight text-foreground">
          {claim.canonicalStatement}
        </h4>
      </div>

      <div className="mt-3 border-l-2 border-border pl-4">
        <div className="space-y-0 divide-y divide-border">
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
            className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
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
      className="group text-left"
    >
      <span
        className={cn(
          "block text-2xl font-semibold tabular-nums transition-colors",
          isActive ? "text-primary" : "text-foreground",
        )}
      >
        {count}
      </span>
      <span
        className={cn(
          "mt-0.5 block border-b-2 pb-0.5 text-xs font-medium transition-colors",
          isActive
            ? "border-primary text-primary"
            : "border-transparent text-muted-foreground group-hover:text-foreground",
        )}
      >
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

  // Claim analysis feature-flagged off (BIV-602) — hide the section entirely.
  if (claims === null) {
    return null;
  }

  if (claims === undefined) {
    return (
      <section>
        <SectionTitle>{t("claim.title")}</SectionTitle>
        <p
          className="mt-4 text-sm text-muted-foreground"
          role="status"
          aria-live="polite"
          aria-atomic="true"
        >
          {t("claim.loading")}
        </p>
      </section>
    );
  }

  if (claims.length === 0) {
    return (
      <section>
        <SectionTitle>{t("claim.title")}</SectionTitle>
        {/* Typographic empty state — the dashed box is gone. */}
        <p className="mt-4 text-sm font-medium text-foreground">
          {t("claim.unavailable")}
        </p>
        <p className="mt-1 max-w-[55ch] text-sm text-muted-foreground">
          {t("claim.unavailableBody")}
        </p>
      </section>
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
    <section>
      <SectionTitle>{t("claim.title")}</SectionTitle>
      <p className="mt-1 max-w-[55ch] text-sm text-muted-foreground">
        {t("claim.subtitle")}
      </p>

      <div>
        {/* Counts double as filters, so they keep an interactive affordance —
            but as a hairline-separated row of figures, not four tiles. */}
        <div className="mt-6 border-y border-border py-4">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
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
        <div className="pt-8">
          <div className="space-y-10">
            {visibleStatuses.map((status) => {
              const statusClaims = claimsByStatus.get(status) ?? [];
              return (
                <section key={status} className="space-y-4">
                  <div>
                    <h3 className="text-base font-semibold tracking-tight text-foreground">
                      {getStatusHeading(t, status)}
                    </h3>
                    <p className="max-w-[55ch] text-sm text-muted-foreground">
                      {getStatusBody(t, status)}
                    </p>
                  </div>
                  <div className="divide-y divide-border border-t border-border">
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
      </div>
    </section>
  );
}
