import type { Id } from "@news-app/backend/convex/_generated/dataModel";
import { Link } from "@tanstack/react-router";
import BiasIndicator from "@/components/bias-indicator";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useT } from "@/lib/i18n/LocaleContext";

type SourceCoverageArticle = {
  _id: Id<"articles">;
  source: {
    _id: Id<"sources">;
    name: string;
    logoUrl?: string;
    baseBias: number;
    reliabilityScore: number;
    mbfcCategory?: string;
    mbfcFactual?: string;
    mbfcCredibility?: string;
  } | null;
};

type CoverageBucket = "left" | "center" | "right" | "unknown";

function getCoverageBucket(
  source: NonNullable<SourceCoverageArticle["source"]>,
): CoverageBucket {
  const category = source.mbfcCategory?.toLowerCase();
  if (category === "left" || category === "left-center") return "left";
  if (category === "right" || category === "right-center") return "right";
  if (category === "center") return "center";
  if (source.baseBias < 0) return "left";
  if (source.baseBias > 0) return "right";
  return "center";
}

function getCoverageLabel(bucket: CoverageBucket) {
  if (bucket === "left") return "coverage.left";
  if (bucket === "right") return "coverage.right";
  if (bucket === "center") return "coverage.center";
  return "coverage.unknown";
}

function bucketClass(bucket: CoverageBucket) {
  if (bucket === "left") return "bg-bias-left-muted";
  if (bucket === "right") return "bg-bias-right-muted";
  if (bucket === "center") return "bg-bias-center";
  return "bg-muted-foreground/30";
}

export default function SourceCoverageSummary({
  articles,
}: {
  articles: SourceCoverageArticle[];
}) {
  const t = useT();
  const sources = Array.from(
    new Map(
      articles
        .map((article) => article.source)
        .filter((source): source is NonNullable<typeof source> => Boolean(source))
        .map((source) => [source._id, source]),
    ).values(),
  );

  const counts: Record<CoverageBucket, number> = {
    left: 0,
    center: 0,
    right: 0,
    unknown: 0,
  };
  for (const source of sources) {
    counts[getCoverageBucket(source)]++;
  }

  const total = Math.max(1, sources.length);
  const buckets: CoverageBucket[] = ["left", "center", "right", "unknown"];

  return (
    <Card className="overflow-hidden border-border/80 py-0">
      <CardHeader className="border-b border-border/70 bg-muted/30 py-5">
        <CardTitle className="text-xl tracking-tight">
          {t("coverage.title")}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5 px-6 py-6 sm:px-8">
        <div className="space-y-3">
          <div className="flex h-2 overflow-hidden rounded-full bg-muted">
            {buckets.map((bucket) => {
              const count = counts[bucket];
              if (count === 0) return null;
              return (
                <div
                  key={bucket}
                  className={bucketClass(bucket)}
                  style={{ width: `${(count / total) * 100}%` }}
                  title={`${t(getCoverageLabel(bucket))}: ${count}`}
                />
              );
            })}
          </div>

          <div className="grid gap-2 sm:grid-cols-3">
            {(["left", "center", "right"] as CoverageBucket[]).map(
              (bucket) => (
                <div
                  key={bucket}
                  className="rounded-lg border border-border/70 bg-background/55 px-3 py-2"
                >
                  <p className="text-xs text-muted-foreground">
                    {t(getCoverageLabel(bucket))}
                  </p>
                  <p className="text-lg font-semibold text-card-foreground">
                    {counts[bucket]}
                  </p>
                </div>
              ),
            )}
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          {sources.map((source) => (
            <Link
              key={source._id}
              to="/source/$sourceId"
              params={{ sourceId: source._id }}
              className="flex min-w-0 items-center gap-3 rounded-lg border border-border/70 bg-background/55 px-3 py-3"
            >
              <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full border border-border/80 bg-background">
                {source.logoUrl ? (
                  <img
                    src={source.logoUrl}
                    alt={source.name}
                    className="h-full w-full object-contain p-1.5"
                    loading="lazy"
                  />
                ) : (
                  <span className="text-xs font-medium text-foreground">
                    {source.name.charAt(0)}
                  </span>
                )}
              </div>
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex min-w-0 items-center justify-between gap-2">
                  <p className="truncate text-sm font-medium text-card-foreground">
                    {source.name}
                  </p>
                  <span className="shrink-0 rounded-full border border-border/70 px-2 py-0.5 text-[11px] text-muted-foreground">
                    {source.reliabilityScore}/10
                  </span>
                </div>
                <BiasIndicator bias={source.baseBias} size="sm" />
                {(source.mbfcFactual || source.mbfcCredibility) && (
                  <p className="truncate text-xs text-muted-foreground">
                      {[
                        source.mbfcFactual
                        ? `${t("coverage.factual")}: ${source.mbfcFactual}`
                        : null,
                      source.mbfcCredibility
                        ? `${t("coverage.credibility")}: ${source.mbfcCredibility}`
                        : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                )}
              </div>
            </Link>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
