import type { Id } from "@news-app/backend/convex/_generated/dataModel";
import { Link } from "@tanstack/react-router";
import { useConvexAuth, useQuery } from "convex/react";
import { api } from "@news-app/backend/convex/_generated/api";
import { useMutation } from "@tanstack/react-query";
import { useConvexMutation } from "@convex-dev/react-query";
import { ChevronDownIcon } from "lucide-react";
import { useState } from "react";
import BiasIndicator from "@/components/bias-indicator";
import { SectionTitle } from "@/components/ui/section-title";
import { getClientDeviceType } from "@/lib/interaction-tracking";
import { useT } from "@/lib/i18n/LocaleContext";
import { cn } from "@/lib/utils";

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

const INITIAL_ARTICLE_COUNT = 5;

function isNumberArray(value: unknown): value is number[] {
  return (
    Array.isArray(value) &&
    value.every((item) => typeof item === "number" && Number.isFinite(item))
  );
}

const ArticlesList = ({ eventId, articles }: ArticlesListProps) => {
  const t = useT();
  const [isExpanded, setIsExpanded] = useState(false);
  const { isAuthenticated } = useConvexAuth();
  const logInteraction = useMutation({
    mutationFn: useConvexMutation(api.interactions.logInteraction),
  });
  // Single subscription for the whole list — passed down to each BiasIndicator
  const thresholdsConfig = useQuery(api.config.get, {
    key: "bias_thresholds",
  });
  const thresholdsValue = thresholdsConfig?.value;
  const thresholds = isNumberArray(thresholdsValue)
    ? thresholdsValue
    : undefined;

  const logSourceClick = (article: Article) => {
    if (!isAuthenticated) return;
    logInteraction.mutate({
      eventId,
      articleId: article._id,
      type: "click_source",
      context: {
        biasRating: article.source?.baseBias ?? 0,
        sourceReliability: article.source?.reliabilityScore ?? 0,
      },
      metadata: {
        deviceType: getClientDeviceType(),
      },
    });
  };

  const visibleArticles = isExpanded
    ? articles
    : articles.slice(0, INITIAL_ARTICLE_COUNT);
  const remainingCount = articles.length - INITIAL_ARTICLE_COUNT;
  const showToggle = remainingCount > 0;

  return (
    <section className="space-y-2 border-t border-border pt-6">
      <SectionTitle>
        {t("articles.originalReporting")} ({articles.length})
      </SectionTitle>
      <div className="flex flex-col divide-y divide-border">
        {visibleArticles.map((article) => (
          <div key={article._id} className="py-5">
            <div className="flex min-w-0 flex-col gap-3">
              <div className="flex flex-wrap items-center gap-3">
                {article.source && (
                  <>
                    <Link
                      to="/source/$sourceId"
                      params={{ sourceId: article.source._id }}
                      className="flex h-8 w-8 items-center justify-center overflow-hidden rounded-full border border-border bg-background transition-colors hover:bg-muted"
                      aria-label={t("articles.viewSource").replace(
                        "{name}",
                        article.source.name,
                      )}
                      onClick={() => logSourceClick(article)}
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
                        className="text-sm font-medium text-foreground hover:underline"
                        onClick={() => logSourceClick(article)}
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
                <h3 className="break-words text-base font-semibold leading-snug tracking-tight text-foreground">
                  {article.title}
                </h3>

                {(article.summary || article.rssSnippet) && (
                  <p className="max-w-full break-words text-sm text-muted-foreground">
                    {article.summary ?? article.rssSnippet}
                  </p>
                )}
              </div>

              <div>
                <a
                  href={article.canonicalUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={t("articles.readOriginalAria")}
                  className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
                  onClick={() => logSourceClick(article)}
                >
                  {t("articles.readOriginal")}
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
        ))}
      </div>

      {showToggle && (
        <button
          type="button"
          aria-expanded={isExpanded}
          onClick={() => setIsExpanded(!isExpanded)}
          className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-lg border border-border bg-card py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          {isExpanded
            ? t("articles.showLess")
            : remainingCount === 1
              ? t("articles.showMore.one")
              : t("articles.showMore.many").replace(
                  "{count}",
                  String(remainingCount),
                )}
          <ChevronDownIcon
            className={cn(
              "size-4 transition-transform",
              isExpanded && "rotate-180",
            )}
          />
        </button>
      )}
    </section>
  );
};

export default ArticlesList;
