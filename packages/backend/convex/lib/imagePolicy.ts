/**
 * L9 — og:image thumbnail policy. Three tiers:
 *  (a) favicons/source logos: allowed, may be cached small (share cards);
 *  (b) publisher og:image thumbnails: HOTLINK ONLY (never downloaded or
 *      rehosted), displayed small with attribution + link to the original,
 *      and only while the domain has not opted out (L5) and neither the
 *      global nor the per-domain kill switch is on;
 *  (c) full editorial images: never fetched, stored, or displayed.
 *
 * This helper is the single decision point used by the public event query
 * and the preview sync.
 */

import type { MutationCtx, QueryCtx } from "../_generated/server";

type Ctx = QueryCtx | MutationCtx;

function hostnameOf(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

/** May this (publisher-hosted) image URL be displayed as a thumbnail? */
export async function ogImageAllowed(
  ctx: Ctx,
  imageUrl: string | undefined | null,
): Promise<boolean> {
  if (!imageUrl) return false;

  // Global kill switch (config.value is JSON-encoded).
  const killSwitch = await ctx.db
    .query("config")
    .withIndex("by_key", (q) => q.eq("key", "og_image_display_enabled"))
    .unique();
  if (killSwitch) {
    try {
      if (JSON.parse(killSwitch.value) === false) return false;
    } catch {
      // Malformed config → fail open to the per-domain checks below.
    }
  }

  const host = hostnameOf(imageUrl);
  if (!host) return false;

  // Per-domain: L5 opt-out state or the explicit image kill switch. The
  // lookup walks up the domain (img.example.ro → example.ro).
  const parts = host.split(".");
  for (let i = 0; i < Math.max(1, parts.length - 1); i++) {
    const candidate = parts.slice(i).join(".");
    const permission = await ctx.db
      .query("domainPermissions")
      .withIndex("by_domain", (q) => q.eq("domain", candidate))
      .unique();
    if (permission) {
      if (permission.imagesDisabled) return false;
      if (permission.state !== "full") return false;
      return true;
    }
  }
  return true;
}

/** Strip an image URL unless the policy allows displaying it. */
export async function filterEventImage<
  T extends { imageUrl?: string | null },
>(ctx: Ctx, event: T): Promise<string | undefined> {
  return (await ogImageAllowed(ctx, event.imageUrl))
    ? (event.imageUrl ?? undefined)
    : undefined;
}
