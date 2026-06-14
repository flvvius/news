/**
 * Error monitoring seam (Ticket 17).
 *
 * PostHog is product analytics, not crash/exception tracking. This module is
 * the single integration point for Sentry (or equivalent). It is intentionally
 * a no-op until `@sentry/react-native` is installed and a DSN is configured,
 * because wiring the SDK requires a native rebuild (config gate C2) that hasn't
 * happened yet. Call sites use it now so turning Sentry on is a one-file change.
 *
 * To activate: install `@sentry/react-native`, set EXPO_PUBLIC_SENTRY_DSN, and
 * fill in the two functions below (Sentry.init / Sentry.captureException).
 */

const dsn = process.env.EXPO_PUBLIC_SENTRY_DSN?.trim();

let initialized = false;

export function initErrorMonitoring(): void {
  if (initialized || !dsn) return;
  initialized = true;
  // TODO(T17): Sentry.init({ dsn, enableNative: true, tracesSampleRate: 0.2 });
}

/** Report a handled exception. No-ops until Sentry is wired. */
export function reportError(error: unknown, context?: Record<string, unknown>): void {
  if (!dsn) return;
  // TODO(T17): Sentry.captureException(error, { extra: context });
  void error;
  void context;
}

/** Whether error monitoring is configured (a DSN is present). */
export function isErrorMonitoringEnabled(): boolean {
  return Boolean(dsn);
}
