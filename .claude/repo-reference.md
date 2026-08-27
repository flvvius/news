# Miez — repo reference

Working notes for future sessions. Facts here were measured against the repo
and against production, not inferred. Where something is uncertain it says so.

## What this is

A Romanian news aggregator. It ingests RSS from ~29 rated Romanian outlets,
clusters articles into *events*, generates AI summaries with a grounding
gate, and publishes events to a feed. Its product thesis is the
**reformist ↔ suveranist** axis: every source carries a hand-assigned bias
score and summaries are split into neutral / reformist / suveranist framings.

## Layout

```
apps/web         TanStack Start + Router, Convex react hooks, Tailwind
apps/native      Expo (React Native), same Convex backend
packages/backend Convex functions + schema (the whole backend)
packages/i18n    ro/en string catalog, single file
eval/            evaluation harnesses
```

## Measured size (2026-08)

| | |
|---|---|
| Convex backend, non-test | **41,575 LOC**, 56 function files |
| Schema tables | **52** |
| Crons | **17** |
| Client Convex call sites | web **91**, native **49** |
| Files importing `_generated/api` | web **31**, native **17** |
| Vector-search usages | 149 |
| Files touching bias/perspective | 38 |
| Rated sources | 29 |

Largest modules: `clustering.ts` 7011, `summarizationNode.ts` 1660,
`summarization.ts` 1638, `enrichmentNode.ts` 1549, `pipeline.ts` 1452,
`config.ts` 1290, `events.ts` 770, `aiBudget.ts` 671.

## The pipeline

```
RSS ingest → enrichment (atomic facts, embeddings) → clustering (vector search)
  → summary job queued → summarization (Gemini) → L3 verbatim gate
  → L4 grounding gate → publish → feed
```

**Summaries gate publishing.** An event with no passing summary never
reaches the feed. Most "the feed is dead" incidents are actually
summarization incidents.

### Gate layers

- **L3 verbatim** (`lib/verbatimOverlap.ts`) — blocks reproducing N+ consecutive
  source words. As of #69 it **no longer blocks publication**: it retries with
  a stronger paraphrase instruction, records surviving spans in
  `overlapCheckJson` + the L7 audit trail, and publishes anyway.
- **L4 grounding** (`lib/grounding.ts`) — verifies each sentence against
  sources; strips unsupported sentences, or blocks as `blocked_ungrounded`
  when nothing survives.
- **L7 audit** — `appendGenerationAudit`, every generation outcome.

## Operational knowledge

### Deployment

- One Convex deployment: `quirky-panda-609`. `CONVEX_DEPLOY_KEY` selects it —
  **`npx convex run --prod` prints "Ignoring --prod" and uses the key's
  deployment**. The CLI labels it "dev deployment" in `convex logs`; it is
  nonetheless the deployment serving the live data.
- `npx convex deploy -y` from `packages/backend` ships the backend.
- `npx convex logs` is a **live tail**, not history — `--history N` still only
  returns what arrives during the capture window. To sample outcomes, capture
  for 60–120s and count.
- Vercel: two projects build `apps/web` (`news-web` and `news`). They live on
  different teams; `news` failing while `news-web` succeeds on the same commit
  is a project-config problem, not a code problem.

### Throughput maths

- Summarize cron: **00:45, 06:45, 12:45, 18:45 UTC** (4×/day). Between runs
  nothing publishes — a ~6h gap is structural, not a bug.
- Ceiling = 4 runs × `event_summary_batch_size` (12) = **~48 summaries/day**.
- Observed healthy output: **15–17 events/day**. News volume, not capacity, is
  the binding constraint.

### Config invariants (`config` table, JSON-encoded values)

- **`event_summary_enqueue_limit` must be ≤ `event_summary_batch_size`.**
  A run enqueues up to the former and drains the latter, so a higher enqueue
  limit grows the queue every run and buries fresh events behind days of
  backlog. Setting it to 40 against a batch of 12 produced a 700-event backlog.
- `article_fact_extraction_enabled` **or** `event_summary_body_fetch_enabled`
  must be on. With both off the grounding corpus collapses to
  summary+rssSnippet (~200 chars/article) and *every* summary is
  `blocked_ungrounded`. This stopped publishing entirely for ~3 weeks in
  2026-08.
- `ai_daily_budget_usd` = **1**. Typical daily spend is ~$0.05, so it is
  rarely the limiter — check 429s before blaming budget.
- `event_summary_max_verbatim_ngram` default 12 (raised from 8; 8 fired
  constantly on formulaic Romanian).

### Cost traps

- **Bumping `SUMMARY_PROMPT_VERSION` re-summarizes every event.**
  `shouldResummarize` compares the stored version, so a bump re-queues all
  ~1160 events — roughly a month of the 48/day budget spent on backfill,
  competing with same-day news. Change prompt text without bumping unless a
  full backfill is genuinely wanted; new events pick up the new prompt
  immediately either way.
- The summary-queue health query **truncates counts at 1000**. `failedJobs:
  1000` can mean 6000. Do not size a backlog from it.

### Data conventions

- `sources.provenance` — **internal** English analyst shorthand with ticket
  refs and process notes ("Tier C (BIV-806)", "never ingest as credible").
  **Never render it.** A design-system test fails the build if any web source
  file references `source.provenance`.
- `sources.readerNote` — the reader-facing Romanian line. Populated for all 29
  sources from `sourceReputation.ts` via `seeds:seedRomanianSources`, which
  patches existing rows (so it doubles as the backfill).
- `mbfcCategory` / `mbfcFactual` / `mbfcCredibility` are **unset on every
  source**. Don't build UI on them.

### Trending score

`lib/publicEventPreviews.ts`:

```
score = min(sources*10 + articles*3, MAX_COVERAGE_BONUS) + timestamp/RECENCY_MS_PER_POINT
```

Currently 144 cap and 300_000 ms/point (12 pts/hr) → **coverage buys at most
12h of float** over fresher news. The ratio cap ÷ points-per-hour *is* the
tuning knob.

**The score is written once per preview and never recomputed by a cron.**
Changing the formula requires running `events:rescorePublicPreviews`
(paginated, rebuilds snapshots on the last page) or old and new magnitudes mix
and ordering scrambles.

### Useful commands

```bash
cd packages/backend
npx convex run summarization:getSummaryQueueHealthInternal '{}'
npx convex run config:getBatch '{"keys":["event_summary_batch_size"]}'
npx convex run config:setInternal '{"key":"...","value":"12"}'   # value is JSON-encoded
npx convex run aiBudget:getTodaysUsage '{}'
npx convex run events:getPublishedEvents '{"sort":"recent","paginationOpts":{"numItems":20,"cursor":null}}'
```

Admin-facing queries (`getPipelineDoctor`, `getSummaryQueueHealthForAdmin`)
require an authenticated admin user and fail from the CLI; use the
`*Internal` variants.

## Conventions

- Migrations live in `convex/migrations.ts`: bounded per call, `dryRun: true`
  by default, an `isDone` flag, and a docstring explaining the situation.
- `CLAUDE.md` (root): do LLM-shaped sub-steps yourself; don't spend another
  provider's paid API on labeling/summarizing/translation work.
- UI follows `.claude/skills/editorial-calm` — content on the page background,
  hierarchy from type/whitespace/hairlines, no card surfaces. Enforced by
  `apps/web/src/design-system.test.ts`.

## Test commands

```bash
cd packages/backend && pnpm test     # ~325 tests
cd apps/web && pnpm test             # ~89
cd apps/native && pnpm test          # ~39
cd apps/web && npx vitest run src/design-system.test.ts
```
