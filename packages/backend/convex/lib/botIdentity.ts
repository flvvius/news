/**
 * L6 — single crawler identity for every outbound fetch. Provable good-faith
 * crawling starts with being identifiable: an honest product token and a link
 * to the bot page (what we do + how to opt out).
 */

import { BOT_UA_TOKEN } from "./tdmPolicy";

export const BOT_INFO_URL = "https://biviant.com/bot";

export const BOT_USER_AGENT = `${BOT_UA_TOKEN}/1.0 (+${BOT_INFO_URL})`;

/** Standard headers for every outbound request to third-party sites. */
export function botFetchHeaders(
  extra?: Record<string, string>,
): Record<string, string> {
  return {
    "User-Agent": BOT_USER_AGENT,
    ...extra,
  };
}
