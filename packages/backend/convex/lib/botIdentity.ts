/**
 * L6 — single crawler identity for every outbound fetch. Provable good-faith
 * crawling starts with being identifiable: an honest product token, a link
 * to the bot page (what we do + how to opt out), and a From contact header.
 *
 * NOTE: contact@biviant.com must be provisioned before launch — tracked in
 * FOOTER_TODO.md alongside the site contact mailbox.
 */

import { BOT_UA_TOKEN } from "./tdmPolicy";

export const BOT_INFO_URL = "https://biviant.com/bot";
export const BOT_CONTACT_EMAIL = "contact@biviant.com";

export const BOT_USER_AGENT = `${BOT_UA_TOKEN}/1.0 (+${BOT_INFO_URL}; ${BOT_CONTACT_EMAIL})`;

/** Standard headers for every outbound request to third-party sites. */
export function botFetchHeaders(
  extra?: Record<string, string>,
): Record<string, string> {
  return {
    "User-Agent": BOT_USER_AGENT,
    From: BOT_CONTACT_EMAIL,
    ...extra,
  };
}
