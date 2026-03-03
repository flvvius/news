import type { Id } from "@news-app/backend/convex/_generated/dataModel";
import { useQuery } from "convex/react";
import { api } from "@news-app/backend/convex/_generated/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import BiasIndicator from "@/components/bias-indicator";

type Article = {
  _id: Id<"articles">;
  title: string;
  summary?: string;
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
  articles: Article[];
};

const ArticlesList = ({ articles }: ArticlesListProps) => {
  // Single subscription for the whole list — passed down to each BiasIndicator
  const thresholdsConfig = useQuery(api.config.get, {
    key: "bias_thresholds",
  });
  const thresholds =
    (thresholdsConfig?.value as number[] | undefined) ?? undefined;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Articles ({articles.length})</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {articles.map((article) => (
            <div
              key={article._id}
              className="flex items-start gap-4 pb-4 border-b last:border-b-0 last:pb-0"
            >
              {/* Source logo */}
              {article.source?.logoUrl && (
                <div className="shrink-0 h-10 w-10 rounded-full border bg-muted overflow-hidden">
                  <img
                    src={article.source.logoUrl}
                    alt={article.source.name}
                    className="h-full w-full object-cover"
                  />
                </div>
              )}

              <div className="flex-1 min-w-0">
                {/* Article title */}
                <h3 className="font-medium mb-1 leading-snug">
                  {article.title}
                </h3>

                {/* Source name and bias */}
                <div className="flex flex-wrap items-center gap-3 mb-2">
                  {article.source && (
                    <>
                      <span className="text-sm text-muted-foreground">
                        {article.source.name}
                      </span>
                      <BiasIndicator
                        bias={article.source.baseBias}
                        size="sm"
                        thresholds={thresholds}
                      />
                    </>
                  )}
                  <span className="text-xs text-muted-foreground">
                    {new Date(article.publishedAt).toLocaleDateString()}
                  </span>
                </div>

                {/* Article summary */}
                {article.summary && (
                  <p className="text-sm text-muted-foreground mb-2 line-clamp-2">
                    {article.summary}
                  </p>
                )}

                {/* Read original link */}
                <a
                  href={article.canonicalUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label="Read original (opens in a new tab)"
                  className="text-sm text-primary hover:underline inline-flex items-center gap-1"
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
          ))}
        </div>
      </CardContent>
    </Card>
  );
};

export default ArticlesList;
