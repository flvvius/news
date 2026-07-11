import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useConvexAuth, useQuery } from "convex/react";
import { api } from "@news-app/backend/convex/_generated/api";
import { useConvexMutation } from "@convex-dev/react-query";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import ArticlesList from "@/components/feed/articles-list";
import { EventDetailTabs } from "@/components/feed/event-detail-tabs";
import { ReportErrorForm } from "@/components/feed/report-error-form";
import BookmarkButton from "@/components/bookmark-button";
import ShareEventButton from "@/components/share-event-button";
import {
  buildInteractionContextFromSources,
  getClientDeviceType,
  getScrollDepthPercentage,
} from "@/lib/interaction-tracking";
import { formatAbsoluteTimestamp, formatRelativeTimestamp } from "@/lib/dates";
import { getLocaleFromMatches } from "@/lib/i18n/getLocaleFromMatches";
import { useLocale, useT } from "@/lib/i18n/LocaleContext";
import {
  getString,
  STRINGS,
  type Locale,
  type StringKey,
} from "@/lib/i18n/strings";
import { SITE, absoluteSiteUrl } from "@/lib/seo";

const searchSchema = z.object({
  returnToFeed: z.string().optional(),
});

function getPluralizedCountLabel(
  locale: Locale,
  baseKey: "event.articles" | "event.sourceCount",
  count: number,
) {
  const pluralCategory = new Intl.PluralRules(locale).select(count);
  const candidates = [
    `${baseKey}.${pluralCategory}`,
    `${baseKey}.other`,
    count === 1 ? `${baseKey}.one` : `${baseKey}.many`,
  ] as const;

  const resolvedKey =
    candidates.find(
      (candidate) => candidate in STRINGS[locale] || candidate in STRINGS.en,
    ) ?? `${baseKey}.many`;

  return getString(locale, resolvedKey as StringKey).replace(
    "{count}",
    String(count),
  );
}

export const Route = createFileRoute("/event/$slug")({
  validateSearch: searchSchema,
  loader: async ({ context, params }) => {
    const httpClient = context.convexQueryClient.serverHttpClient;
    try {
      if (httpClient) {
        return await httpClient.query(api.events.getEventBySlug, {
          slug: params.slug,
        });
      }

      return await context.convexClient.query(api.events.getEventBySlug, {
        slug: params.slug,
      });
    } catch (error) {
      console.error(
        `[Route loader] Failed to load event (slug: ${params.slug}):`,
        error,
      );
      return null;
    }
  },
  head: ({ loaderData, params, matches }) => {
    const locale = getLocaleFromMatches(matches);
    const title = loaderData?.event?.title
      ? `${loaderData.event.title} — ${SITE.name}`
      : getString(locale, "event.metaTitle");
    const description =
      loaderData?.event?.perspectiveSummaries?.neutral?.slice(0, 155) ??
      loaderData?.event?.globalImpact?.slice(0, 155) ??
      getString(locale, "event.metaDescription");
    const imageUrl =
      loaderData?.event?.shareImageUrl ?? loaderData?.event?.imageUrl;

    return {
      meta: [
        { title },
        { name: "description", content: description },
        { property: "og:title", content: title },
        { property: "og:site_name", content: SITE.name },
        { property: "og:description", content: description },
        { property: "og:type", content: "article" },
        {
          property: "og:url",
          content: absoluteSiteUrl(`/event/${params.slug}`),
        },
        ...(loaderData?.event?.firstPublishedAt
          ? [
              {
                property: "article:published_time",
                content: new Date(
                  loaderData.event.firstPublishedAt,
                ).toISOString(),
              },
            ]
          : []),
        ...(loaderData?.event?.lastUpdatedAt
          ? [
              {
                property: "article:modified_time",
                content: new Date(loaderData.event.lastUpdatedAt).toISOString(),
              },
            ]
          : []),
        { name: "twitter:card", content: "summary_large_image" },
        { name: "twitter:title", content: title },
        { name: "twitter:description", content: description },
        ...(imageUrl
          ? [
              { property: "og:image", content: imageUrl },
              ...(loaderData?.event?.shareImageWidth
                ? [
                    {
                      property: "og:image:width",
                      content: String(loaderData.event.shareImageWidth),
                    },
                  ]
                : []),
              ...(loaderData?.event?.shareImageHeight
                ? [
                    {
                      property: "og:image:height",
                      content: String(loaderData.event.shareImageHeight),
                    },
                  ]
                : []),
              {
                property: "og:image:alt",
                content: loaderData?.event?.imageAlt ?? title,
              },
              { name: "twitter:image", content: imageUrl },
            ]
          : []),
      ],
      links: [
        { rel: "canonical", href: absoluteSiteUrl(`/event/${params.slug}`) },
      ],
    };
  },
  component: EventDetailPage,
});

function EventDetailPage() {
  const locale = useLocale();
  const t = useT();
  const { slug } = Route.useParams();
  const loaderData = Route.useLoaderData();
  const search = Route.useSearch();
  const eventData = useQuery(api.events.getEventBySlug, { slug }) ?? loaderData;
  // L4 — per-sentence source attribution for the summary tabs.
  const grounding = useQuery(
    api.summarization.getSummaryGrounding,
    eventData?.event?._id ? { eventId: eventData.event._id } : "skip",
  );
  const { isAuthenticated } = useConvexAuth();
  const logInteractionFn = useConvexMutation(api.interactions.logInteraction);
  const navigate = useNavigate();
  const returnToFeed = search.returnToFeed === "1";

  const handleBackToFeed = () => {
    if (returnToFeed && window.history.length > 1) {
      window.history.back();
      return;
    }

    void navigate({ to: "/feed" });
  };

  useEffect(() => {
    if (!isAuthenticated || !eventData?.event?._id) return;

    const startedAt = Date.now();
    let maxScrollDepth = getScrollDepthPercentage();
    const interactionContext = buildInteractionContextFromSources(
      eventData.articles.map(
        (article: (typeof eventData.articles)[number]) => article.source,
      ),
    );

    const handleScroll = () => {
      maxScrollDepth = Math.max(maxScrollDepth, getScrollDepthPercentage());
    };

    window.addEventListener("scroll", handleScroll, { passive: true });

    return () => {
      window.removeEventListener("scroll", handleScroll);
      void logInteractionFn({
        eventId: eventData.event._id,
        type: "view",
        context: interactionContext,
        metadata: {
          deviceType: getClientDeviceType(),
          scrollDepthPercentage: Math.max(
            maxScrollDepth,
            getScrollDepthPercentage(),
          ),
          timeSpentSeconds: Math.max(
            1,
            Math.round((Date.now() - startedAt) / 1000),
          ),
        },
      }).catch((error) => {
        console.debug("Skipping event view interaction log:", error);
      });
    };
  }, [eventData?.event?._id, isAuthenticated, logInteractionFn]);

  if (eventData === undefined) {
    return (
      <div className="container mx-auto max-w-4xl px-4 py-8">
        <div
          role="status"
          aria-live="polite"
          aria-atomic="true"
          className="text-sm text-muted-foreground"
        >
          {t("event.loading")}
        </div>
      </div>
    );
  }

  if (eventData === null) {
    return (
      <div className="container mx-auto max-w-4xl px-4 py-8">
        <div className="text-center">
          <h1 className="mb-2 text-2xl font-semibold">{t("event.notFound")}</h1>
          <p className="mb-4 text-muted-foreground">
            {t("event.notFoundBody")}
          </p>
          <Button asChild>
            <Link to="/feed">{t("event.backToFeed")}</Link>
          </Button>
        </div>
      </div>
    );
  }

  const { event, articles } = eventData;
  type Article = (typeof articles)[number];
  const sourceCount = new Set(
    articles.map((article: Article) => article.source?._id).filter(Boolean),
  ).size;
  const lastUpdatedAt = event.lastUpdatedAt ?? event.firstPublishedAt;
  const interactionContext = buildInteractionContextFromSources(
    articles.map((article: Article) => article.source),
  );

  // L1 (AI Act art. 50(4)) — machine-readable marking, server-rendered into
  // the initial HTML. digitalSourceType is the IPTC term for fully
  // AI-generated content; creativeWorkStatus discloses the missing human
  // review in-band.
  const jsonLd = {
    "@context": [
      "https://schema.org",
      { digitalSourceType: "https://cv.iptc.org/newscodes/digitalsourcetype/" },
    ],
    "@type": "NewsArticle",
    headline: event.title,
    inLanguage: locale,
    url: absoluteSiteUrl(`/event/${event.slug}`),
    datePublished: new Date(event.firstPublishedAt).toISOString(),
    dateModified: new Date(lastUpdatedAt).toISOString(),
    isAccessibleForFree: true,
    creativeWorkStatus:
      "AI-generated summary; not independently human-reviewed",
    digitalSourceType:
      "https://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia",
    author: {
      "@type": "Organization",
      name: SITE.name,
      url: SITE.url,
    },
    ...(event.imageUrl ? { image: [event.imageUrl] } : {}),
    isBasedOn: articles
      .slice(0, 25)
      .map((article: Article) => article.canonicalUrl),
  };

  return (
    <div className="bg-background">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <div className="container mx-auto max-w-4xl px-4 py-4 sm:py-10">
        <div className="flex flex-col gap-6 sm:gap-8">
          <button
            type="button"
            onClick={handleBackToFeed}
            className="inline-flex items-center self-start text-sm font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            &larr; {t("event.backToFeed")}
          </button>

          {/* Editorial-calm hero (BIV-807, native DESIGN_LOG): typographic,
              no card shell; 3:2 content-width photo with hairline border;
              header actions are plain icon buttons. */}
          <section className="flex flex-col gap-4">
            <h1 className="max-w-full break-words text-2xl font-semibold leading-tight tracking-tight text-foreground text-balance sm:text-4xl">
              {event.title}
            </h1>
            <div className="flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:gap-4">
              <p
                className="text-sm sm:text-md text-muted-foreground"
                title={formatAbsoluteTimestamp(lastUpdatedAt, locale)}
              >
                {t("event.updated").replace(
                  "{time}",
                  formatRelativeTimestamp(lastUpdatedAt, locale),
                )}
                {" · "}
                {getPluralizedCountLabel(
                  locale,
                  "event.sourceCount",
                  sourceCount,
                )}
                {" · "}
                {getPluralizedCountLabel(
                  locale,
                  "event.articles",
                  articles.length,
                )}
              </p>

              <div className="ml-auto flex gap-1 sm:justify-end">
                <BookmarkButton
                  eventId={event._id}
                  interactionContext={interactionContext}
                  redirectTo={`/event/${event.slug}`}
                />
                <ShareEventButton
                  eventId={event._id}
                  interactionContext={interactionContext}
                  slug={event.slug}
                  title={event.title}
                  summary={
                    event.perspectiveSummaries?.neutral ?? event.globalImpact
                  }
                />
              </div>
            </div>

            {event.imageUrl &&
              (() => {
                // L9 tier (b): the thumbnail is hotlinked from the publisher,
                // rendered small, attributed, and wrapped in a link to the
                // original article it came from.
                const imageArticle =
                  articles.find(
                    (article: Article) => article.imageUrl === event.imageUrl,
                  ) ?? articles[0];
                const imageSourceName =
                  imageArticle?.source?.name ?? "sursa originală";
                return (
                  <figure className="w-full">
                    <a
                      href={imageArticle?.canonicalUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block overflow-hidden rounded-lg border border-border bg-muted"
                    >
                      <img
                        src={event.imageUrl}
                        alt={event.imageAlt ?? event.title}
                        className="aspect-3/2 w-full object-cover"
                        loading="lazy"
                      />
                    </a>
                    <figcaption className="mt-1 text-xs text-muted-foreground">
                      Foto: {imageSourceName} — imaginea aparține publicației
                      și trimite către articolul original.
                    </figcaption>
                  </figure>
                );
              })()}
          </section>

          <EventDetailTabs
            eventId={event._id}
            perspectiveSummaries={event.perspectiveSummaries}
            perspectiveApplicable={event.perspectiveApplicable}
            globalImpact={event.globalImpact}
            articles={articles}
            sourceCount={sourceCount}
            grounding={grounding}
          />

          <ArticlesList eventId={event._id} articles={articles} />

          {/* L8 — notice-and-action entry point; #raporteaza is the anchor
              the AI-disclosure label links to. */}
          <ReportErrorForm eventId={event._id} />
        </div>
      </div>
    </div>
  );
}
