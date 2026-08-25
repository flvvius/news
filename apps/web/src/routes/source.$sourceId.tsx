import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { useQuery } from "convex/react";
import { api } from "@news-app/backend/convex/_generated/api";
import type { Id } from "@news-app/backend/convex/_generated/dataModel";
import type { FunctionReturnType } from "convex/server";
import { ArrowLeftIcon, ExternalLinkIcon } from "lucide-react";
import BiasIndicator from "@/components/bias-indicator";
import { Button } from "@/components/ui/button";
import { SectionTitle } from "@/components/ui/section-title";
import { Snippet } from "@/components/ui/snippet";
import { formatAbsoluteTimestamp, formatRelativeTimestamp } from "@/lib/dates";
import { getLocaleFromMatches } from "@/lib/i18n/getLocaleFromMatches";
import { useLocale, useT } from "@/lib/i18n/LocaleContext";
import { getString } from "@/lib/i18n/strings";
import { SITE, absoluteSiteUrl } from "@/lib/seo";

export const Route = createFileRoute("/source/$sourceId")({
  loader: async ({ context, params }) => {
    const sourceId = parseSourceId(params.sourceId);
    if (sourceId === null) {
      // Malformed id can never resolve — real HTTP 404, not a soft-404.
      throw notFound();
    }

    const args = {
      sourceId,
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
          <Link to="/">{t("source.backToFeed")}</Link>
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
        <p role="status" aria-live="polite" className="text-sm text-muted-foreground">
          {t("source.loading")}
        </p>
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
    <div className="bg-background">
      <div className="container mx-auto max-w-4xl px-4 py-8 sm:py-10">
        <div className="flex items-center justify-between gap-4">
          <Link
            to="/"
            className="inline-flex w-fit items-center gap-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeftIcon className="size-4" />
            {t("source.backToFeed")}
          </Link>
          <Link
            to="/surse"
            className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            {t("sources.index.title")}
          </Link>
        </div>

        {/* Masthead. The logo keeps its frame — that is a media frame, not a
            card — everything around it sits on the page. */}
        <header className="mt-8 flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 gap-4">
            <div className="flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border bg-background">
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
                <p className="text-sm text-muted-foreground">
                  {t("source.profile")}
                </p>
                <h1 className="mt-1 break-words text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
                  {source.name}
                </h1>
              </div>
              {/* Metadata pills collapsed to one meta line (native
                  DESIGN_LOG — source metadata pills → one meta line). */}
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-muted-foreground">
                <BiasIndicator
                  bias={source.baseBias}
                  size="sm"
                  thresholds={thresholds}
                />
                <span>{formatBiasLabel(source.biasLabel)}</span>
                <span aria-hidden="true">·</span>
                <span>
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
            className="inline-flex shrink-0 items-center gap-1.5 text-sm font-medium text-primary hover:underline"
          >
            {source.domain}
            <ExternalLinkIcon className="size-4" />
          </a>
        </header>

        <div className="mt-8 grid grid-cols-2 gap-6 border-t border-border pt-6 sm:max-w-md">
          <div>
            <p className="text-2xl font-semibold tabular-nums text-foreground">
              {stats.totalArticles}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              {t("source.recentArticles")}
            </p>
          </div>
          <div>
            <p className="text-2xl font-semibold tabular-nums text-foreground">
              {stats.eventCount}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              {t("source.events")}
            </p>
          </div>
        </div>

        <section className="mt-10 border-t border-border pt-6">
          <SectionTitle>{t("source.credibilityTitle")}</SectionTitle>
          <dl className="mt-4 space-y-1">
            <dt className="text-sm text-muted-foreground">
              {t("source.mbfcCategory")}
            </dt>
            <dd className="text-sm font-medium text-foreground">
              {formatOptional(source.mbfcCategory, t("source.notRated"))}
            </dd>
          </dl>
          <p className="mt-4 max-w-[65ch] text-sm text-muted-foreground">
            {t("source.ratingExplainer")}
          </p>
          {source.provenance && (
            <p className="mt-2 max-w-[65ch] text-sm text-muted-foreground">
              {source.provenance}
            </p>
          )}
          <Link
            to="/sursele-noastre"
            className="mt-3 inline-block text-sm text-primary hover:underline"
          >
            {t("sources.index.methodology")}
          </Link>
        </section>

        <section className="mt-10 border-t border-border pt-6">
          <SectionTitle>{t("source.recentReporting")}</SectionTitle>
          {/* Article rows: the feed's anatomy, hairline-separated. */}
          <div className="mt-2 divide-y divide-border">
            {articles.map((article) => {
              const shownText = article.summary ?? article.rssSnippet;
              return (
                <article
                  key={article._id}
                  className="flex flex-col gap-3 py-5 sm:flex-row sm:gap-4"
                >
                  {article.imageUrl && (
                    <div className="aspect-video w-full shrink-0 overflow-hidden rounded-lg border border-border bg-muted sm:order-last sm:aspect-auto sm:h-24 sm:w-40">
                      <img
                        src={article.imageUrl}
                        alt={article.imageAlt ?? article.title}
                        className="h-full w-full object-cover"
                        loading="lazy"
                      />
                    </div>
                  )}
                  <div className="min-w-0 flex-1 space-y-2">
                    <p
                      className="text-xs text-muted-foreground"
                      title={formatAbsoluteTimestamp(
                        article.publishedAt,
                        locale,
                      )}
                    >
                      {formatRelativeTimestamp(article.publishedAt, locale)}
                    </p>
                    <h3 className="break-words text-base font-semibold leading-snug tracking-tight text-foreground">
                      {article.title}
                    </h3>
                    {/* L2: third-party text renders only through <Snippet>;
                        canonical link sits just below. */}
                    <Snippet
                      text={shownText}
                      className="line-clamp-2 break-words text-sm text-muted-foreground"
                    />
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 pt-1 text-sm">
                      {article.event && (
                        <Link
                          to="/event/$slug"
                          params={{ slug: article.event.slug }}
                          className="font-medium text-primary hover:underline"
                        >
                          {t("source.relatedEvent")}
                        </Link>
                      )}
                      <a
                        href={article.canonicalUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 font-medium text-muted-foreground transition-colors hover:text-foreground"
                      >
                        {t("articles.readOriginal")}
                        <ExternalLinkIcon className="size-3" />
                      </a>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
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
          <Link to="/">{t("source.backToFeed")}</Link>
        </Button>
      </div>
    </div>
  );
}
