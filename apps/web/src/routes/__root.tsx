import { lazy, Suspense } from "react";
import { Toaster } from "@/components/ui/sonner";
import {
  INDEXABLE_ROBOTS,
  SITE,
  absoluteSiteUrl,
  defaultShareImageMeta,
} from "@/lib/seo";
import { Footer } from "@/components/layout/Footer";
import { MobileTabBar } from "@/components/layout/MobileTabBar";
import { LocaleProvider } from "@/lib/i18n/LocaleContext";
import { getLocaleFromMatches } from "@/lib/i18n/getLocaleFromMatches";
import { getServerLocale } from "@/lib/i18n/getServerLocale";
import { getString, type Locale } from "@/lib/i18n/strings";
import { themeNoFlashScript } from "@/lib/theme";
import { ThemeProvider } from "@/lib/theme/ThemeProvider";
import { api } from "@news-app/backend/convex/_generated/api";

import {
  HeadContent,
  Outlet,
  Scripts,
  createRootRouteWithContext,
  useRouteContext,
} from "@tanstack/react-router";
import Header from "../components/header";
import appCss from "../index.css?url";
import type { QueryClient } from "@tanstack/react-query";
import type { ConvexQueryClient } from "@convex-dev/react-query";
import type { ConvexReactClient } from "convex/react";

import { createServerFn } from "@tanstack/react-start";
import { ConvexBetterAuthProvider } from "@convex-dev/better-auth/react";
import { authClient } from "@/lib/auth-client";
import { getToken } from "@/lib/auth-server";
import { PostHogAnalytics } from "@/lib/posthog";

const fetchAuth = createServerFn({ method: "GET" }).handler(async () => {
  const token = await getToken();
  return { token };
});

/**
 * Browser-chrome colour per theme: the light/dark `--background` tokens from
 * index.css. Rendered as raw <head> children rather than through the route's
 * `meta`, because HeadContent keys meta by name only and would keep just one
 * of the two.
 */
const THEME_COLOR_META = [
  { media: "(prefers-color-scheme: light)", content: "oklch(0.99 0.002 80)" },
  { media: "(prefers-color-scheme: dark)", content: "oklch(0.14 0.008 270)" },
] as const;

const TanStackRouterDevtools = import.meta.env.DEV
  ? lazy(() =>
      import("@tanstack/react-router-devtools").then((module) => ({
        default: module.TanStackRouterDevtools,
      })),
    )
  : null;

function getExistingAuthContext(
  matches: Array<{ context: unknown }>,
): RootContextState {
  const rootContext = matches[0]?.context;
  if (!rootContext || typeof rootContext !== "object") {
    return {};
  }

  const token =
    "token" in rootContext && typeof rootContext.token === "string"
      ? rootContext.token
      : undefined;
  const isAuthenticated =
    "isAuthenticated" in rootContext &&
    typeof rootContext.isAuthenticated === "boolean"
      ? rootContext.isAuthenticated
      : undefined;
  const locale =
    "locale" in rootContext ? getLocaleFromMatches([{ context: rootContext }]) : undefined;

  return { token, isAuthenticated, locale };
}

type RootContextState = {
  token?: string;
  isAuthenticated?: boolean;
  locale?: Locale;
};

export interface RouterAppContext {
  queryClient: QueryClient;
  convexClient: ConvexReactClient;
  convexQueryClient: ConvexQueryClient;
}

export const Route = createRootRouteWithContext<RouterAppContext>()({
  head: ({ matches }) => {
    const locale = getLocaleFromMatches(matches);
    const title = getString(locale, "seo.siteTitle");
    const description = getString(locale, "seo.siteDescription");
    // Opening the Convex connection is on the critical path of every page (the
    // live subscription fires the moment React hydrates), so warm the TLS
    // handshake from the document head instead of paying for it after the
    // bundle parses. Skipped when the URL is unset/malformed at build time.
    const convexOrigin = (() => {
      const raw = import.meta.env.VITE_CONVEX_URL;
      if (!raw) return null;
      try {
        return new URL(raw).origin;
      } catch {
        return null;
      }
    })();

    return {
      meta: [
        { charSet: "utf-8" },
        {
          name: "viewport",
          // viewport-fit=cover is required for env(safe-area-inset-*) to
          // resolve to non-zero on iOS; without it the tab bar's home-indicator
          // padding is dead and the bar sits in the unsafe area (BIV-810).
          content: "width=device-width, initial-scale=1, viewport-fit=cover",
        },
        { title },
        { name: "description", content: description },
        { property: "og:site_name", content: SITE.name },
        { property: "og:type", content: "website" },
        { property: "og:title", content: title },
        { property: "og:description", content: description },
        ...defaultShareImageMeta(),
        { name: "twitter:card", content: "summary_large_image" },
        { name: "twitter:title", content: title },
        { name: "twitter:description", content: description },
        { property: "og:locale", content: locale === "ro" ? "ro_RO" : "en_US" },
        // Site-wide indexing default. Bare `index, follow` is already the
        // implicit default; the value here exists for the preview limits —
        // `max-image-preview:large` is what makes an event eligible for the
        // large-image treatment in Google News/Discover, and `max-snippet:-1`
        // lets answer engines quote a full summary instead of ~160 chars.
        // Routes that must stay unindexed emit their own `robots` meta, which
        // TanStack dedupes by name so the last one (theirs) wins.
        { name: "robots", content: INDEXABLE_ROBOTS },
        // NOTE: the two media-scoped `theme-color` tags are NOT declared here.
        // HeadContent dedupes meta by `name`/`property` alone and ignores
        // `media`, so declaring both collapsed them to one — the light variant
        // was dropped from every page and light-mode browser chrome rendered
        // with the dark background. They are emitted directly in <head> from
        // RootDocument instead; see THEME_COLOR_META.
      ],
      links: [
        { rel: "stylesheet", href: appCss },
        ...(convexOrigin
          ? [
              {
                rel: "preconnect",
                href: convexOrigin,
                // `as const`: inside a conditional spread TS widens the
                // literal to `string`, which does not satisfy `CrossOrigin`.
                crossOrigin: "anonymous" as const,
              },
              { rel: "dns-prefetch", href: convexOrigin },
            ]
          : []),
        { rel: "manifest", href: "/manifest.webmanifest" },
        // Site-wide RSS discovery (SEO-3): feed readers and crawlers pick this
        // up from any page.
        {
          rel: "alternate",
          type: "application/rss+xml",
          title: SITE.name,
          href: absoluteSiteUrl("/rss.xml"),
        },
        // AEO: llmstxt.org index, discoverable from any page rather than only
        // by crawlers that guess /llms.txt.
        {
          rel: "alternate",
          type: "text/plain",
          title: `${SITE.name} llms.txt`,
          href: absoluteSiteUrl("/llms.txt"),
        },
        // SVG mark first (modern browsers); PNG kept as the legacy fallback.
        { rel: "icon", type: "image/svg+xml", href: "/favicon.svg" },
        { rel: "icon", type: "image/png", href: "/logo-mark.png" },
        { rel: "apple-touch-icon", href: "/apple-touch-icon.png" },
        {
          rel: "preload",
          href: "/fonts/inter-latin-wght-normal.woff2",
          as: "font",
          type: "font/woff2",
          crossOrigin: "anonymous",
        },
      ],
    };
  },

  component: RootDocument,
  // TanStack Router (v1.132) types the root route's `beforeLoad` return as
  // `never`, so returning the resolved auth/locale context — which descendants
  // read via `useRouteContext` — trips TS2322 despite being the correct runtime
  // contract. Suppress this known-incorrect type error only; if a future router
  // version fixes the inference, @ts-expect-error will flag itself for removal.
  // @ts-expect-error -- root beforeLoad return-context typing limitation
  beforeLoad: async (ctx): Promise<RootContextState> => {
    // During intent preloading we avoid extra round-trips and keep existing
    // auth/locale context. During real client invalidations/navigation we
    // still re-resolve locale so cookie changes apply immediately.
    if (ctx.preload) {
      return getExistingAuthContext(ctx.matches);
    }

    if (typeof document !== "undefined") {
      const existing = getExistingAuthContext(ctx.matches);
      const searchLocale = new URLSearchParams(window.location.search).get("lang");
      const cookieLocale =
        document.cookie
          .split("; ")
          .find((entry) => entry.startsWith("bv_locale="))
          ?.split("=")[1] ?? null;
      let decodedCookieLocale: string | null = null;
      if (cookieLocale) {
        try {
          decodedCookieLocale = decodeURIComponent(cookieLocale);
        } catch {
          decodedCookieLocale = null;
        }
      }

      if (
        existing.locale &&
        (!searchLocale || searchLocale === existing.locale) &&
        (!decodedCookieLocale || decodedCookieLocale === existing.locale)
      ) {
        return existing;
      }

      let userPreference: string | null = null;
      if (existing.isAuthenticated) {
        try {
          const currentUser = await ctx.context.convexClient.query(
            api.user.getCurrentUser,
            {},
          );
          userPreference = currentUser?.profile?.preferredLanguage ?? null;
        } catch (error) {
          console.warn(
            "Failed to resolve client-side user locale preference:",
            error,
          );
        }
      }

      const locale = await getServerLocale({
        data: {
          userPreference,
        },
      });

      return {
        ...existing,
        locale,
      };
    }

    const { token } = await fetchAuth();
    let userPreference: string | null = null;
    if (token) {
      ctx.context.convexQueryClient.serverHttpClient?.setAuth(token);
      try {
        const currentUser =
          await ctx.context.convexQueryClient.serverHttpClient?.query(
            api.user.getCurrentUser,
            {},
          );
        userPreference = currentUser?.profile?.preferredLanguage ?? null;
      } catch (error) {
        console.warn("Failed to resolve current user locale preference:", error);
        userPreference = null;
      }
    }
    const locale = await getServerLocale({ data: { userPreference } });
    return {
      token,
      isAuthenticated: !!token,
      locale,
    };
  },
});

function RootDocument() {
  const context = useRouteContext({ strict: false }) as RouterAppContext &
    RootContextState;
  const locale = context.locale ?? "ro";
  return (
    <ConvexBetterAuthProvider
      client={context.convexClient}
      authClient={authClient}
      initialToken={context.token}
    >
      <LocaleProvider locale={locale}>
        <html
          lang={locale}
          className="bg-background"
          suppressHydrationWarning
        >
          <head>
            <script
              dangerouslySetInnerHTML={{ __html: themeNoFlashScript }}
              suppressHydrationWarning
            />
            {THEME_COLOR_META.map((entry) => (
              <meta
                key={entry.media}
                name="theme-color"
                media={entry.media}
                content={entry.content}
              />
            ))}
            <HeadContent />
          </head>
          <body className="min-h-svh flex flex-col antialiased">
            <ThemeProvider>
              <div className="hidden h-14 md:block">
                <Header />
              </div>
              {/* 4rem clears the ~3.5rem mobile tab bar plus breathing room;
                  the safe-area term matches the bar's own inset padding. */}
              <main className="flex-1 pb-[calc(4rem+var(--safe-area-bottom))] md:pb-0">
                <Outlet />
              </main>
              <Footer />
              <MobileTabBar />
              {/* Lift mobile toasts above the fixed tab bar + home indicator. */}
              <Toaster
                richColors
                mobileOffset={{ bottom: "calc(4rem + var(--safe-area-bottom))" }}
              />
              <PostHogAnalytics />
              {TanStackRouterDevtools && (
                <Suspense fallback={null}>
                  <TanStackRouterDevtools position="bottom-left" />
                </Suspense>
              )}
            </ThemeProvider>
            <Scripts />
          </body>
        </html>
      </LocaleProvider>
    </ConvexBetterAuthProvider>
  );
}
