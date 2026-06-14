import PostHog, { PostHogProvider } from "posthog-react-native";
import {
  createContext,
  useContext,
  useMemo,
  type ReactNode,
} from "react";

import type { AnalyticsEvent } from "@/lib/analytics";

/**
 * PostHog is the funnel transport for guest-first onboarding. We construct the
 * client ourselves and hand it to both `PostHogProvider` (for app-lifecycle
 * autocapture + background flushing) and our own context, so `useAnalytics`
 * exposes a small *typed* surface instead of the raw `capture(string, ...)`.
 *
 * Screen-view and touch autocapture stay off on purpose: the spec defines an
 * explicit, named funnel (`lib/analytics.ts`), and autocapture would bury those
 * 14 events in noise. App-lifecycle events stay on (default) — they cost
 * nothing and anchor the funnel to sessions.
 *
 * When no API key is configured (local dev), we mount no client and every
 * call no-ops. Analytics is best-effort and must never block the app booting
 * or a user action — mirroring the existing "logging never surfaces to the
 * user" convention across the codebase.
 */

const apiKey = process.env.EXPO_PUBLIC_POSTHOG_KEY?.trim();
// EU region by default: Biviant is an EU operator, so an unconfigured-host
// build must never default to the US ingest endpoint. Override only with an
// explicit EXPO_PUBLIC_POSTHOG_HOST.
const host =
  process.env.EXPO_PUBLIC_POSTHOG_HOST?.trim() || "https://eu.i.posthog.com";

const AnalyticsContext = createContext<PostHog | null>(null);

export function AnalyticsProvider({ children }: { children: ReactNode }) {
  const client = useMemo(() => {
    if (!apiKey) return null;
    return new PostHog(apiKey, { host });
  }, []);

  if (!client) {
    return (
      <AnalyticsContext.Provider value={null}>
        {children}
      </AnalyticsContext.Provider>
    );
  }

  return (
    <AnalyticsContext.Provider value={client}>
      <PostHogProvider client={client} autocapture={false}>
        {children}
      </PostHogProvider>
    </AnalyticsContext.Provider>
  );
}

/** JSON-safe person-property values accepted by PostHog's identify. */
type AnalyticsPropertyValue = string | number | boolean | null;

export type Analytics = {
  /** Emit a typed funnel event. No-ops when analytics is unconfigured. */
  track: (event: AnalyticsEvent) => void;
  /**
   * Bind the anonymous device identity to a real account at signup. PostHog
   * stitches the pre-signup funnel to the user via its persisted distinct ID.
   */
  identifyUser: (
    userId: string,
    properties?: Record<string, AnalyticsPropertyValue>,
  ) => void;
  /** Alias the current (anonymous) distinct ID to another id. */
  aliasUser: (alias: string) => void;
  /**
   * Persist the device UUID as a super property so every event — including
   * anonymous, pre-signup ones — carries it for guest→account funnel
   * stitching.
   */
  registerDeviceId: (deviceId: string) => void;
  /** Clear identity on logout so the next guest session starts clean. */
  reset: () => void;
};

export function useAnalytics(): Analytics {
  const client = useContext(AnalyticsContext);

  return useMemo<Analytics>(
    () => ({
      track: (event) => {
        try {
          const properties =
            "properties" in event ? event.properties : undefined;
          client?.capture(event.name, properties);
        } catch {
          // Funnel emission is best-effort; never let it surface to the user.
        }
      },
      identifyUser: (userId, properties) => {
        try {
          client?.identify(userId, properties);
        } catch {
          // Best-effort.
        }
      },
      aliasUser: (alias) => {
        try {
          client?.alias(alias);
        } catch {
          // Best-effort.
        }
      },
      registerDeviceId: (deviceId) => {
        try {
          client?.register({ device_uuid: deviceId });
        } catch {
          // Best-effort.
        }
      },
      reset: () => {
        try {
          client?.reset();
        } catch {
          // Best-effort.
        }
      },
    }),
    [client],
  );
}
