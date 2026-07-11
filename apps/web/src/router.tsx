import {
  createRouter as createTanStackRouter,
  Link,
  type AnyRouter,
} from "@tanstack/react-router";
// Only PURE values may be imported from router-core here: Vite's dev
// prebundle gives this direct import a DIFFERENT module instance than the
// one running inside @tanstack/react-router, so stateful exports (e.g.
// scrollRestorationCache) are dead copies. sessionStorage is the only
// shared channel.
import {
  defaultGetScrollRestorationKey,
  storageKey as scrollRestorationStorageKey,
} from "@tanstack/router-core";
import { QueryClient } from "@tanstack/react-query";
import { routerWithQueryClient } from "@tanstack/react-router-with-query";
import { ConvexQueryClient } from "@convex-dev/react-query";
import { ConvexProvider, ConvexReactClient } from "convex/react";
import { useT } from "@/lib/i18n/LocaleContext";
import { routeTree } from "./routeTree.gen";
import Loader from "./components/loader";
import "./index.css";

function NotFound() {
	const t = useT();
	return (
		<div className="container mx-auto max-w-4xl px-4 py-16 text-center">
			<h1 className="mb-2 text-2xl font-semibold">{t("router.notFound")}</h1>
			<Link to="/feed" className="text-primary underline">
				{t("router.backToFeed")}
			</Link>
		</div>
	);
}

export function getRouter(): AnyRouter {
	const CONVEX_URL = (import.meta as any).env.VITE_CONVEX_URL!;
	if (!CONVEX_URL) {
		throw new Error(
			"Missing VITE_CONVEX_URL environment variable. Run `pnpm dev:setup` to configure Convex.",
		);
	}
	const convex = new ConvexReactClient(CONVEX_URL, {
		unsavedChangesWarning: false,
	});

	const convexQueryClient = new ConvexQueryClient(convex);

	const queryClient: QueryClient = new QueryClient({
		defaultOptions: {
			queries: {
				queryKeyHashFn: convexQueryClient.hashFn(),
				queryFn: convexQueryClient.queryFn(),
			},
		},
	});
	convexQueryClient.connect(queryClient);

	const router = routerWithQueryClient(
		createTanStackRouter({
			routeTree,
			defaultPreload: "intent",
			// BIV-815: without this, TanStack Router keeps the current scroll
			// offset across navigations, so a new route opens mid-page. With it,
			// fresh navigations start at the top and history back/forward
			// restores the saved position (e.g. returning to the feed).
			scrollRestoration: true,
			scrollRestorationBehavior: "instant",
			defaultPendingComponent: () => <Loader />,
			defaultNotFoundComponent: NotFound,
			context: { queryClient, convexClient: convex, convexQueryClient },
			Wrap: ({ children }) => (
				<ConvexProvider client={convexQueryClient.convexClient}>
					{children}
				</ConvexProvider>
			),
		}),
		queryClient,
	);

	// BIV-815: two scroll-restoration gaps in @tanstack/router-core@1.144,
	// both fixed upstream in 1.17x — delete this whole block on that upgrade.
	//
	// 1. Fresh pushes can land mid-page: scroll positions are saved from a
	//    100ms-throttled handler that reads the CURRENT location at flush
	//    time, so a navigation landing inside that window records the
	//    previous page's offset under the NEW location's key, and
	//    restoreScroll then "restores" the fresh page to mid-scroll.
	//    → force PUSH navigations to the top.
	// 2. Back/forward restores against a page still at loader height: the
	//    restore fires at onRendered, before data-driven routes have their
	//    content, so the scroll clamps near 0 and is never re-applied.
	//    → re-apply the stored offset as the page grows, until the user
	//    intervenes.
	//
	// Runs after the router's own onRendered restore (setupScrollRestoration
	// subscribes during router construction). Hash navigations keep their
	// scroll-into-view behavior.
	if (typeof window !== "undefined") {
		const storedWindowScroll = (
			key: string,
		): { scrollX: number; scrollY: number } | undefined => {
			try {
				const byKey = JSON.parse(
					window.sessionStorage.getItem(scrollRestorationStorageKey) || "{}",
				);
				return byKey[key]?.window;
			} catch {
				return undefined;
			}
		};

		let cancelReapply: (() => void) | undefined;
		const reapplyStoredScroll = (target: {
			scrollX: number;
			scrollY: number;
		}) => {
			cancelReapply?.();
			let cancelled = false;
			const deadline = Date.now() + 3000;
			// Any input means the user has engaged with the page as-is;
			// yanking them to the stored offset after that would be worse
			// than not restoring.
			const inputEvents = ["wheel", "touchstart", "keydown", "mousedown"];
			const cancel = () => {
				cancelled = true;
				for (const name of inputEvents) {
					window.removeEventListener(name, cancel);
				}
			};
			cancelReapply = cancel;
			for (const name of inputEvents) {
				window.addEventListener(name, cancel, { passive: true });
			}
			const tick = () => {
				if (cancelled) return;
				const maxY =
					document.documentElement.scrollHeight - window.innerHeight;
				if (maxY >= target.scrollY) {
					window.scrollTo({
						top: target.scrollY,
						left: target.scrollX,
						behavior: "instant",
					});
					cancel();
					return;
				}
				if (Date.now() > deadline) {
					cancel();
					return;
				}
				// Coarse polling: the page grows in data-fetch chunks, not per
				// frame, and 100ms of extra scroll delay is imperceptible next
				// to the network wait that caused it.
				setTimeout(tick, 100);
			};
			tick();
		};

		let lastHistoryAction: string | undefined;
		router.history.subscribe(({ action }: { action: { type: string } }) => {
			lastHistoryAction = action.type;
		});
		router.subscribe("onRendered", (event) => {
			cancelReapply?.();
			if (event.toLocation.hash) return;
			if (lastHistoryAction === "PUSH") {
				// This scroll also heals a poisoned cache entry: router-core's
				// writer records the corrected position under the new location's
				// key ~100ms later, so a later Forward revisit restores 0.
				window.scrollTo({ top: 0, left: 0, behavior: "instant" });
				return;
			}
			// Only history traversals have a stored position worth re-applying;
			// REPLACE and the initial load keep whatever the router's own
			// restore did.
			if (
				lastHistoryAction !== "BACK" &&
				lastHistoryAction !== "FORWARD" &&
				lastHistoryAction !== "GO"
			) {
				return;
			}
			// Read NOW: ~100ms after a clamped restore, router-core's writer
			// overwrites the stored offset with the clamped position.
			const stored = storedWindowScroll(
				defaultGetScrollRestorationKey(event.toLocation),
			);
			if (stored && stored.scrollY > window.scrollY + 1) {
				reapplyStoredScroll(stored);
			}
		});
	}

	return router;
}

declare module "@tanstack/react-router" {
	interface Register {
		router: ReturnType<typeof getRouter>;
	}
}
