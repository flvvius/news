import type { Id } from "@news-app/backend/convex/_generated/dataModel";
import { useQuery } from "convex/react";
import { api } from "@news-app/backend/convex/_generated/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import BiasIndicator from "@/components/bias-indicator";
import { ExternalLink, Newspaper } from "lucide-react";

type Article = {
  _id: Id<"articles">;
  title: string;
  summary: string;
  canonicalUrl: string;
  publishedAt: string;
  source: {
    _id: Id<"sources">;
    name: string;
    logoUrl: string;
    baseBias: number;
  } | null;
};

type ArticlesListProps = {
  articles: Article[];
};

const ArticlesList = ({ articles }: ArticlesListProps) => {
  const thresholdsConfig = useQuery(api.config.get, {
    key: "bias_thresholds",
  });
  const thresholds =
    (thresholdsConfig?.value as number[] | undefined) ?? undefined;

  return (
    <Card className="border-border">
      <CardHeader className="border-b border-border bg-muted/30">
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center size-10 rounded-xl bg-primary/10 text-primary">
            <Newspaper className="size-5" />
          </div>
          <div>
            <CardTitle>
              Articles{" "}
              <span className="text-muted-foreground font-normal">
                ({articles.length})
              </span>
            </CardTitle>
            <p className="text-sm text-muted-foreground mt-0.5">
              Coverage from multiple sources
            </p>
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <div className="divide-y divide-border">
          {articles.map((article) => (
            <article
              key={article._id}
              className="flex items-start gap-4 p-6 hover:bg-muted/30 transition-colors"
            >
              {/* Source logo */}
              {article.source?.logoUrl && (
                <div className="shrink-0 size-12 rounded-xl border border-border bg-card overflow-hidden">
                  <img
                    src={article.source.logoUrl}
                    alt={article.source.name}
                    className="h-full w-full object-cover"
                  />
                </div>
              )}

              <div className="flex-1 min-w-0">
                {/* Article title */}
                <h3 className="font-semibold leading-snug mb-2 line-clamp-2">
                  {article.title}
                </h3>

                {/* Source name, bias, and date */}
                <div className="flex flex-wrap items-center gap-3 mb-3">
                  {article.source && (
                    <>
                      <span className="text-sm font-medium text-foreground">
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
                    {new Date(article.publishedAt).toLocaleDateString(
                      undefined,
                      {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                      }
                    )}
                  </span>
                </div>

                {/* Article summary */}
                {article.summary && (
                  <p className="text-sm text-muted-foreground mb-3 line-clamp-2 leading-relaxed">
                    {article.summary}
                  </p>
                )}

                {/* Read original link */}
                <a
                  href={article.canonicalUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline group"
                >
                  Read original
                  <ExternalLink className="size-3.5 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
                </a>
              </div>
            </article>
          ))}
        </div>
      </CardContent>
    </Card>
  );
};

export default ArticlesList;
