import type { Id } from "@news-app/backend/convex/_generated/dataModel";
import { Link } from "@tanstack/react-router";
import { useConvexAuth, useQuery } from "convex/react";
import { api } from "@news-app/backend/convex/_generated/api";
import { useMutation } from "@tanstack/react-query";
import { useConvexMutation } from "@convex-dev/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import BiasIndicator from "@/components/bias-indicator";
import { getClientDeviceType } from "@/lib/interaction-tracking";

type Article = {
  _id: Id<"articles">;
  title: string;
  summary?: string;
  rssSnippet?: string;
  imageUrl?: string;
  imageAlt?: string;
  canonicalUrl: string;
  publishedAt: number;
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

type ArticlesListProps = {
  eventId: Id<"events">;
  articles: Article[];
};

function isNumberArray(value: unknown): value is number[] {
  return (
    Array.isArray(value) &&
    value.every((item) => typeof item === "number" && Number.isFinite(item))
  );
}

const ArticlesList = ({ eventId, articles }: ArticlesListProps) => {
  const { isAuthenticated } = useConvexAuth();
  const logInteraction = useMutation({
    mutationFn: useConvexMutation(api.interactions.logInteraction),
  });
  // Single subscription for the whole list — passed down to each BiasIndicator
  const thresholdsConfig = useQuery(api.config.get, {
    key: "bias_thresholds",
  });
  const thresholdsValue = thresholdsConfig?.value;
  const thresholds = isNumberArray(thresholdsValue) ? thresholdsValue : undefined;

  const logSourceClick = (articleId: Id<"articles">) => {
    if (!isAuthenticated) return;
    logInteraction.mutate({
      eventId,
      articleId,
      type: "click_source",
      metadata: {
        deviceType: getClientDeviceType(),
      },
    });
  };

  return (
    <Card className="overflow-hidden border-border/80 py-0">
      <CardHeader className="border-b border-border/70 bg-muted/30 py-5">
        <CardTitle className="text-xl tracking-tight">
          Original Reporting ({articles.length})
        </CardTitle>
      </CardHeader>
      <CardContent className="px-5 py-5 sm:px-6 sm:py-6">
        <div className="space-y-4">
          {articles.map((article) => (
            <div
              key={article._id}
              className="overflow-hidden rounded-[1rem] border border-border/70 bg-card"
            >
              <div className="grid gap-0 md:grid-cols-[minmax(0,0.34fr)_minmax(0,1fr)]">
                <div className="aspect-[4/3] overflow-hidden border-b border-border/70 bg-muted/40 md:aspect-auto md:border-r md:border-b-0">
                  {article.imageUrl ? (
                    <img
                      src={article.imageUrl}
                      alt={article.imageAlt ?? article.title}
                      className="h-full w-full object-cover"
                      loading="lazy"
                    />
                  ) : (
                    <div className="flex h-full items-center justify-center bg-linear-to-br from-muted to-background">
                      <span className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
                        {article.source?.name ?? "Source"}
                      </span>
                    </div>
                  )}
                </div>

                <div className="flex min-w-0 flex-col gap-4 p-5">
                  <div className="flex flex-wrap items-center gap-3">
                    {article.source && (
                      <>
                        <Link
                          to="/source/$sourceId"
                          params={{ sourceId: article.source._id }}
                          className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-full border border-border/80 bg-background transition-colors hover:bg-muted"
                          aria-label={`View ${article.source.name} source profile`}
                          onClick={() => logSourceClick(article._id)}
                        >
                          {article.source.logoUrl ? (
                            <img
                              src={article.source.logoUrl}
                              alt={article.source.name}
                              className="h-full w-full object-contain p-1.5"
                            />
                          ) : (
                            <span className="text-xs font-medium text-foreground">
                              {article.source.name.charAt(0)}
                            </span>
                          )}
                        </Link>
                        <div className="flex min-w-0 flex-wrap items-center gap-3">
                          <Link
                            to="/source/$sourceId"
                            params={{ sourceId: article.source._id }}
                            className="text-sm font-medium text-card-foreground hover:underline"
                            onClick={() => logSourceClick(article._id)}
                          >
                            {article.source.name}
                          </Link>
                          <BiasIndicator
                            bias={article.source.baseBias}
                            size="sm"
                            thresholds={thresholds}
                          />
                        </div>
                      </>
                    )}
                    <span className="text-xs text-muted-foreground">
                      {new Date(article.publishedAt).toLocaleDateString()}
                    </span>
                  </div>

                  <div className="space-y-2">
                    <h3 className="text-lg font-semibold leading-snug tracking-tight text-card-foreground">
                      {article.title}
                    </h3>

                    {(article.summary || article.rssSnippet) && (
                      <p className="max-w-[65ch] text-sm text-muted-foreground">
                        {article.summary ?? article.rssSnippet}
                      </p>
                    )}
                  </div>

                  <div>
                    <a
                      href={article.canonicalUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label="Read original (opens in a new tab)"
                      className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
                      onClick={() => logSourceClick(article._id)}
                    >
                      Read original
                      <svg
                        className="h-3 w-3"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                        aria-hidden="true"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
                        />
                      </svg>
                    </a>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
};

export default ArticlesList;
