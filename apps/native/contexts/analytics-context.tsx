import PostHog, { PostHogProvider } from "posthog-react-native";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import type { AnalyticsEvent } from "@/lib/analytics";
import {
  loadAnalyticsOptOut,
  saveAnalyticsOptOut,
  shouldEnableAnalytics,
} from "@/lib/analytics-consent";

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
 *
 * Consent (Ticket 5a): analytics runs under a legitimate-interest basis, so it
 * is ON by default but the user can opt out (Profile → Privacy). Opting out —
 * or simply not having loaded the persisted choice yet — gates the PostHog
 * client from being constructed, so an opted-out user never emits a single
 * event.
 */

const apiKey = process.env.EXPO_PUBLIC_POSTHOG_KEY?.trim();
// EU region by default: Biviant is an EU operator, so an unconfigured-host
// build must never default to the US ingest endpoint. Override only with an
// explicit EXPO_PUBLIC_POSTHOG_HOST.
const host =
  process.env.EXPO_PUBLIC_POSTHOG_HOST?.trim() || "https://eu.i.posthog.com";

const AnalyticsContext = createContext<PostHog | null>(null);

export type AnalyticsConsent = {
  /** True when the user has opted out of analytics. */
  optedOut: boolean;
  /** Whether the persisted choice has loaded yet. */
  isReady: boolean;
  /** Persist and apply an opt-out choice. */
  setOptedOut: (optedOut: boolean) => void;
};

const AnalyticsConsentContext = createContext<AnalyticsConsent | undefined>(
  undefined,
);

export function AnalyticsProvider({ children }: { children: ReactNode }) {
  const [optedOut, setOptedOutState] = useState(false);
  const [consentLoaded, setConsentLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    loadAnalyticsOptOut()
      .then((value) => {
        if (!cancelled) {
          setOptedOutState(value);
          setConsentLoaded(true);
        }
      })
      .catch(() => {
        if (!cancelled) setConsentLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const setOptedOut = useCallback((value: boolean) => {
    setOptedOutState(value);
    void saveAnalyticsOptOut(value);
  }, []);

  const client = useMemo(() => {
    if (
      !shouldEnableAnalytics({
        hasApiKey: Boolean(apiKey),
        consentLoaded,
        optedOut,
      })
    ) {
      return null;
    }
    const created = new PostHog(apiKey as string, { host });
    try {
      // Ticket 16: tag dev/internal devices so funnels can exclude them. A
      // super property rides on every event for filtering/cohorts in PostHog.
      const isInternal =
        (typeof __DEV__ !== "undefined" && __DEV__) ||
        process.env.EXPO_PUBLIC_INTERNAL_DEVICE === "true";
      created.register({
        is_internal_device: isInternal,
        app_environment: isInternal ? "development" : "production",
      });
    } catch {
      // Best-effort.
    }
    return created;
  }, [consentLoaded, optedOut]);

  const consent = useMemo<AnalyticsConsent>(
    () => ({ optedOut, isReady: consentLoaded, setOptedOut }),
    [optedOut, consentLoaded, setOptedOut],
  );

  return (
    <AnalyticsConsentContext.Provider value={consent}>
      {client ? (
        <AnalyticsContext.Provider value={client}>
          <PostHogProvider client={client} autocapture={false}>
            {children}
          </PostHogProvider>
        </AnalyticsContext.Provider>
      ) : (
        <AnalyticsContext.Provider value={null}>
          {children}
        </AnalyticsContext.Provider>
      )}
    </AnalyticsConsentContext.Provider>
  );
}

export function useAnalyticsConsent(): AnalyticsConsent {
  const consent = useContext(AnalyticsConsentContext);
  if (!consent) {
    throw new Error(
      "useAnalyticsConsent must be used within AnalyticsProvider",
    );
  }
  return consent;
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
