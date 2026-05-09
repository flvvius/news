import { Toaster } from "@/components/ui/sonner";
import { SITE } from "@/lib/seo";

import {
  HeadContent,
  Outlet,
  Scripts,
  createRootRouteWithContext,
  useRouteContext,
} from "@tanstack/react-router";
import { TanStackRouterDevtools } from "@tanstack/react-router-devtools";
import Header from "../components/header";
import appCss from "../index.css?url";
import type { QueryClient } from "@tanstack/react-query";
import type { ConvexQueryClient } from "@convex-dev/react-query";
import type { ConvexReactClient } from "convex/react";

import { createServerFn } from "@tanstack/react-start";
import { ConvexBetterAuthProvider } from "@convex-dev/better-auth/react";
import { authClient } from "@/lib/auth-client";
import { getToken } from "@/lib/auth-server";

const fetchAuth = createServerFn({ method: "GET" }).handler(async () => {
  const token = await getToken();
  return { token };
});

function getExistingAuthContext(
  matches: Array<{ context: unknown }>,
): {
  token?: string;
  isAuthenticated?: boolean;
} {
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

  return { token, isAuthenticated };
}

export interface RouterAppContext {
  queryClient: QueryClient;
  convexClient: ConvexReactClient;
  convexQueryClient: ConvexQueryClient;
}

export const Route = createRootRouteWithContext<RouterAppContext>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: SITE.title },
      { name: "description", content: SITE.description },
      // Open Graph defaults (child routes override title/description)
      { property: "og:site_name", content: SITE.name },
      { property: "og:type", content: "website" },
      { property: "og:title", content: SITE.title },
      { property: "og:description", content: SITE.description },
      { property: "og:image", content: SITE.ogImage },
      // Twitter / X
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: SITE.title },
      { name: "twitter:description", content: SITE.description },
      { name: "twitter:image", content: SITE.ogImage },
      // PWA / browser chrome
      { name: "theme-color", content: "#0f172a" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      // Inter font — preload most critical weight (self-hosted)
      {
        rel: "preload",
        href: "/fonts/inter-latin-wght-normal.woff2",
        as: "font",
        type: "font/woff2",
        crossOrigin: "anonymous",
      },
    ],
  }),

  component: RootDocument,
  beforeLoad: async (ctx) => {
    // Only fetch the auth token during SSR. On the client, auth state is
    // already maintained by ConvexBetterAuthProvider and intent preloading
    // would otherwise hit this server function on every hover.
    if (typeof document !== "undefined" || ctx.preload) {
      return getExistingAuthContext(ctx.matches);
    }

    const { token } = await fetchAuth();
    if (token) {
      ctx.context.convexQueryClient.serverHttpClient?.setAuth(token);
    }
    return {
      token,
      isAuthenticated: !!token,
    };
  },
});

function RootDocument() {
  const context = useRouteContext({ from: Route.id });
  return (
    <ConvexBetterAuthProvider
      client={context.convexClient}
      authClient={authClient}
      initialToken={context.token}
    >
      <html lang="en" className="dark bg-background">
        <head>
          <HeadContent />
        </head>
        <body className="min-h-svh flex flex-col antialiased">
          <Header />
          <main className="flex-1">
            <Outlet />
          </main>
          <Toaster richColors />
          {import.meta.env.DEV && (
            <TanStackRouterDevtools position="bottom-left" />
          )}
          <Scripts />
        </body>
      </html>
    </ConvexBetterAuthProvider>
  );
}
