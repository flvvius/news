import {
  createFileRoute,
  Link,
  notFound,
  useNavigate,
} from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useConvexAuth, useQuery } from "convex/react";
import { api } from "@news-app/backend/convex/_generated/api";
import { useConvexMutation } from "@convex-dev/react-query";
import { Button } from "@/components/ui/button";
import ArticlesList from "@/components/feed/articles-list";
import { EventDetailTabs } from "@/components/feed/event-detail-tabs";
import { ReportDialogProvider } from "@/components/feed/report-error-form";
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
import {
  SITE,
  absoluteSiteUrl,
  deriveShortTitle,
  jsonLdScript,
  truncateAtWordBoundary,
} from "@/lib/seo";

// SEO-8: "came from feed" is carried in sessionStorage (set on the feed link
// click), not a ?returnToFeed URL param, so crawlers only ever see the clean
// canonical /event/$slug URL with no parameter variants.
const RETURN_TO_FEED_KEY = "miez-return-to-feed";

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
  loader: async ({ context, params }) => {
    const httpClient = context.convexQueryClient.serverHttpClient;
    let data;
    try {
      if (httpClient) {
        data = await httpClient.query(api.events.getEventBySlug, {
          slug: params.slug,
        });
      } else {
        data = await context.convexClient.query(api.events.getEventBySlug, {
          slug: params.slug,
        });
      }
    } catch (error) {
      console.error(
        `[Route loader] Failed to load event (slug: ${params.slug}):`,
        error,
      );
      // Transient backend failure: degrade to the loading shell and let the
      // client-side subscription retry, instead of mislabeling the URL.
      return undefined;
    }

    if (data === null) {
      // Unknown slug must be a real HTTP 404, not a soft-404 page with 200.
      throw notFound();
    }

    return data;
  },
  notFoundComponent: EventNotFound,
  head: ({ loaderData, params, matches }) => {
    const locale = getLocaleFromMatches(matches);
    // Short, single-headline canonical title for <title>/og/twitter cards
    // (SEO-5); the full compound title stays as the on-page <h1>.
    const shortTitle = loaderData?.event?.title
      ? deriveShortTitle(loaderData.event.title)
      : null;
    const title = shortTitle
      ? `${shortTitle} | ${SITE.name}`
      : getString(locale, "event.metaTitle");
    // Word-boundary truncation, never mid-word, single ellipsis (SEO-6).
    const rawDescription =
      loaderData?.event?.perspectiveSummaries?.neutral?.trim() ||
      loaderData?.event?.globalImpact?.trim();
    const description = rawDescription
      ? truncateAtWordBoundary(rawDescription, 155)
      : getString(locale, "event.metaDescription");
    const imageUrl =
      loaderData?.event?.shareImageUrl ?? loaderData?.event?.imageUrl;

    // Thin-page discipline: without an AI summary the page is mostly
    // third-party RSS text, so keep it out of indexes (follow links so
    // crawlers still traverse) until the summary lands. Mirrors the
    // sitemap gate in convex/sitemap.ts.
    const isThin =
      !!loaderData?.event &&
      !loaderData.event.perspectiveSummaries?.neutral?.trim();

    return {
      meta: [
        { title },
        { name: "description", content: description },
        ...(isThin ? [{ name: "robots", content: "noindex, follow" }] : []),
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
      // Single authoritative structured-data block for the page, rendered
      // into <head> so it is present in the initial SSR HTML for crawlers.
      // Uses NewsArticle + the IPTC AI-generation marking (L1, AI Act art.
      // 50(4)) — the one place we emit NewsArticle, justified by the in-band
      // AI disclosure and isBasedOn source list.
      scripts: loaderData?.event
        ? [
            jsonLdScript({
              "@context": [
                "https://schema.org",
                {
                  digitalSourceType:
                    "https://cv.iptc.org/newscodes/digitalsourcetype/",
                },
              ],
              "@type": "NewsArticle",
              headline: loaderData.event.title,
              ...(description ? { description } : {}),
              // Event summaries are authored in Romanian regardless of the UI
              // locale, so this marks the article-content language, not chrome.
              inLanguage: "ro",
              url: absoluteSiteUrl(`/event/${params.slug}`),
              mainEntityOfPage: absoluteSiteUrl(`/event/${params.slug}`),
              datePublished: new Date(
                loaderData.event.firstPublishedAt,
              ).toISOString(),
              dateModified: new Date(
                loaderData.event.lastUpdatedAt ??
                  loaderData.event.firstPublishedAt,
              ).toISOString(),
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
              publisher: {
                "@type": "NewsMediaOrganization",
                name: SITE.name,
                url: SITE.url,
                // Raster logo (512×512) — Google rejects an SVG here (SEO-7).
                logo: absoluteSiteUrl("/logo-mark.png"),
              },
              ...(loaderData.event.imageUrl
                ? { image: [loaderData.event.imageUrl] }
                : {}),
              isBasedOn: (loaderData.articles ?? [])
                .slice(0, 25)
                .map((article) => article.canonicalUrl)
                .filter(Boolean),
            }),
          ]
        : [],
    };
  },
  component: EventDetailPage,
});

function EventNotFound() {
  const t = useT();
  return (
    <div className="container mx-auto max-w-4xl px-4 py-8">
      <div className="text-center">
        <h1 className="mb-2 text-2xl font-semibold">{t("event.notFound")}</h1>
        <p className="mb-4 text-muted-foreground">{t("event.notFoundBody")}</p>
        <Button asChild>
          <Link to="/">{t("event.backToFeed")}</Link>
        </Button>
      </div>
    </div>
  );
}

function EventDetailPage() {
  const locale = useLocale();
  const t = useT();
  const { slug } = Route.useParams();
  const loaderData = Route.useLoaderData();
  const eventData = useQuery(api.events.getEventBySlug, { slug }) ?? loaderData;
  // L4 — per-sentence source attribution for the summary tabs.
  const grounding = useQuery(
    api.summarization.getSummaryGrounding,
    eventData?.event?._id ? { eventId: eventData.event._id } : "skip",
  );
  const { isAuthenticated } = useConvexAuth();
  const logInteractionFn = useConvexMutation(api.interactions.logInteraction);
  const navigate = useNavigate();
  // Set by the feed card on click (SEO-8). Read once and clear, so a reload of
  // a directly-shared event URL falls back to navigating to the feed instead of
  // popping unrelated history.
  const [cameFromFeed, setCameFromFeed] = useState(false);
  useEffect(() => {
    // Start each event navigation clean so a client-side jump to an event that
    // wasn't opened from the feed doesn't inherit the previous event's flag.
    setCameFromFeed(false);
    try {
      if (window.sessionStorage.getItem(RETURN_TO_FEED_KEY) === "1") {
        setCameFromFeed(true);
        window.sessionStorage.removeItem(RETURN_TO_FEED_KEY);
      }
    } catch {
      // Ignore unavailable/blocked sessionStorage.
    }
  }, [slug]);

  const handleBackToFeed = () => {
    if (cameFromFeed && window.history.length > 1) {
      window.history.back();
      return;
    }

    void navigate({ to: "/" });
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
    // Client-side path only (e.g. event unpublished after navigation); the
    // server path throws notFound() in the loader and returns HTTP 404.
    return <EventNotFound />;
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

  // Article/NewsArticle JSON-LD (incl. the L1 AI-Act generation marking) is
  // emitted once from the route head() into <head>; see the scripts block above.

  return (
    <div className="bg-background">
      <ReportDialogProvider eventId={event._id}>
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
                  />
                </div>
              </div>

              {event.imageUrl &&
                (() => {
                  // L9 tier (b): the hero is hotlinked from the publisher,
                  // attributed, and wrapped in a link to the original article it
                  // came from. It is also the page's LCP element, so fetch it
                  // eagerly with a high-priority hint.
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
                          loading="eager"
                          fetchPriority="high"
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
          </div>
        </div>
      </ReportDialogProvider>
    </div>
  );
}
