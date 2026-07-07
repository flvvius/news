# Re-tuning clustering thresholds on Romanian data (BIV-501)

**Status:** procedure ready; measurement pending real Romanian data ·
**Last updated:** 2026-07-02

## What stays fixed

- **Embedding model:** `text-embedding-3-small` (512 dims). It is
  multilingual and handles Romanian; do not switch models as part of this
  tuning (a switch requires an `EMBEDDING_VERSION` bump and full
  reprocessing).
- **Time-window rule:** the recent-window buckets (`recent_2d`) and the
  hot-embedding table are unchanged.

## Why re-tune

Cosine-similarity distributions shift by language — Romanian is more
token-dense than English — so the thresholds tuned on US/English coverage
do not transfer as-is. Every threshold is already **config-driven** (no
constants to edit):

| Config key | Default | Meaning |
|---|---|---|
| `clustering_min_similarity` | 0.74 | minimum cosine for an article to join an event |
| `clustering_strong_similarity` | 0.84 | high-confidence override for weak title overlap |
| `clustering_same_source_min_similarity` | 0.84 | stricter bar for same-source attachment |
| `clustering_weak_extraction_min_similarity` | 0.82 | minimum for weak-extraction articles |
| `clustering_weak_extraction_strong_similarity` | 0.88 | strong override for weak-extraction articles |
| `merge_min_similarity` | 0.94 | event-to-event duplicate merge |
| `singleton_recluster_min_similarity` | 0.74 | singleton recluster pass |

Set any of them with
`npx convex run config:set '{"key":"clustering_min_similarity","value":"0.78"}'`
— the pipelineRuntimeConfig snapshot refreshes immediately.

Romanian-specific lexical support already in place: title tokens are
diacritic-folded before overlap comparison (`foldDiacriticsToAscii`,
BIV-102) and the clustering stopword list includes Romanian function words
(BIV-501).

## The measurement procedure

1. **Collect** — let ingestion run for a few days on the Romanian feed set
   (BIV-101) so articles + embeddings accumulate.
2. **Label** — build a small hand-labeled event set (aim for 100+ pairs,
   mixing obvious same-event pairs, hard near-duplicates, and same-topic
   different-event pairs):
   ```
   npx convex run clustering:labelClusterPairForAdmin \
     '{"leftArticleId":"…","rightArticleId":"…","sameEvent":true}'
   ```
   Labels land in the `clusterPairLabels` table.
3. **Sweep** — run the threshold sweep over the labeled set:
   ```
   npx convex run clusteringTuning:sweepClusteringThresholds
   ```
   The sweep models the production join rule (strong-similarity override
   plus the title overlap/Jaccard lexical gate at production defaults) —
   not raw cosine alone. The remaining production gates (same-source,
   weak-extraction, topic support) only *reject* additional merges, so the
   reported false-merge count is an upper bound. For each candidate
   threshold it reports **false merges** (different events joined —
   precision loss) and **false splits** (same event kept apart — recall
   loss), plus precision/recall/F1.
4. **Choose** — pick the threshold at the precision/recall trade-off you
   want. False merges are worse than false splits for this product (a
   wrong merge pollutes an event's perspective summaries; a split just
   delays publication until the recluster pass), so prefer the highest
   threshold whose recall is still acceptable (guideline: precision ≥ 0.95,
   then maximize recall).
5. **Apply + record** — set the config key(s) and record the chosen value
   with its measured precision/recall in the table below.

## Chosen thresholds (fill in after measurement)

| Date | Key | Value | Labeled pairs | Precision | Recall | Notes |
|---|---|---|---|---|---|---|
| — | `clustering_min_similarity` | 0.74 (inherited default) | — | — | — | pre-measurement default; re-run after a few days of Romanian ingestion |

Re-run the sweep whenever the embedding model, the feed mix, or the
extraction pipeline changes materially.
