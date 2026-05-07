# Query and Compute Optimization Plan (May 2026)

## Goals

- Cut clustering-related DB bandwidth by at least 70-90%.
- Reduce auth-related function calls to a low, steady baseline for current user volume.
- Reduce OG share asset compute by caching and skipping redundant renders.
- Keep functionality unchanged while making reads smaller and indexed.

## Current Hotspots (from code)

- Clustering candidate selection still fans out on articles, topics, and embeddings per event in packages/backend/convex/clustering.ts (getRecentClusterCandidates, findBestCandidate, attachArticleToEvent, refreshEventPresentation).
- eventEmbeddings already has a vector index in packages/backend/convex/schema.ts but findBestCandidate still does JS cosine scans.
- refreshEventPresentation scans all articles for an event and loads each source per attach.
- share asset rendering pulls full event + article + source data in packages/backend/convex/shareAssets.ts and packages/backend/convex/shareAssetsNode.ts, and is triggered on most event updates.
- aiBudget uses full-table scans of aiUsage and aiBudgetReservations in packages/backend/convex/aiBudget.ts.
- Public event preview and feed queries load full article lists in packages/backend/convex/events.ts (enrichEventsWithTopicsAndSources).
- Cron cadence is moderate (30 min for clustering/merge) in packages/backend/convex/crons.ts.

## Plan (Highest ROI first)

### 0) Baseline and verification gates

- Capture current Convex dashboard metrics for:
  - clustering.getRecentClusterCandidates bandwidth
  - shareAssetsNode.generateEventShareAsset action compute
  - aiBudget read bandwidth
  - auth adapter findMany call volume
- Add temporary structured logs to clusterEnrichedArticles and merge/recluster actions to record:
  - number of candidate rows fetched
  - number of articles clustered
  - time spent in candidate selection
- Define acceptance targets per step before coding (see Verification section below).

### 0.5) Auth call volume quick audit (10 min)

Goal: confirm auth is no longer a dominant driver before deeper changes.

Audit

- Check the 30-day function-call trend; if volume is not clearly falling, treat auth as a top-2 issue.
- Confirm cookieCache is hit in packages/backend/convex/auth.ts.
- Inspect /api/auth traffic patterns and verify no client loop in web or native.
- Validate that SSR-only fetchAuth is not called on the client (apps/web/src/routes/\_\_root.tsx).

Mitigations (only if the trend is still high)

- Increase cookieCache.maxAge (e.g., 10-15 min) if cache misses are common.
- For native, confirm session refresh cadence and avoid repeated sign-in or get-session calls.
- Add rate limiting or request coalescing for auth checks in clients if needed.

### 1) Early-bail when no enriched articles

Goal: avoid loading candidates when the cron run has no work.

Changes (packages/backend/convex/clustering.ts)

- In clusterEnrichedArticles, check the count of enriched articles via index before loading candidates.
- If zero, release lock and return immediately.

### 2) Candidacy snapshot table (structural fix)

Goal: remove per-candidate article fanout entirely.

Schema (packages/backend/convex/schema.ts)

- Add eventCandidacy table with small, read-optimized fields:
  - eventId, status
  - firstPublishedAt
  - titleTokens, evidenceTokens, factTokens, entityTokens
  - topicSlugs
  - lastSummarySignature, perspectiveSource (optional, if needed for tie-breaks)
- Cap token arrays (e.g., <= 200 per field) to keep rows small and bounded.
- Indexes:
  - by_event
  - by_status_firstPublishedAt (status, firstPublishedAt)

Write path updates (packages/backend/convex/clustering.ts)

- createEventFromArticle: create eventCandidacy row on insert.
- attachArticleToEvent: update candidacy row (merge tokens, update topic slugs) without collecting all articles.
- mergeEvents: merge candidacy rows and delete the removed row.

Read path updates

- Replace getRecentClusterCandidates to query eventCandidacy directly, then join minimal event fields by eventId.
- Add internal query getCandidatesByEventIds or getCandidatesByEmbeddingIds to fetch candidacy rows for vector search results.

Backfill plan

- Add a backfill action/mutation to generate candidacy rows for existing events in batches (cron or manual trigger).
- Alternatively, add lazy creation: if candidacy row is missing, compute once and upsert.

Migration safety

- Add new indexes additively; keep legacy code paths behind a config flag for one rollout window.
- Remove legacy paths only after bandwidth and correctness targets are met.

### 3) Use vectorSearch for candidate selection

Goal: avoid JS brute-force similarity and reduce candidate set to top-K.

Changes (packages/backend/convex/clustering.ts)

- In clusterEnrichedArticles, for each article embedding:
  - Use ctx.vectorSearch on eventEmbeddings.by_embedding with limit K (e.g., 20).
- Note: vectorSearch is action-only; do not call it from mutations.
- For filtering by status, add filterFields to the vector index and denormalize status onto eventEmbeddings:
  - eventEmbeddings: add status field and keep it in sync with events.
  - vectorIndex: filterFields: ["status"].
- If filterFields are not in place yet, filter out stale rows after fetch.
- Fetch candidacy rows for the resulting eventEmbedding IDs and pass those into findBestCandidate.
- Refactor findBestCandidate to accept vectorSearch similarity scores and remove JS cosine loops.
- Drop memberEmbeddings fetches from getRecentClusterCandidates; they should not be needed once vector search is in use.

Follow-on for merge/recluster

- For mergeNearDuplicateEvents and reclusterRecentSingletonEvents, use a smaller candidate set:
  - Either build pairs from candidacy rows within a recent window and limit count, or
  - Use vectorSearch per event embedding to find its nearest neighbors and only compare those pairs.

### 4) Maintain counts and source sets on events

Goal: remove per-event article collects for counts and source lists.

Schema changes

- Add fields on events:
  - articleCount (number)
  - sourceCount (number)
  - sourceIds (array of Id or string)
  - lastArticleAt (number)

Write path updates (packages/backend/convex/clustering.ts)

- createEventFromArticle: initialize counts and sources.
- attachArticleToEvent: increment counts, update sourceIds set, update lastArticleAt.
- mergeEvents: merge counts, sourceIds, and lastArticleAt.

Read path updates

- refreshEventPresentation and share asset render data should read these fields instead of collecting all articles when possible.
- events feed queries (packages/backend/convex/events.ts) should use stored counts to avoid loading every article.

### 5) Refresh presentation without full scans

Goal: reduce per-attach bandwidth for presentation updates.

Changes (packages/backend/convex/clustering.ts)

- Add articles index by_event_publishedAt (eventId, publishedAt) to support ordered reads.
- In refreshEventPresentation:
  - Read only top N recent articles (e.g., 10) via withIndex + order.
  - Cache source lookups in a Map to avoid repeated ctx.db.get calls.
  - Skip work if best candidate and image choice are unchanged and counts did not change.

### 6) Share asset compute and data slimming

Goal: avoid expensive re-renders and heavy data loads.

Changes (packages/backend/convex/shareAssets.ts, shareAssetsNode.ts)

- Replace getEventShareRenderData article scans with data from events or eventCandidacy:
  - Use stored articleCount, sourceCount, and top source names/logos.
- Consider reducing render signature churn:
- - Prefer removing lastUpdatedAt from the render signature if it is not visually displayed.
- - If a timestamp must be included, round to hour-level granularity, not day.
- - Skip re-render when only non-visual fields change.
- Evaluate preloading or bundling fonts to avoid fetch overhead on cold starts.

### 7) aiBudget aggregation doc

Goal: eliminate full-day aiUsage scans on every budget check.

Schema changes (packages/backend/convex/schema.ts)

- Add aiBudgetDaily table:
  - date (YYYY-MM-DD)
  - spentUsd, reservedUsd, updatedAt
- Consider sharding by hour or model+hour to avoid per-doc write contention.

Logic changes (packages/backend/convex/aiBudget.ts)

- checkBudget: read single aiBudgetDaily doc for today.
- reserveBudget: update reservedUsd with patch increments; avoid aiUsage scan.
- logUsage / recordUsage: increment spentUsd and decrement reservation in aiBudgetDaily, then append aiUsage row for audit.

### 8) Public preview and feed query slimming

Goal: avoid article fanout for feed and public previews.

Changes (packages/backend/convex/events.ts)

- For getPublicPublishedEventsPreview, return only a minimal preview model.
- For getPublishedEvents and searchPublishedEvents, avoid enrichEventsWithTopicsAndSources scans by using stored counts and source summaries.
- Only add a separate preview table if profiling later shows it is necessary.

### 9) Cron cadence tuning

Goal: reduce needless repeated candidate work.

Changes (packages/backend/convex/crons.ts)

- Consider reducing mergeNearDuplicateEvents to hourly or every 2 hours.
- Consider reducing reclusterRecentSingletonEvents to daily or 12 hours.
- Keep clusterEnrichedArticles at 30-60 minutes depending on ingestion volume.

## Ongoing observability (post-rollout)

- Add dashboard tiles for average candidate set size per cluster run and candidacy hit rate.
- Track vector search K and the percent of filtered candidates after status filtering.
- Track share-asset rerender rate and average render duration.

## Verification and acceptance criteria

- getRecentClusterCandidates bandwidth falls to < 300 MB for the rolling window.
- eventCandidacy row size stays < 5 KB after token caps.
- shareAssetsNode.generateEventShareAsset average compute time < 3 seconds and rerenders drop sharply.
- aiBudget bandwidth reduced by 80%+ (single doc read per call).
- auth adapter findMany volume aligns with active user count (no persistent spikes).
- feed and preview queries no longer load all articles per event.

## Suggested implementation order

1. Baseline capture + auth audit quick check
2. Early-bail when no enriched articles
3. eventCandidacy table + backfill + token caps
4. vectorSearch candidate selection (with filterFields)
5. event counts and refreshEventPresentation optimization
6. share asset data slimming and render gating
7. aiBudget daily aggregation (with sharding)
8. feed/public preview slimming
9. cron cadence tuning

## Notes

- The two quick wins already shipped (index-based recent filter and limiting member embeddings to top 3) are correct. The remaining structural fixes above are required to remove the linear scans and large per-event fanout.
