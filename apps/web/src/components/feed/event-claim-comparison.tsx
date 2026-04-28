import { api } from "@news-app/backend/convex/_generated/api";
import type {
  Doc,
  Id,
} from "@news-app/backend/convex/_generated/dataModel";
import { Link } from "@tanstack/react-router";
import { useQuery } from "convex/react";
import {
  AlertTriangleIcon,
  CheckCircle2Icon,
  ExternalLinkIcon,
  MessageSquareTextIcon,
  MinusCircleIcon,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

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

const STATUS_COPY: Record<
  ClaimStatus,
  {
    label: string;
    heading: string;
    description: string;
    icon: typeof AlertTriangleIcon;
    className: string;
    chipClassName: string;
  }
> = {
  agreement: {
    label: "Agreement",
    heading: "Agreements",
    description: "Claims confirmed by multiple sources.",
    icon: CheckCircle2Icon,
    className: "border-emerald-500/25 bg-emerald-50/60",
    chipClassName: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700",
  },
  divergence: {
    label: "Divergence",
    heading: "Divergences",
    description: "Claims where sources report materially different details.",
    icon: AlertTriangleIcon,
    className: "border-amber-500/30 bg-amber-50/70",
    chipClassName: "border-amber-500/35 bg-amber-500/10 text-amber-800",
  },
  framing: {
    label: "Framing",
    heading: "Framing Differences",
    description: "Shared facts described with meaningfully different language.",
    icon: MessageSquareTextIcon,
    className: "border-sky-500/25 bg-sky-50/60",
    chipClassName: "border-sky-500/30 bg-sky-500/10 text-sky-800",
  },
  exclusive_left: {
    label: "Left Exclusive",
    heading: "Left-Side Exclusives",
    description: "Substantive claims only found in left or left-center coverage.",
    icon: MinusCircleIcon,
    className: "border-border/80 bg-muted/35",
    chipClassName: "border-border/80 bg-muted text-muted-foreground",
  },
  exclusive_right: {
    label: "Right Exclusive",
    heading: "Right-Side Exclusives",
    description:
      "Substantive claims only found in right or right-center coverage.",
    icon: MinusCircleIcon,
    className: "border-border/80 bg-muted/35",
    chipClassName: "border-border/80 bg-muted text-muted-foreground",
  },
  exclusive_center: {
    label: "Center Exclusive",
    heading: "Center Exclusives",
    description: "Substantive claims only found in center coverage.",
    icon: MinusCircleIcon,
    className: "border-border/80 bg-muted/35",
    chipClassName: "border-border/80 bg-muted text-muted-foreground",
  },
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
  const article = articlesById.get(String(variant.articleId));
  const source = getVariantSource(variant, articlesById, sourcesById);

  return (
    <div className="rounded-lg border border-border/70 bg-background/70 px-3 py-3">
      <div className="mb-2 flex min-w-0 flex-wrap items-center gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-full border border-border/80 bg-background">
            {source?.logoUrl ? (
              <img
                src={source.logoUrl}
                alt={source.name}
                className="h-full w-full object-contain p-1"
                loading="lazy"
              />
            ) : (
              <span className="text-[11px] font-medium text-foreground">
                {(source?.name ?? "S").charAt(0)}
              </span>
            )}
          </div>
          {source ? (
            <Link
              to="/source/$sourceId"
              params={{ sourceId: source._id }}
              className="truncate text-sm font-medium text-card-foreground hover:underline"
            >
              {source.name}
            </Link>
          ) : (
            <span className="truncate text-sm font-medium text-card-foreground">
              Unknown source
            </span>
          )}
        </div>
        <span className="rounded-full border border-border/70 px-2 py-0.5 text-[11px] text-muted-foreground">
          {formatLean(variant.sourceLean)}
        </span>
        {variant.value && (
          <span className="rounded-full border border-border/70 bg-muted/50 px-2 py-0.5 text-[11px] text-foreground">
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
          className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
        >
          Read source article
          <ExternalLinkIcon className="size-3" />
        </a>
      )}
    </div>
  );
}

function ClaimCard({
  claim,
  articlesById,
  sourcesById,
}: {
  claim: Doc<"eventClaims">;
  articlesById: Map<string, ClaimArticle>;
  sourcesById: Map<string, NonNullable<ClaimArticle["source"]>>;
}) {
  const status = STATUS_COPY[claim.status];
  const Icon = status.icon;
  const sourceCount = new Set(
    claim.variants.map((variant) => String(variant.sourceId)),
  ).size;

  return (
    <div className={cn("rounded-xl border px-4 py-4", status.className)}>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span
          className={cn(
            "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium",
            status.chipClassName,
          )}
        >
          <Icon className="size-3.5" />
          {status.label}
        </span>
        <span className="rounded-full border border-border/70 bg-background/65 px-2.5 py-1 text-xs text-muted-foreground">
          Importance {claim.importance}/5
        </span>
        <span className="rounded-full border border-border/70 bg-background/65 px-2.5 py-1 text-xs text-muted-foreground">
          {sourceCount} {sourceCount === 1 ? "source" : "sources"}
        </span>
      </div>

      <h4 className="text-base font-semibold leading-snug tracking-tight text-card-foreground">
        {claim.canonicalStatement}
      </h4>

      <div className="mt-4 grid gap-3">
        {claim.variants.map((variant, index) => (
          <ClaimVariantRow
            key={`${variant.articleId}-${variant.sourceFactIndex ?? index}-${index}`}
            variant={variant}
            articlesById={articlesById}
            sourcesById={sourcesById}
          />
        ))}
      </div>
    </div>
  );
}

export default function EventClaimComparison({
  eventId,
  articles,
}: {
  eventId: Id<"events">;
  articles: ClaimArticle[];
}) {
  const claims = useQuery(api.claimDivergence.getEventClaims, {
    eventId,
    limit: 24,
  });

  const articlesById = new Map(articles.map((article) => [String(article._id), article]));
  const sourcesById = new Map(
    articles
      .map((article) => article.source)
      .filter((source): source is NonNullable<typeof source> => Boolean(source))
      .map((source) => [String(source._id), source]),
  );

  if (claims === undefined) {
    return (
      <Card className="overflow-hidden border-border/80 py-0">
        <CardHeader className="border-b border-border/70 bg-muted/30 py-5">
          <CardTitle className="text-xl tracking-tight">
            Claim Breakdown
          </CardTitle>
        </CardHeader>
        <CardContent className="px-6 py-6 sm:px-8">
          <div
            role="status"
            aria-live="polite"
            className="text-sm text-muted-foreground"
          >
            Loading claim analysis...
          </div>
        </CardContent>
      </Card>
    );
  }

  if (claims.length === 0) {
    return (
      <Card className="overflow-hidden border-border/80 py-0">
        <CardHeader className="border-b border-border/70 bg-muted/30 py-5">
          <CardTitle className="text-xl tracking-tight">
            Claim Breakdown
          </CardTitle>
        </CardHeader>
        <CardContent className="px-6 py-6 sm:px-8">
          <div className="rounded-xl border border-border/70 bg-background/65 px-4 py-5">
            <p className="text-sm font-medium text-card-foreground">
              Claim analysis is not available yet.
            </p>
            <p className="mt-1 max-w-[60ch] text-sm text-muted-foreground">
              This view appears once enough articles have atomic facts and the
              event-level claim worker has analyzed agreements, divergences, and
              exclusives.
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
  const visibleStatuses = STATUS_ORDER.filter(
    (status) => (claimsByStatus.get(status)?.length ?? 0) > 0,
  );
  const summaryCounts = {
    agreements: claimsByStatus.get("agreement")?.length ?? 0,
    divergences: claimsByStatus.get("divergence")?.length ?? 0,
    framing: claimsByStatus.get("framing")?.length ?? 0,
    exclusives:
      (claimsByStatus.get("exclusive_left")?.length ?? 0) +
      (claimsByStatus.get("exclusive_right")?.length ?? 0) +
      (claimsByStatus.get("exclusive_center")?.length ?? 0),
  };

  return (
    <Card className="overflow-hidden border-border/80 py-0">
      <CardHeader className="border-b border-border/70 bg-muted/30 py-5">
        <CardTitle className="text-xl tracking-tight">
          Claim Breakdown
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6 px-6 py-6 sm:px-8">
        <div className="grid gap-3 sm:grid-cols-4">
          <div className="rounded-lg border border-emerald-500/25 bg-emerald-50/50 px-3 py-3">
            <p className="text-xs text-muted-foreground">Agreements</p>
            <p className="text-xl font-semibold text-card-foreground">
              {summaryCounts.agreements}
            </p>
          </div>
          <div className="rounded-lg border border-amber-500/30 bg-amber-50/60 px-3 py-3">
            <p className="text-xs text-muted-foreground">Divergences</p>
            <p className="text-xl font-semibold text-card-foreground">
              {summaryCounts.divergences}
            </p>
          </div>
          <div className="rounded-lg border border-sky-500/25 bg-sky-50/50 px-3 py-3">
            <p className="text-xs text-muted-foreground">Framing</p>
            <p className="text-xl font-semibold text-card-foreground">
              {summaryCounts.framing}
            </p>
          </div>
          <div className="rounded-lg border border-border/70 bg-background/65 px-3 py-3">
            <p className="text-xs text-muted-foreground">Exclusives</p>
            <p className="text-xl font-semibold text-card-foreground">
              {summaryCounts.exclusives}
            </p>
          </div>
        </div>

        <div className="space-y-6">
          {visibleStatuses.map((status) => {
            const statusClaims = claimsByStatus.get(status) ?? [];
            const copy = STATUS_COPY[status];
            return (
              <section key={status} className="space-y-3">
                <div>
                  <h3 className="text-base font-semibold tracking-tight text-card-foreground">
                    {copy.heading}
                  </h3>
                  <p className="text-sm text-muted-foreground">
                    {copy.description}
                  </p>
                </div>
                <div className="grid gap-4">
                  {statusClaims.map((claim) => (
                    <ClaimCard
                      key={claim._id}
                      claim={claim}
                      articlesById={articlesById}
                      sourcesById={sourcesById}
                    />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
