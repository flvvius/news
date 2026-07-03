# Source-mix balance note (BIV-806)

**Date:** 2026-07-03 · **Constraint:** bias balance must never degrade
reliability integrity — the axis score and `reliabilityScore` are assigned
independently, and presence in the feed list is never a credibility signal.

## Before → after (ingested feeds)

| Pole | Before | After |
|---|---:|---:|
| Reformist (bias < 0) | 8 | 8 |
| Neutral (bias = 0) | 5 | 5 |
| Suveranist (bias > 0) | 2 | 6 |

Raw reformist:suveranist ratio moves from **4:1 to 4:3** — clearly more
balanced, deliberately **not** 50/50. Reliability-weighted voice (sum of
reliability scores per pole) stays reformist-dominant (63 vs 22), which is
the point: the suveranist pole is genuinely represented in coverage, while
summaries and factual-core weighting continue to prefer high-reliability
sources regardless of pole.

## What was added where

**Feeds (tier 3, ingested — each fetch-verified live 2026-07-03):**

| Source | Domain | Bias | Reliability | Rationale |
|---|---|---:|---:|---|
| România TV | romaniatv.net | +3 | 3 | Tier A mainstream suveranist TV; repeated CNA accuracy sanctions keep reliability at 3 |
| Realitatea Plus | realitatea.net | +3 | 3 | Tier A suveranist-aligned TV; Veridica-flagged narratives → 3 (feed found at the canonical homepage.xml path — no /rss route) |
| ActiveNews | activenews.ro | +4 | 2 | Tier B; Veridica top fake-news list → low reliability, high publication volume |
| Național | national.ro | +3 | 3 | Tier B; Expert Forum low-reliability list; tabloid framing |

(Antena 3 CNN and Gândul were already ingested pre-BIV-806.)

**Reputation-only (rated, NOT ingested):**

| Source | Domain | Bias | Reliability | Why not a feed |
|---|---|---:|---:|---|
| Napoca News | napocanews.ro | +4 | 2 | low-volume regional aggregator, mostly republication |
| Certitudinea | certitudinea.ro | +5 | 2 | opinion-heavy, items days apart |
| Buciumul | buciumul.ro | +4 | 2 | **failed live verification** — feed intermittently returns an empty body (quarantine-by-omission) |
| Națiunea | ziarulnatiunea.ro | +4 | 2 | low volume, opinion/republication |

These still get reputation rows so any article arriving via the Google News
discovery overlay (BIV-103) resolves to a rated LOW source instead of a
neutral default.

**Tier C — documented disinformation nodes, never ingested:**

| Source | Domain | Bias | Reliability |
|---|---|---:|---:|
| Flux24 | flux24.ro | +5 | 1 |
| AzNews | aznews.ro | +5 | 1 |
| SolidNews | solidnews.ro | +4 | 1 (lowered from 2) |
| OrtodoxINFO | ortodoxinfo.ro | +5 | 1 |

Identified as pro-Kremlin narrative relays by the universul.net network
investigation and Veridica; they carry bottom reliability so they can never
be mistaken for credible sources, and a regression test asserts they never
appear in `ALL_FEEDS`.

## Enforcement

- `feeds.test.ts`: suveranist feeds ≥ 4 but strictly fewer than reformist
  feeds (never 50/50); tier-3 feeds must be suveranist-leaning with
  reliability ≤ 4 and `credibility: "low"`; Tier-C domains never in the feed
  list.
- `sourceReputation.test.ts`: every balance addition has both an axis score
  (>0, ≤5) and an independent reliability score within its tier's honest cap
  (A ≤ 4, B ≤ 3, C ≤ 1).
- `feeds.smoke.test.ts`: live feed-parse smoke test for each tier-3 URL,
  opt-in via `FEED_SMOKE=1` (network-dependent, skipped in the normal suite).
