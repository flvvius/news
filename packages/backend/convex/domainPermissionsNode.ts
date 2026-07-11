"use node";

/**
 * L5 — network resolver for domain TDM permissions. Checks, in order:
 * TDM-Reservation header → /.well-known/tdmrep.json → HTML tdm-reservation
 * meta → robots.txt (our token, *, AI-convention tokens) → noai meta /
 * X-Robots-Tag → /ai.txt. Results are cached 24h in domainPermissions.
 */

import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import type { ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import {
  BOT_UA_TOKEN,
  evaluateTdmSignals,
  normalizeDomain,
  robotsCrawlDelay,
  type DomainPermissionState,
} from "./lib/tdmPolicy";

const RESOLVER_TIMEOUT_MS = 8000;
const RESOLVER_USER_AGENT = `${BOT_UA_TOKEN}/1.0 (+https://biviant.com/bot)`;

async function fetchWithTimeout(
  url: string,
): Promise<{ ok: boolean; status: number; body?: string; headers?: Headers }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), RESOLVER_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        "User-Agent": RESOLVER_USER_AGENT,
      },
    });
    const body = response.ok ? await response.text() : undefined;
    return {
      ok: response.ok,
      status: response.status,
      body,
      headers: response.headers,
    };
  } catch {
    return { ok: false, status: 0 };
  } finally {
    clearTimeout(timer);
  }
}

export type ResolvedPermission = {
  domain: string;
  state: DomainPermissionState;
  signals: string[];
};

async function resolveDomain(domain: string): Promise<{
  state: DomainPermissionState;
  signals: string[];
  crawlDelaySeconds?: number;
  lastError?: string;
}> {
  const base = `https://${domain}`;

  const [homepage, tdmrep, robots, aiTxt] = await Promise.all([
    fetchWithTimeout(`${base}/`),
    fetchWithTimeout(`${base}/.well-known/tdmrep.json`),
    fetchWithTimeout(`${base}/robots.txt`),
    fetchWithTimeout(`${base}/ai.txt`),
  ]);

  // robots.txt semantics per RFC 9309: 4xx = no restrictions; network
  // failure / 5xx = unreachable → treat as restricted until resolved.
  const robotsUnreachable =
    !robots.ok && (robots.status === 0 || robots.status >= 500);

  const evaluation = evaluateTdmSignals({
    tdmReservationHeader: homepage.headers?.get("tdm-reservation"),
    tdmrepJson: tdmrep.ok ? tdmrep.body : undefined,
    homepageHtml: homepage.ok ? homepage.body?.slice(0, 200_000) : undefined,
    xRobotsTag: homepage.headers?.get("x-robots-tag"),
    robotsTxt: robots.ok ? robots.body : undefined,
    robotsTxtUnreachable: robotsUnreachable,
    aiTxt: aiTxt.ok ? aiTxt.body : undefined,
  });

  return {
    state: evaluation.state,
    signals: evaluation.signals,
    crawlDelaySeconds: robots.ok
      ? robotsCrawlDelay(robots.body ?? "", BOT_UA_TOKEN)
      : undefined,
    lastError:
      !homepage.ok && homepage.status === 0
        ? "homepage_unreachable"
        : undefined,
  };
}

export const resolveDomainPermission = internalAction({
  args: { domain: v.string() },
  handler: async (ctx, args): Promise<ResolvedPermission> => {
    const domain = normalizeDomain(args.domain);
    const resolved = await resolveDomain(domain);
    const upserted: { state: DomainPermissionState } = await ctx.runMutation(
      internal.domainPermissions.upsertDomainPermission,
      {
        domain,
        state: resolved.state,
        signals: resolved.signals,
        crawlDelaySeconds: resolved.crawlDelaySeconds,
        lastError: resolved.lastError,
      },
    );
    console.log(
      `[domain-permissions] resolved ${domain} → ${upserted.state}${
        resolved.signals.length > 0 ? ` (${resolved.signals.join(", ")})` : ""
      }`,
    );
    return { domain, state: upserted.state, signals: resolved.signals };
  },
});

/**
 * Ensure fresh permission states for a set of domains (resolving stale or
 * missing entries) and return domain → state. Resolution failures fail
 * closed to rss_only for this run without caching the failure as a state.
 */
export async function ensureDomainPermissions(
  ctx: ActionCtx,
  domains: string[],
): Promise<Map<string, DomainPermissionState>> {
  const normalized = Array.from(new Set(domains.map(normalizeDomain)));
  const result = new Map<string, DomainPermissionState>();
  if (normalized.length === 0) return result;

  const cached: Array<{
    domain: string;
    state?: DomainPermissionState;
    expiresAt?: number;
    manualOverride?: boolean;
  }> = await ctx.runQuery(
    internal.domainPermissions.getDomainPermissionsBatch,
    { domains: normalized },
  );

  const now = Date.now();
  const toResolve: string[] = [];
  for (const entry of cached) {
    if (
      entry.state &&
      ((entry.expiresAt ?? 0) > now || entry.manualOverride)
    ) {
      result.set(entry.domain, entry.state);
    } else {
      toResolve.push(entry.domain);
    }
  }

  for (const domain of toResolve) {
    try {
      const resolved: ResolvedPermission = await ctx.runAction(
        internal.domainPermissionsNode.resolveDomainPermission,
        { domain },
      );
      result.set(domain, resolved.state);
    } catch (error) {
      console.warn(
        `[domain-permissions] resolution failed for ${domain} — failing closed to rss_only: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      result.set(domain, "rss_only");
    }
  }
  return result;
}
