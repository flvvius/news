import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { useQuery } from "convex/react";
import { api } from "@news-app/backend/convex/_generated/api";
import type { Id } from "@news-app/backend/convex/_generated/dataModel";
import type { FunctionReturnType } from "convex/server";
import {
  ArrowLeftIcon,
  ExternalLinkIcon,
  NewspaperIcon,
  ShieldCheckIcon,
} from "lucide-react";
import BiasIndicator from "@/components/bias-indicator";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatAbsoluteTimestamp, formatRelativeTimestamp } from "@/lib/dates";
import { getLocaleFromMatches } from "@/lib/i18n/getLocaleFromMatches";
import { useLocale, useT } from "@/lib/i18n/LocaleContext";
import { getString } from "@/lib/i18n/strings";
import { SITE, absoluteSiteUrl } from "@/lib/seo";

export const Route = createFileRoute("/source/$sourceId")({
  loader: async ({ context, params }) => {
    const trimmedSourceId = params.sourceId.trim();
    if (!/^[a-z0-9]{16,64}$/i.test(trimmedSourceId)) {
      // Malformed id can never resolve — real HTTP 404, not a soft-404.
      throw notFound();
    }

    const args = {
      sourceId: trimmedSourceId as Id<"sources">,
      limit: 60,
    };
    const httpClient = context.convexQueryClient.serverHttpClient;
    let data;

    try {
      if (httpClient) {
        data = await httpClient.query(api.sources.getSourceProfile, args);
      } else {
        data = await context.convexClient.query(
          api.sources.getSourceProfile,
          args,
        );
      }
    } catch (error) {
      // A well-formed id that doesn't decode to the sources table fails
      // argument validation — that URL can never resolve, so 404 it.
      if (
        error instanceof Error &&
        error.message.includes("ArgumentValidationError")
      ) {
        throw notFound();
      }
      console.error(
        `[Route loader] Failed to load source profile (${params.sourceId}):`,
        error,
      );
      // Transient backend failure: degrade to the loading shell and let the
      // client-side subscription retry, instead of mislabeling the URL.
      return undefined;
    }

    if (data === null) {
      throw notFound();
    }

    return data;
  },
  notFoundComponent: SourceNotFound,
  head: ({ loaderData, params, matches }) => {
    const locale = getLocaleFromMatches(matches);
    const sourceName = loaderData?.source?.name;
    const title = sourceName
      ? `${sourceName} — ${SITE.name}`
      : getString(locale, "source.metaTitle");
    const description = loaderData?.source
      ? getString(locale, "source.metaDescriptionLoaded").replace(
          "{name}",
          sourceName ?? getString(locale, "source.metaTitle"),
        )
      : getString(locale, "source.metaDescription");

    return {
      meta: [
        { title },
        { name: "description", content: description },
        { property: "og:title", content: title },
        { property: "og:site_name", content: SITE.name },
        { property: "og:type", content: "website" },
        { property: "og:description", content: description },
        {
          property: "og:url",
          content: absoluteSiteUrl(`/source/${params.sourceId}`),
        },
        { name: "twitter:card", content: "summary_large_image" },
        { name: "twitter:title", content: title },
        { name: "twitter:description", content: description },
      ],
      links: [
        {
          rel: "canonical",
          href: absoluteSiteUrl(`/source/${params.sourceId}`),
        },
      ],
    };
  },
  component: SourceProfilePage,
});

function formatBiasLabel(label: string) {
  return label
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("-");
}

function formatOptional(value: string | undefined, fallback: string) {
  if (!value) return fallback;
  return value
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function parseSourceId(value: string): Id<"sources"> | null {
  const trimmed = value.trim();
  if (!/^[a-z0-9]{16,64}$/i.test(trimmed)) return null;
  return trimmed as Id<"sources">;
}

function isNumberArray(value: unknown): value is number[] {
  return (
    Array.isArray(value) &&
    value.every((item) => typeof item === "number" && Number.isFinite(item))
  );
}

function SourceNotFound() {
  const t = useT();
  return (
    <div className="container mx-auto max-w-5xl px-4 py-8">
      <div className="text-center">
        <h1 className="mb-2 text-2xl font-semibold">{t("source.notFound")}</h1>
        <p className="mb-4 text-muted-foreground">{t("source.notFoundBody")}</p>
        <Button asChild>
          <Link to="/feed">{t("source.backToFeed")}</Link>
        </Button>
      </div>
    </div>
  );
}

function SourceProfilePage() {
  const { sourceId } = Route.useParams();
  const parsedSourceId = parseSourceId(sourceId);

  if (!parsedSourceId) {
    return <InvalidSourceId />;
  }

  return <SourceProfileContent sourceId={parsedSourceId} />;
}

function SourceProfileContent({ sourceId }: { sourceId: Id<"sources"> }) {
  const locale = useLocale();
  const t = useT();
  const loaderData = Route.useLoaderData();
  const queryData = useQuery(api.sources.getSourceProfile, {
    sourceId,
    limit: 60,
  });
  // loaderData is untyped through the router context, which would make `data`
  // (and `articles` below) `any`; pin it to the query's return type.
  const data = (queryData ?? loaderData) as
    | FunctionReturnType<typeof api.sources.getSourceProfile>
    | null
    | undefined;
  const thresholdsConfig = useQuery(api.config.get, {
    key: "bias_thresholds",
  });
  const thresholdsValue = thresholdsConfig?.value;
  const thresholds = isNumberArray(thresholdsValue)
    ? thresholdsValue
    : undefined;

  if (data === undefined) {
    return (
      <div className="container mx-auto max-w-5xl px-4 py-8">
        <div
          role="status"
          aria-live="polite"
          className="rounded-xl border border-border/70 bg-card/70 px-5 py-8 text-sm text-muted-foreground"
        >
          {t("source.loading")}
        </div>
      </div>
    );
  }

  if (data === null) {
    // Client-side path only; the server path throws notFound() in the loader
    // and returns HTTP 404.
    return <SourceNotFound />;
  }

  const { source, stats, articles } = data;

  return (
    <div className="bg-linear-to-b from-background via-background to-muted/35">
      <div className="container mx-auto max-w-5xl px-3 py-4 sm:px-4 sm:py-10">
        <div className="flex flex-col gap-5 sm:gap-8">
          <div className="flex items-center justify-between gap-4">
            <Link
              to="/feed"
              className="inline-flex w-fit items-center gap-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              <ArrowLeftIcon className="size-4" />
              {t("source.backToFeed")}
            </Link>
            <Link
              to="/surse"
              className="text-sm font-medium text-muted-foreground underline transition-colors hover:text-foreground"
            >
              {t("sources.index.title")}
            </Link>
          </div>

          <section className="overflow-hidden rounded-[1.15rem] border border-border/80 bg-card/95 shadow-sm sm:rounded-[1.6rem]">
            <div className="space-y-6 px-4 py-5 sm:px-8 sm:py-8">
              <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
                <div className="flex min-w-0 gap-4">
                  <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-border/80 bg-background sm:h-20 sm:w-20">
                    {source.logoUrl ? (
                      <img
                        src={source.logoUrl}
                        alt={source.name}
                        className="h-full w-full object-contain p-3"
                      />
                    ) : (
                      <span className="text-xl font-semibold">
                        {source.name.charAt(0)}
                      </span>
                    )}
                  </div>
                  <div className="min-w-0 space-y-3">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.24em] text-muted-foreground">
                        {t("source.profile")}
                      </p>
                      <h1 className="mt-2 break-words text-3xl font-bold tracking-tight text-foreground sm:text-5xl">
                        {source.name}
                      </h1>
                    </div>
                    <div className="flex flex-wrap items-center gap-3">
                      <BiasIndicator
                        bias={source.baseBias}
                        size="md"
                        thresholds={thresholds}
                      />
                      <span className="rounded-full border border-border/70 bg-background/70 px-3 py-1 text-xs font-medium text-muted-foreground">
                        {formatBiasLabel(source.biasLabel)}
                      </span>
                      <span className="rounded-full border border-border/70 bg-background/70 px-3 py-1 text-xs font-medium text-muted-foreground">
                        {t("source.reliability").replace(
                          "{score}",
                          String(source.reliabilityScore),
                        )}
                      </span>
                    </div>
                  </div>
                </div>

                <a
                  href={`https://${source.domain}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex h-10 items-center justify-center gap-2 rounded-full border border-border/80 bg-background/70 px-4 text-sm font-medium text-foreground transition-colors hover:bg-muted"
                >
                  {source.domain}
                  <ExternalLinkIcon className="size-4" />
                </a>
              </div>

              <div className="grid gap-3 border-t border-border/70 pt-5 sm:grid-cols-2">
                <div className="rounded-xl border border-border/70 bg-background/55 px-4 py-3">
                  <p className="text-xs text-muted-foreground">
                    {t("source.recentArticles")}
                  </p>
                  <p className="text-2xl font-semibold text-card-foreground">
                    {stats.totalArticles}
                  </p>
                </div>
                <div className="rounded-xl border border-border/70 bg-background/55 px-4 py-3">
                  <p className="text-xs text-muted-foreground">
                    {t("source.events")}
                  </p>
                  <p className="text-2xl font-semibold text-card-foreground">
                    {stats.eventCount}
                  </p>
                </div>
              </div>
            </div>
          </section>

          <div className="grid gap-5 lg:grid-cols-[0.36fr_0.64fr]">
            <Card className="h-fit overflow-hidden border-border/80 py-0">
              <CardHeader className="border-b border-border/70 bg-muted/30 py-5">
                <CardTitle className="flex items-center gap-2 text-xl tracking-tight">
                  <ShieldCheckIcon className="size-5" />
                  {t("source.credibilityTitle")}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4 px-5 py-5">
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">
                    {t("source.mbfcCategory")}
                  </p>
                  <p className="font-medium text-card-foreground">
                    {formatOptional(source.mbfcCategory, t("source.notRated"))}
                  </p>
                </div>
                <div className="space-y-1 border-t border-border/70 pt-4">
                  <p className="text-sm text-muted-foreground">
                    {t("source.ratingExplainer")}
                  </p>
                  {source.provenance && (
                    <p className="text-sm text-muted-foreground">
                      {source.provenance}
                    </p>
                  )}
                  <Link
                    to="/sursele-noastre"
                    className="text-sm underline hover:text-foreground"
                  >
                    {t("sources.index.methodology")}
                  </Link>
                </div>
              </CardContent>
            </Card>

            <Card className="overflow-hidden border-border/80 py-0">
              <CardHeader className="border-b border-border/70 bg-muted/30 py-5">
                <CardTitle className="flex items-center gap-2 text-xl tracking-tight">
                  <NewspaperIcon className="size-5" />
                  {t("source.recentReporting")}
                </CardTitle>
              </CardHeader>
              <CardContent className="px-5 py-5 sm:px-6">
                <div className="space-y-4">
                  {articles.map((article) => {
                    const shownText = article.summary ?? article.rssSnippet;
                    return (
                      <article
                        key={article._id}
                        className="rounded-xl border border-border/70 bg-background/65 p-4"
                      >
                        <div className="flex flex-col gap-3 sm:flex-row">
                          {article.imageUrl && (
                            <img
                              src={article.imageUrl}
                              alt={article.imageAlt ?? article.title}
                              className="aspect-video w-full rounded-lg object-cover sm:w-40"
                              loading="lazy"
                            />
                          )}
                          <div className="min-w-0 flex-1 space-y-2">
                            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                              <span
                                title={formatAbsoluteTimestamp(
                                  article.publishedAt,
                                  locale,
                                )}
                              >
                                {formatRelativeTimestamp(
                                  article.publishedAt,
                                  locale,
                                )}
                              </span>
                            </div>
                            <h2 className="break-words text-base font-semibold leading-snug tracking-tight text-card-foreground">
                              {article.title}
                            </h2>
                            {shownText && (
                              <p className="line-clamp-2 break-words text-sm text-muted-foreground">
                                {shownText}
                              </p>
                            )}
                            <div className="flex flex-wrap gap-2 pt-1">
                              {article.event && (
                                <Link
                                  to="/event/$slug"
                                  params={{ slug: article.event.slug }}
                                  className="inline-flex items-center gap-1 rounded-full border border-border/80 bg-background px-3 py-1 text-xs font-medium text-primary hover:bg-muted"
                                >
                                  {t("source.relatedEvent")}
                                  <ExternalLinkIcon className="size-3" />
                                </Link>
                              )}
                              <a
                                href={article.canonicalUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 rounded-full border border-border/80 bg-background px-3 py-1 text-xs font-medium text-primary hover:bg-muted"
                              >
                                {t("articles.readOriginal")}
                                <ExternalLinkIcon className="size-3" />
                              </a>
                            </div>
                          </div>
                        </div>
                      </article>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}

function InvalidSourceId() {
  const t = useT();
  return (
    <div className="container mx-auto max-w-5xl px-4 py-8">
      <div className="text-center">
        <h1 className="mb-2 text-2xl font-semibold">{t("source.notFound")}</h1>
        <p className="mb-4 text-muted-foreground">{t("source.invalidBody")}</p>
        <Button asChild>
          <Link to="/feed">{t("source.backToFeed")}</Link>
        </Button>
      </div>
    </div>
  );
}
