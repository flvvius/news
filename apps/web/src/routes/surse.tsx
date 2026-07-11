import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "convex/react";
import { api } from "@news-app/backend/convex/_generated/api";
import type { FunctionReturnType } from "convex/server";
import BiasIndicator from "@/components/bias-indicator";
import { getLocaleFromMatches } from "@/lib/i18n/getLocaleFromMatches";
import { useT } from "@/lib/i18n/LocaleContext";
import { getString } from "@/lib/i18n/strings";
import { SITE, absoluteSiteUrl } from "@/lib/seo";

export const Route = createFileRoute("/surse")({
  loader: async ({ context }) => {
    const client =
      context.convexQueryClient.serverHttpClient ?? context.convexClient;
    try {
      return await client.query(api.sources.listPublicSources, {});
    } catch (error) {
      console.error("[Route loader] Failed to load sources index:", error);
      return null;
    }
  },
  head: ({ matches }) => {
    const locale = getLocaleFromMatches(matches);
    const title = getString(locale, "sources.index.metaTitle");
    const description = getString(locale, "sources.index.metaDescription");

    return {
      meta: [
        { title },
        { name: "description", content: description },
        { property: "og:title", content: title },
        { property: "og:description", content: description },
        { property: "og:site_name", content: SITE.name },
        { property: "og:type", content: "website" },
        { property: "og:url", content: absoluteSiteUrl("/surse") },
        { property: "og:image", content: SITE.ogImage },
        { name: "twitter:card", content: "summary_large_image" },
        { name: "twitter:title", content: title },
        { name: "twitter:description", content: description },
        { name: "twitter:image", content: SITE.ogImage },
      ],
      links: [{ rel: "canonical", href: absoluteSiteUrl("/surse") }],
    };
  },
  component: SourcesIndexPage,
});

function SourcesIndexPage() {
  const t = useT();
  const loaderData = Route.useLoaderData();
  const liveSources = useQuery(api.sources.listPublicSources);
  const sources = (liveSources ?? loaderData) as
    | FunctionReturnType<typeof api.sources.listPublicSources>
    | null
    | undefined;

  return (
    <div className="bg-background">
      <div className="container mx-auto max-w-4xl px-4 py-6 sm:py-10">
        <div className="flex flex-col gap-6">
          <header className="flex flex-col gap-2 border-b border-border pb-4">
            <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
              {t("sources.index.title")}
            </h1>
            <p className="text-sm text-muted-foreground">
              {t("sources.index.intro")}
            </p>
            <Link
              to="/sursele-noastre"
              className="text-sm text-muted-foreground underline hover:text-foreground"
            >
              {t("sources.index.methodology")}
            </Link>
          </header>

          {!sources || sources.length === 0 ? (
            <p className="py-8 text-sm text-muted-foreground">
              {t("sources.index.empty")}
            </p>
          ) : (
            <ul className="flex flex-col divide-y divide-border">
              {sources.map((source) => (
                <li key={source._id}>
                  <Link
                    to="/source/$sourceId"
                    params={{ sourceId: source._id }}
                    className="flex items-center gap-4 py-4 transition-colors hover:bg-muted/40"
                  >
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border/70 bg-background">
                      {source.logoUrl ? (
                        <img
                          src={source.logoUrl}
                          alt=""
                          loading="lazy"
                          width={40}
                          height={40}
                          className="h-full w-full object-contain p-1.5"
                        />
                      ) : (
                        <span className="text-sm font-semibold">
                          {source.name.charAt(0)}
                        </span>
                      )}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium text-foreground">
                        {source.name}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {source.domain}
                      </span>
                    </span>
                    <span className="flex shrink-0 items-center gap-3">
                      <BiasIndicator bias={source.baseBias} size="sm" />
                      <span className="text-xs text-muted-foreground">
                        {t("source.reliability").replace(
                          "{score}",
                          String(source.reliabilityScore),
                        )}
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
