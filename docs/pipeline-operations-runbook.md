# Pipeline Operations Runbook

Use `/admin/pipeline` as the first stop for production feed incidents. The target freshness SLO is P95 ingest-to-latest-feed-visible under 60 minutes.

## Feed Stalled

Symptoms: no latest feed preview updated in 60 minutes, `feed_visibility_drought` alert, or public feed looks stale.

Actions:

- Check Pipeline Doctor queue ages for `unprocessed`, `enriched`, and `processing`.
- Trigger `Ingest`, then `Enrich`, then `Cluster` from `/admin/pipeline`.
- If `enriched` grows but previews do not, inspect “Almost Publishable” and clustering run logs.
- If fresh stories are outside trending, verify the Latest feed lane before changing clustering thresholds.

## Enrichment Failing

Symptoms: `enrichment_failure_rate` alert, high failed article count, or expired processing leases.

Actions:

- Check `enrichUnprocessedArticles` logs for `errorMessage`, `failedArticles`, and `failureRatio`.
- Trigger `Enrich` once manually after confirming the AI budget is available.
- If expired leases are high, allow the next enrichment run to reclaim them; stale processing article cleanup should be used only for old stuck rows.
- Escalate if the same error repeats for more than two runs.

## Vector Budget Exhausting

Symptoms: `p0_budget_projected_exhaustion`, `vector_budget_burn_rate`, fallback runs, or blocked clustering runs.

Actions:

- Preserve P0 feed work first: ingestion, enrichment, clustering, and preview creation.
- Temporarily reduce or pause P2/P3 work: summarization, claim divergence, share assets, aggressive reclustering.
- Lower `merge_changed_seed_limit` or `recluster_changed_seed_limit` before reducing core clustering.
- Enter observed last-24h qGB only when the Convex dashboard materially differs from the estimate.

## Too Many Processing Singletons

Symptoms: processing events older than 1 day, many one-source events, or no first-published previews.

Actions:

- Review “Almost Publishable” rows to see whether events are source-short or article-short.
- Run `Merge` and `Recluster` manually once; avoid repeated manual runs if vector budget is hot.
- Use stale singleton archive for old low-evidence rows, not for fresh events that may still merge.
- Tune clustering thresholds only after sampling near-miss logs.

## Storage Growing Too Fast

Symptoms: Convex file storage grows faster than article volume.

Actions:

- Keep `event_share_asset_generation_enabled` set to `false`.
- Inspect share asset rows for generated images that are no longer referenced by published events.
- Delete orphaned generated files only after confirming no event preview or share asset row references them.

## Source Ingestion Degraded

Symptoms: ingest runs degraded, failed feed count nonzero, or fresh article volume drops.

Actions:

- Inspect `ingestAllFeeds` run logs for `failedFeeds`, `insertedArticles`, and retry counts.
- Confirm whether the issue is isolated to one feed or all feeds.
- Disable or deprioritize chronically stale feeds after comparing inserted article count and duplicate rate.
