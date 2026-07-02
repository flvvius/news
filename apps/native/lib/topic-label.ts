import type { StringKey } from "@news-app/i18n";

/**
 * i18n key for a topic's localized display name (`topic.<slug>`). The catalog
 * stores only an English `displayName`, so callers pass that as the `getString`
 * fallback — a slug without a translation simply renders the English name.
 */
export function topicLabelKey(slug: string): StringKey {
  return `topic.${slug}` as StringKey;
}
