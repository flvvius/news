# Pipeline Stabilization Migration Note

This deploy adds stale-singleton archiving, recalibrated vector-search budget defaults, pipeline run logs, pipeline alerts, admin diagnostics, and the `/admin/pipeline` operations view. The goal is to shrink the Convex vector index, keep vector search available through more of the UTC day, and surface publishing regressions before the public feed dries up.

## Prerequisites & Terminology

- Stale-singleton archive job: `archiveStaleSingletonEvents`, an idempotent Convex action that archives old processing singleton events and removes their event-scoped index/child rows.
- Stale processing singleton events: `processing` events older than `singleton_cleanup_stale_hours` with at most `singleton_cleanup_max_articles` articles and `singleton_cleanup_max_sources` sources.
- Published events: multi-source events visible in the public feed. The archive job must never delete or modify these.
- Convex vector index: the `eventEmbeddings` vector search surface used by clustering, merge, and recluster jobs.
- Pipeline run logs and alerts: Convex rows shown in `/admin/pipeline` for job health, vector budget, stuck queues, and active incidents.

## Config Review

Before enabling the hourly archive cron in production, review these configuration keys:

| Key | Default | Purpose |
| --- | --- | --- |
| `singleton_cleanup_enabled` | `true` | Enables hourly stale singleton cleanup after the first supervised sweep. |
| `singleton_cleanup_stale_hours` | `48` | Minimum age since `lastArticleAt` before a singleton is eligible. |
| `singleton_cleanup_batch_size` | `100` | Maximum events handled per invocation. |
| `singleton_cleanup_max_articles` | `2` | Maximum article count eligible for cleanup. |
| `singleton_cleanup_max_sources` | `1` | Maximum source count eligible for cleanup. |
| `singleton_cleanup_article_action` | `"archive"` | Valid values: `"archive"` or `"requeue"`; archive is recommended. |
| `vector_search_daily_budget_qgb` | `25` | Daily UTC qGB limit for vector search. |
| `vector_search_per_search_bytes_default` | `31457280` | 30 MiB default estimate when no observed calibration is set. |
| `vector_search_observed_qgb_last_24h` | `0` | Optional operator-entered Convex dashboard qGB for calibration. |
| `clustering_vector_search_limit` | `24` | Top-K for article-to-event clustering search. |
| `merge_vector_search_limit` | `12` | Top-K for duplicate merge search. |
| `recluster_vector_search_limit` | `12` | Top-K for singleton recluster search. |
| `merge_changed_seed_limit` | `10` | Changed event seeds per merge pass. |
| `recluster_changed_seed_limit` | `10` | Changed singleton seeds per recluster pass. |
| `pipeline_run_log_retention_days` | `14` | Retention for detailed pipeline run logs. |

## First Sweep

Run a staging dry run first by disabling `singleton_cleanup_enabled`, deploying, manually triggering `archiveStaleSingletonEvents` from `/admin/pipeline`, and watching archive counters plus published-event counts. For production, take a database snapshot, keep `singleton_cleanup_enabled=false`, trigger the job manually from `/admin/pipeline`, and let it self-reschedule until it reports no more eligible rows. A normal first sweep should complete in minutes to a few hours depending on backlog; investigate if it runs longer than 2 hours or keeps rescheduling without reducing the `>3d` processing bucket.

Quick diagnostics before re-enabling the hourly cron: check active pipeline locks, archive job run logs, `deletedEvents` versus `archivedArticles`, Convex dashboard qGB/write load, and stuck processing buckets.

## Verification

Before and after the sweep, record published event count, a sample of published event IDs, statuses, `updatedAt`/timestamp fields, and public preview counts. After the sweep, verify those published samples still exist with `status="published"`, unchanged IDs/timestamps, and stable preview rows. In `/admin/pipeline`, inspect archive logs for `deletedEvents`, `deletedEmbeddings`, `deletedPreviews`, and errors; expected deleted previews for stale processing singletons should be zero or explainable. Confirm the public feed still loads and new published previews continue appearing.

If Convex dashboard qGB differs by more than 20% and more than 0.005 qGB from the pipeline estimate, enter the observed last-24h vector qGB in `/admin/pipeline`. The backend divides that by recorded vector-search count, clamps it between 1 MiB and 200 MiB per search, and uses it for future reservations.

## Rollback

If published events are modified, immediately set `singleton_cleanup_enabled=false`, avoid triggering more archive jobs, and inspect `/admin/pipeline` for active runs and locks. Restore from the pre-migration Convex snapshot if public data was deleted or corrupted; otherwise correct config and rerun verification against the same published-event sample. Re-enable cleanup only after the archive predicate and affected rows are understood.

## Monitoring Thresholds

- Vector budget burn: healthy is under 50% by 12:00 UTC; escalate if exhausted before 12:00 UTC.
- Fallback runs: healthy is fewer than 5% of clustering runs; escalate above 10% or more than 20 fallback runs/day.
- Processing singleton age: healthy is most processing events under 24h; investigate if more than 10% are older than 48h after the initial sweep.
- Archive counts: the first sweep may be high; steady state should not spike above 2x the trailing 7-day archive baseline without a matching ingest spike.
- Active alerts: warning alerts should be triaged same day; error alerts should block enabling more aggressive cleanup.
- Funnel health: ingestion to published previews should recover toward the pre-regression baseline within 6-24 hours.

## Troubleshooting

- Budget exhausted before midday UTC: lower `clustering_vector_search_limit`, `merge_vector_search_limit`, or `recluster_vector_search_limit` by 25%, or raise `vector_search_daily_budget_qgb` only if dashboard qGB supports it.
- High fallback rate: check `/admin/pipeline` for blocked vector runs, budget ratio, and recent `clusterEnrichedArticles` logs.
- Published count decreases after archive: disable `singleton_cleanup_enabled`, follow rollback, and review the archived event IDs before rerunning.
- Slow archive sweep: reduce `singleton_cleanup_batch_size`, check active locks, and inspect Convex dashboard load before triggering another manual run.
