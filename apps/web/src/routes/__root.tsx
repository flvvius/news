import { lazy, Suspense } from "react";
import { Toaster } from "@/components/ui/sonner";
import { SITE } from "@/lib/seo";
import { Footer } from "@/components/layout/Footer";
import { MobileTabBar } from "@/components/layout/MobileTabBar";
import { MiezOnboarding } from "@/components/MiezOnboarding";
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
        { property: "og:image", content: SITE.ogImage },
        { property: "og:image:type", content: SITE.ogImageType },
        { property: "og:image:width", content: String(SITE.ogImageWidth) },
        { property: "og:image:height", content: String(SITE.ogImageHeight) },
        { property: "og:image:alt", content: title },
        { name: "twitter:card", content: "summary_large_image" },
        { name: "twitter:title", content: title },
        { name: "twitter:description", content: description },
        { name: "twitter:image", content: SITE.ogImage },
        { name: "twitter:image:alt", content: title },
        // Browser chrome follows the active theme: light/dark `--background`
        // tokens (index.css) rather than a single hard-coded colour.
        {
          name: "theme-color",
          media: "(prefers-color-scheme: light)",
          content: "oklch(0.99 0.002 80)",
        },
        {
          name: "theme-color",
          media: "(prefers-color-scheme: dark)",
          content: "oklch(0.14 0.008 270)",
        },
      ],
      links: [
        { rel: "stylesheet", href: appCss },
        { rel: "manifest", href: "/manifest.webmanifest" },
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
  const locale = context.locale ?? "en";
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
              <MiezOnboarding />
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
