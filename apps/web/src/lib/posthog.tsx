import { useEffect } from "react";
import posthog from "posthog-js";
import { useLocation } from "@tanstack/react-router";

const POSTHOG_KEY = (import.meta as any).env.VITE_PUBLIC_POSTHOG_KEY as
	| string
	| undefined;
const POSTHOG_HOST = (import.meta as any).env.VITE_PUBLIC_POSTHOG_HOST as
	| string
	| undefined;
const POSTHOG_UI_HOST = (import.meta as any).env.VITE_PUBLIC_POSTHOG_UI_HOST as
	| string
	| undefined;

let initialized = false;

function ensureInitialized() {
	if (initialized || typeof window === "undefined" || !POSTHOG_KEY) {
		return;
	}
	posthog.init(POSTHOG_KEY, {
		api_host: POSTHOG_HOST ?? "https://eu.i.posthog.com",
		// Proxied ingestion goes through our reverse proxy domain, but the
		// toolbar/session-recording links should still point at the real
		// PostHog app (EU region), not the proxy.
		ui_host: POSTHOG_UI_HOST ?? "https://eu.posthog.com",
		// We capture pageviews manually below so client-side (SPA) route
		// changes are tracked, not just the initial document load.
		capture_pageview: false,
		capture_pageleave: true,
		// Avoid creating person profiles for anonymous visitors.
		person_profiles: "identified_only",
		// L13 — cookieless analytics: no cookies, no localStorage, ever.
		// The default ("localStorage+cookie") plants a ph_* device id before
		// any consent, which is exactly the ANSPDCP cookie-fine category.
		// Memory persistence keeps events flowing (each visit is a fresh
		// anonymous id) while the fresh-load storage test stays green.
		persistence: "memory",
		disable_surveys: true,
		disable_session_recording: true,
	});
	initialized = true;
}

/**
 * Initializes PostHog on the client and captures a `$pageview` on every
 * client-side route change. Renders nothing.
 *
 * No-op when `VITE_PUBLIC_POSTHOG_KEY` is not set (e.g. local dev without
 * analytics), so the app keeps working without PostHog configured. Reads the
 * `posthog` singleton elsewhere via `import posthog from "posthog-js"` to
 * capture custom events.
 */
/**
 * Capture a custom product event. Safe no-op when PostHog is not configured
 * (local dev without a key) or before init, so callers never need to guard.
 */
export function captureEvent(
	name: string,
	properties?: Record<string, unknown>,
) {
	if (typeof window === "undefined" || !POSTHOG_KEY || !initialized) {
		return;
	}
	posthog.capture(name, properties);
}

export function PostHogAnalytics() {
	const location = useLocation();

	useEffect(() => {
		ensureInitialized();
	}, []);

	useEffect(() => {
		if (typeof window === "undefined" || !POSTHOG_KEY || !initialized) {
			return;
		}
		posthog.capture("$pageview", { $current_url: window.location.href });
	}, [location.href]);

	return null;
}
