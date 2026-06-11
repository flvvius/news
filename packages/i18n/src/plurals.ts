import { getString, STRINGS, type Locale, type StringKey } from "./strings";

type CountableBaseKey = "event.articles" | "event.sourceCount";

/**
 * Resolve a pluralized "{count} …" label using Intl plural categories with
 * graceful fallback (Romanian uses one/few/other; English one/other).
 * Shared by the web event page and the native event screen.
 */
export function getPluralizedCountLabel(
  locale: Locale,
  baseKey: CountableBaseKey,
  count: number,
): string {
  const pluralCategory = new Intl.PluralRules(locale).select(count);
  const candidates = [
    `${baseKey}.${pluralCategory}`,
    `${baseKey}.other`,
    count === 1 ? `${baseKey}.one` : `${baseKey}.many`,
  ] as const;

  const resolvedKey =
    candidates.find(
      (candidate) => candidate in STRINGS[locale] || candidate in STRINGS.en,
    ) ?? `${baseKey}.many`;

  return getString(locale, resolvedKey as StringKey).replace(
    "{count}",
    String(count),
  );
}
