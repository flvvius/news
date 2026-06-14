/**
 * Stable topic boost (Ticket 12). The followed-topic boost must NOT re-order
 * rows the user has already seen as more pages load. So we boost ONLY the first
 * page's items (a stable partition: followed-topic stories rise above the rest,
 * but every story still appears — a boost, never a filter), and append every
 * later page in natural order below. The lead story is handled separately and
 * always stays position 1.
 *
 * `rest` is the feed minus the lead. `firstPageRestCount` is how many of those
 * belong to the first page (pageSize − 1, since the lead consumed one slot).
 */
export function stableTopicBoost<T>(
  rest: T[],
  firstPageRestCount: number,
  isFollowed: (item: T) => boolean,
): T[] {
  if (firstPageRestCount <= 0) return rest;

  const firstPage = rest.slice(0, firstPageRestCount);
  const laterPages = rest.slice(firstPageRestCount);

  const followed: T[] = [];
  const others: T[] = [];
  for (const item of firstPage) {
    (isFollowed(item) ? followed : others).push(item);
  }

  // Boosted first page (frozen), then later pages untouched in natural order.
  return [...followed, ...others, ...laterPages];
}
