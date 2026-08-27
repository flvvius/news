# The Aggregation Pipeline — Portable Architecture Reference

> **Purpose of this document.** Biviant's content pipeline is the part of this repo worth
> reusing. This document describes it as a **platform-neutral system** so it can be lifted
> out and rebuilt as the foundation of a different data aggregator — on Postgres, on a
> queue, on whatever runtime you like — without dragging Convex along.
>
> It is written in three layers, and every section is tagged:
>
> | Tag | Meaning |
> |---|---|
> | **[CORE]** | Architecture that transfers to any aggregator. Keep this. |
> | **[CONVEX]** | An artifact of running on Convex. Replace it — §11 says with what. |
> | **[NEWS]** | Specific to bias-aware news. Swap for your own domain logic. |
>
> Current code is the authority. File references point at `packages/backend/convex/*`.
> Where this contradicts the top-level `README.md`, this document is right.

---

## Table of contents

1. [What the pipeline actually is](#1-what-the-pipeline-actually-is)
2. [The runtime primitives it needs](#2-the-runtime-primitives-it-needs)
3. [The state machine](#3-the-state-machine)
4. [Stage 1 — Acquisition](#4-stage-1--acquisition-ingestion)
5. [Stage 2 — Enrichment](#5-stage-2--enrichment)
6. [Stage 3 — Clustering](#6-stage-3--clustering)
7. [Stage 4 — Synthesis](#7-stage-4--synthesis-summarization)
8. [Stage 5 — Publication & read models](#8-stage-5--publication--read-models)
9. [Maintenance stages](#9-maintenance-stages)
10. [Cross-cutting machinery](#10-cross-cutting-machinery)
11. [Removing Convex](#11-removing-convex)
12. [Reusing this for a different domain](#12-reusing-this-for-a-different-domain)
13. [Config key reference](#13-config-key-reference)
14. [Build order & pitfalls](#14-build-order--pitfalls)

---

## 1. What the pipeline actually is

**[CORE]** Strip the news vocabulary away and the pipeline is a general
**many-noisy-sources → deduplicated → enriched → clustered → synthesized → published**
machine:

```
   SOURCE REGISTRY                     (curated list of feeds/endpoints)
        │
        ▼
   ACQUIRE      pull raw items, canonicalize identity, dedup, persist as `raw`
        │
        ▼
   ENRICH       fetch full content, extract structure, embed, derive attributes
        │
        ▼
   CLUSTER      group items describing the same real-world thing into an entity
        │
        ▼
   SYNTHESIZE   produce entity-level artifacts (summary, comparison, scores)
        │
        ▼
   PUBLISH      denormalize into read models the product actually serves
```

The domain mapping in this repo:

| Generic concept | This repo | Table |
|---|---|---|
| Source | News outlet (domain + bias + reliability) | `sources` |
| Item | Article (one outlet's coverage) | `articles` |
| Entity/cluster | Event (one real-world story) | `events` |
| Entity artifact | Perspective summaries, claim graph | `events`, `eventClaims` |
| Read model | Feed card | `publicEventPreviews` |

**Two properties define this pipeline's character and are the reason it is worth copying:**

1. **Every stage is independently resumable.** No stage assumes the previous one ran
   recently, completed, or succeeded. Each picks up whatever is in its input status and
   leaves output in the next status. You can kill the process at any point and lose
   nothing but in-flight work.
2. **Every expensive operation is guarded twice** — by a *budget reservation* (don't
   spend money you don't have) and by a *content signature* (don't spend money on input
   you already processed).

Everything else — leases, chaining, hot/cold splits, alerting — exists to serve those two
properties under real-world cost and failure conditions.

---

## 2. The runtime primitives it needs

**[CORE]** To port the pipeline you need exactly seven capabilities. Nothing else is
architectural.

| # | Primitive | Used for | Convex today | Portable option |
|---|---|---|---|---|
| 1 | **Transactional store** | All state; each stage step must be atomic | Convex DB | Postgres |
| 2 | **Vector similarity search** | Clustering candidate retrieval | Convex `vectorIndex` | pgvector / Qdrant |
| 3 | **Full-text search** | Feed search | Convex `searchIndex` | Postgres `tsvector` |
| 4 | **Cron scheduler** | Stage triggers | `crons.ts` | Cron / Temporal / Cloud Scheduler |
| 5 | **Deferred one-shot scheduler** | Stage self-chaining (`runAfter`) | `ctx.scheduler` | Queue with visibility delay (SQS/BullMQ) |
| 6 | **Outbound HTTP with timeouts** | Feed + article fetching | `fetch` in Node actions | Anything |
| 7 | **LLM + embedding API** | Enrichment & synthesis | OpenAI + Gemini | Same |

Optional: blob storage (social share images), push delivery, an analytics sink.

### The action/mutation split **[CONVEX]**

Convex forbids network I/O inside transactions, which forced a discipline worth keeping
even where it is not forced:

- **Orchestrator** (Convex `action`): does I/O — fetch, call the model, decide.
  Holds no transaction.
- **Step** (Convex `mutation`/`query`): does one small transactional read or write,
  re-validating its preconditions.

An orchestrator never writes directly. Every write is a named, individually-idempotent
step that re-checks the lease and status it depends on. This is why an orchestrator
crashing mid-batch is harmless: whatever steps committed are consistent, and the rest is
retried by lease expiry.

**Keep this split when you port.** On Postgres it becomes "the worker function does HTTP
and holds no open transaction; each write is a short `BEGIN…COMMIT` with a
`WHERE status = ... AND lease_owner = ...` guard."

---

## 3. The state machine

**[CORE]** The pipeline's control flow *is* the item status column. There is no separate
workflow engine.

### Item (article) lifecycle

```
   unprocessed ──claim(lease)──► processing ──enrich──► enriched ──cluster──► clustered
        │                            │                     │
        │                            └── lease expires ────┘  (returns to claimable)
        │
        └──► discarded   (embedding failed — unusable)
             archived    (cluster went stale; kept for history)
```

### Entity (event) lifecycle

```
   processing ──successful grounded summary──► published
        │
        └── stale + still a singleton after 48h ──► archived (articles detached)
```

**The publish gate is the single most important product rule in the pipeline.** In this
codebase it is:

> An entity becomes publicly visible only when it has **≥3 items from ≥2 distinct
> sources** *and* a **successfully generated, grounding-checked summary**.

Note the subtlety, because the older `SYSTEM-OVERVIEW.md` gets it wrong: clustering
**never** promotes an event to `published`. `attachArticleToEvent` deliberately preserves
`event.status` (`clustering.ts`), and the only code path that writes `status: "published"`
is `applyEventSummaryResult` (`summarization.ts:901`). Corroboration makes an event
*eligible*; a passing summary makes it *public*.

Generalize this as: **coverage thresholds gate eligibility; a successful artifact gates
publication.** It gives you a single choke point where quality checks can block release.

### Per-record status sub-machines

Each expensive sub-step carries its own status so a partial failure degrades one
capability instead of the whole item:

```
articles.factExtractionStatus : pending | deferred | succeeded | succeeded_empty | failed | skipped
articles.biasDetectionStatus  : deferred | succeeded | failed | skipped
```

`deferred` specifically means *"budget/quota ran out, this is not the item's fault, retry
later without burning an attempt."* That distinction — **backpressure is not failure** —
recurs everywhere in the design and you should preserve it.

---

## 4. Stage 1 — Acquisition (ingestion)

`ingestion.ts` · entry `ingestAllFeeds` → `ingestSingleFeed`

### Contract

| | |
|---|---|
| **Input** | Source registry (`feeds.ts`, 18 curated feeds across 3 tiers) |
| **Output** | New `articles` rows with `status = "unprocessed"` |
| **Idempotency** | Three-layer dedup (below); re-running inserts nothing new |
| **Failure** | Per-feed isolated; one retry after 3 s; quarantine after 5 consecutive failures |
| **Chaining** | If anything inserted → schedule enrichment in 60 s |

### The algorithm

1. **Get-or-create the source** by domain, seeded from the reputation table.
2. **Conditional fetch** — `If-None-Match` / `If-Modified-Since` from the previous run's
   stored ETag/Last-Modified. A `304` is a complete success with zero work.
3. **Parse** RSS 2.0 / Atom with a dependency-free regex parser (CDATA, `media:content`,
   `enclosure`, inline `<img>`). Cap: 25 items per feed per run.
4. **Normalize** title (strip `" - Outlet"` suffixes) and snippet (strip HTML, URLs,
   boilerplate like "Read more").
5. **Canonicalize the URL** — this is the primary identity key:
   - force `https`, lowercase host, drop fragment
   - strip `www.` / `m.` / `mobile.` / `amp.` / `edition.` prefixes
   - apply host aliases (`bbc.co.uk → bbc.com`)
   - collapse `//`, strip `/amp` path segments and `.amp.html`
   - delete all `utm_*`, `fbclid`, `gclid`, `dclid`, `mc_*`, `mkt_tok`
   - **keep unknown params** (some publishers use them as article IDs)
   - sort remaining params, drop trailing slash
6. **Recency filter** — drop items older than 72 h. Dateless entries are kept;
   *malformed* dates are not rescued.
7. **Three-layer dedup**:

   | Layer | Key | Catches |
   |---|---|---|
   | Feed fingerprint | hash of all `(canonicalUrl, contentFingerprint)` pairs | Whole feed unchanged → skip entire feed, zero DB reads |
   | Canonical URL | `articles.canonicalUrl` (global) | Same article seen anywhere before |
   | Content fingerprint | `(sourceId, hash(normalizedTitle + first 600 chars of snippet))` | Same story republished at a new URL |

   The feed-level fingerprint short-circuit only applies when `consecutiveFailures === 0`,
   so a recovering feed always does a real pass.
8. **Insert** in batches of 50, `status = "unprocessed"`.
9. **Update feed health** (`ingestionMeta`): last success, consecutive failures, last
   error, running count, ETag, Last-Modified.

### Design notes worth carrying over **[CORE]**

- **Fingerprint text normalization must be Unicode-aware.** An ASCII-only strip collapsed
  Romanian `"Ședință"` to `"edin"` and caused same-source fingerprint collisions. Use
  `\p{L}\p{N}`.
- **Quarantine, don't drop.** After 5 consecutive failures a feed is skipped, but probed
  once every 6 h so it can self-heal, and it stays visible in run-log gauges. Silent
  removal of a broken source is how aggregators quietly lose coverage.
- **Sequential, not parallel, across sources.** Politeness beats throughput at this scale;
  `politeFetch` additionally enforces per-domain rate limiting (min 1.5 s interval,
  ±400 ms jitter, max 2 concurrent, 3 attempts with backoff, honours `Retry-After`).

---

## 5. Stage 2 — Enrichment

`enrichmentNode.ts` (orchestrator, Node runtime) + `enrichment.ts` (steps) +
`lib/articleExtraction.ts` (extraction)

### Contract

| | |
|---|---|
| **Input** | ≤40 `unprocessed` (or expired-lease) articles, atomically claimed |
| **Output** | `status = "enriched"` + embedding, summary, entities, facts, optional bias |
| **Lease** | `enrichmentRunId` + `enrichmentLeaseExpiresAt`, 15 min TTL |
| **Failure** | Transient API errors leave articles claimable; embedding failure → `discarded` |
| **Chaining** | Self-chains (5 s delay, depth ≤60) while batches come back full; on drain → clustering in 90 s |

### 5.1 Content extraction

Concurrency 5, 8 s timeout per fetch. The extraction ladder, in priority order:

1. `<article>` / `<main>` / selector patterns (`itemprop="articleBody"`,
   `.article-body`, `.story-body`, `.entry-content`, `.post-content`, …)
2. **JSON-LD `articleBody`** — outranks generic block scoring, *unless* the best DOM block
   is ≥1.5× longer (some publishers put only a teaser in JSON-LD)
3. Best-scoring `<article|main|section|div>` block by paragraph-text/link-text ratio
4. JSON-LD generic text
5. `og:description` / `<meta name="description">`
6. RSS snippet

**Thresholds:** body must be ≥350 chars to count as real ("strong"); capped at 6 000 chars;
embedding text capped at 5 000; derived summary at 320.

**`extractionQuality` is the load-bearing output.** `strong` = real body text was
recovered; `weak` = snippet/meta only. Downstream, weak items face **higher clustering
thresholds** because their embeddings are noisier. This single flag is what lets one
pipeline handle both cooperative and hostile publishers without degrading cluster quality.

Also detected here: blocked/captcha pages (pattern list), Google News redirect resolution
via the `batchexecute` RPC, and a lead image (og → twitter → JSON-LD → best inline
candidate, with a HEAD-verification pass and avatar/sprite rejection).

**Entities** are extracted with a Unicode-aware capitalized-sequence matcher plus numeric
patterns, filtered against a noise list (weekdays, role prefixes). The English-only
`wink-nlp` model was removed — an NLP dependency that only works for one language is worse
than a good regex when your corpus is multilingual.

### 5.2 Embedding

One batched call per run: `text-embedding-3-small` at **512 dimensions**.
`EMBEDDING_VERSION = 4` — bumping it flags articles for re-enrichment. Items whose
embedding failed are `discarded` (they can never be clustered, so they must not linger).

**[CORE]** Store embeddings in a **separate table** from the item row. A 512-float vector
is ~4 KB; joining it into every ordinary read is a bandwidth tax on paths that never use
it. This hot/cold split repeats throughout the design.

### 5.3 Atomic fact extraction **[NEWS-flavoured, CORE-pattern]**

Each item → up to 8 short, standalone, verifiable claims
(`"Vote count: 60-40"`, `"Passed Tuesday"`), via a JSON-schema-constrained model call.
Input capped at 2 600 chars.

**This is the most transferable idea in the whole pipeline.** Atomic facts are a *cheap
intermediate representation*: full text is extracted once, reduced to facts once, and every
downstream synthesis step (summaries, claim comparison, quiz, clustering token overlap)
consumes facts instead of re-reading bodies. It caps token cost per item at O(1) regardless
of how many entity-level artifacts you later derive.

### 5.4 Per-item attribute scoring **[NEWS]**

A JSON-schema call scores four anchored sub-dimensions on the *text*, explicitly **not**
the outlet's reputation:

| Field | Range |
|---|---|
| `politicalLean` (reformist −/suveranist +) | −5…+5 |
| `emotionalLanguage` | 0…5 |
| `sourceDiversity` | 0…5 |
| `factOpinionRatio` | 0…5 |

Combined (`combineBiasScore`) as:

```
intensity   = (emotionalLanguage + factOpinionRatio) / 2
counterwt   = sourceDiversity * 0.3
score       = lean * (1 + intensity * 0.15) − sign(lean) * counterwt   → clamp ±5
```

Lean amplified by rhetorical intensity, dampened by evidence diversity.
`sourceBiasDelta = aiBiasScore − source.baseBias`; beyond a threshold (default 2) the item
is flagged as diverging from its own outlet's baseline. A daily job maintains 30-day
rolling mean/stddev per source and flags outliers at `2σ` (σ floored at 0.5, min 10
samples).

*Currently disabled in production* (`article_bias_detection_enabled = false`) for cost.

### 5.5 Persist

`markArticleEnriched` writes everything and flips status. Each sub-step's status is written
independently. **Every write re-checks the lease** — "lease no longer belongs to run X →
skip" — so two overlapping runs can never double-process an item.

---

## 6. Stage 3 — Clustering

`clustering.ts` (~7 k lines) · entry `clusterEnrichedArticles`

The core algorithm. Batch of ≤32 enriched items per run; self-chains until drained.

### 6.1 The entity vector

**[CORE]** An entity's embedding is the **arithmetic mean (centroid) of its member items'
embeddings**, maintained incrementally:

```
newMean[i] = (oldMean[i] * n + item[i]) / (n + 1)
```

Invariant enforced across create / attach / merge / recompute paths. Cheap, order-
independent, and good enough — no re-embedding of the entity text is ever needed.

### 6.2 Candidate retrieval — two modes

**Primary:** vector search over `eventEmbeddingHot`, a *small physical mirror* holding only
recent (≤48 h) entities. Top-K = 12.

**[CONVEX]** The hot mirror exists because Convex bills vector search by **bytes scanned**,
so searching the full history costs money proportional to the corpus, not the result. On
pgvector with an HNSW index this is far less of a concern — but a partial index or a
`WHERE last_article_at > now() - interval '48 hours'` predicate still helps, and the
48 h recency bound is a *correctness* rule anyway (see 6.3).

**Fallback:** when the vector-search budget is exhausted, load ≤220 recent candidates from
`eventCandidacy` and score them in-process with cosine similarity. Degraded but correct.

**Representative cache:** before searching, compare the item's embedding against already-
searched items in this batch; if it exceeds the *strong* similarity threshold, reuse that
item's candidate list instead of issuing a new query. Deterministic (highest similarity
wins, not insertion order).

**`eventCandidacy`** is a denormalized per-entity clustering snapshot — title tokens,
evidence tokens, fact tokens, entity tokens, topic slugs, counts, source IDs — so the
matcher never re-reads member items. Token arrays are capped at 200 (FIFO).

### 6.3 The matching gate — `findBestCandidate`

**[CORE]** This is the heart of it, and the single most important lesson:
**cosine similarity alone is not a clustering decision.** Embeddings happily rate two
different stories about the same institution at 0.80. The gate combines the vector score
with independent lexical evidence.

Four token sets are compared per candidate (each producing an overlap count and a Jaccard):

| Set | Built from |
|---|---|
| `title` | normalized title |
| `evidence` | RSS snippet + extracted summary |
| `fact` | atomic facts |
| `entity` | proper nouns + numerics across title/snippet/summary/facts |

Tokens: diacritics folded to ASCII, lowercased, non-alphanumerics stripped, length ≥3,
stopwords removed.

**Hard rejections, in order:**

```
|item.publishedAt − candidate.firstPublishedAt| > 48 h        → reject
```

**Effective thresholds** (defaults; all runtime-configurable):

| | min similarity | strong similarity |
|---|---|---|
| Normal item | 0.74 | 0.84 |
| `weak` extraction | 0.82 | 0.88 |
| Shares a source with the candidate | 0.84 (+0.02 without lexical support) | — |
| Topic overlap present | −0.04 (floored at global min) | −0.02 |

**Support predicates:**

```
bodySupport    = (evidence+fact+entity overlap ≥ 2 AND max(their jaccards) ≥ 0.6·J)
              OR (fact  overlap ≥ 2 AND factJaccard   ≥ 0.45·J)
              OR (entity overlap ≥ 2 AND entityJaccard ≥ 0.45·J)

lexicalSupport = (titleOverlap ≥ T AND titleJaccard ≥ J)
              OR (evidenceOverlap ≥ T AND evidenceJaccard ≥ 0.75·J)
              OR (factOverlap   ≥ 1 AND factJaccard   ≥ 0.5·J)
              OR (entityOverlap ≥ 1 AND entityJaccard ≥ 0.5·J)
              OR bodySupport

semanticSupport = similarity ≥ min + 0.05
               AND (evidenceJaccard ≥ 0.75·J OR factJaccard ≥ 0.6·J OR entityJaccard ≥ 0.6·J)
```
(`J` = `clustering_min_title_jaccard`, default 0.1. `T` = `clustering_min_title_overlap`,
seeded as **1** in config — the in-code fallback is 2, and config wins.)

**Match decision:**

```
baseMatch = similarity ≥ strongThreshold
         OR (similarity ≥ minThreshold AND (lexicalSupport OR semanticSupport OR topicSupport))

sameSourceMatch = !sharesSource
               OR similarity ≥ sameSourceMin + 0.02
               OR (similarity ≥ sameSourceMin AND anySupport)
```

**Ranking among survivors:**

```
score = similarity      × 0.43
      + titleJaccard    × 0.12
      + evidenceJaccard × 0.16
      + factJaccard     × 0.11
      + entityJaccard   × 0.14
      + recencyScore    × 0.04      (1 − Δt/48h)
      + overlapScore    × 0.04      (min(totalOverlap,10)/10)
      + crossSourceBonus            (0 if same source, else min(sourceCount,5)/100)
      + topicBonus                  (0.03 if topics overlap)
```

**Near-miss logging:** candidates within 0.05 below the threshold that failed are logged
with every sub-signal. This is the tuning feedback loop — pair it with the
`clusterPairLabels` ground-truth table to calibrate thresholds empirically rather than by
feel.

**Three guards to keep in any port:**
- **Same-source guard** — two items from one source need a much higher bar, or a publisher
  running a story plus its follow-up collapses them into one entity.
- **Weak-extraction guard** — noisy embeddings must clear a higher bar.
- **Time window** — semantically identical stories from different weeks are different
  events. This is a correctness rule, not an optimization.

### 6.4 Two-phase batch attach

Items that match attach immediately. Unmatched ones go to a **pending list**, sorted by
*seed rank*:

```
strong extraction > more entity tokens > longer title > newer > id (stable tiebreak)
```

The pending pass then, per item:

1. Try **batch-local matching** — against entities created earlier *in this same batch*
   (in-process cosine, no vector query).
2. If the batch state changed since this item last searched, re-run a **fresh vector
   search** (bypassing the representative cache).
3. Still unmatched → **create a new entity**, seeded with the item's snippet as a heuristic
   summary, status `processing`.

**[CORE]** Seed ranking matters more than it looks: the first item to create an entity
defines its title, its initial centroid, and its candidacy tokens. Letting the
*best-extracted* item seed it, rather than whichever arrived first, measurably improves
recall for the rest of the batch.

### 6.5 Topic inference **[NEWS-flavoured, CORE-pattern]**

Deterministic lexical scoring — **no model call**. Per topic in a curated taxonomy
(`slug`, `displayName`, `aliases`, `keywords`, `keyPhrases`, `excludePhrases`):

```
score = titlePhraseHits    × 5.5
      + summaryPhraseHits  × 2.8
      + snippetPhraseHits  × 2.2
      + factPhraseHits     × 3.0
      + titleKeywordHits   × 2.1
      + summaryKeywordHits × 1.15
      + snippetKeywordHits × 0.85
      + factKeywordHits    × 1.25
      + displayNameCoverage× 0.9
      + (fullDisplayNameCoverage ? 2.5 : 0)
      − excludeHits        × 4.0
```

Accepted if `score ≥ 4.5` **and** (`signalCount ≥ 2` or `score ≥ 6.5`) — the second clause
stops one lucky phrase hit from assigning a topic. Then keep topics scoring ≥ 55 % of the
top score, capped at 3.

An LLM would do this better and cost ~1 300×/day more. **Reach for deterministic scoring
before a model call whenever the taxonomy is small and curated.**

---

## 7. Stage 4 — Synthesis (summarization)

`summarizationNode.ts` (orchestrator) + `summarization.ts` (steps) + `prompts.ts`

### 7.1 A queue, not an inline step **[CORE]**

Synthesis is decoupled from clustering by a **durable job table** (`eventSummaryJobs`):

```
queued → processing → succeeded | failed | skipped
```

with `attempts`, `nextAttemptAt`, `processingRunId`, `leaseExpiresAt` (10 min), and
`lastError`. Backoff is `5 min × 2^(attempts−1)`; max 3 attempts.

Why it must be a queue: model latency and quota are unbounded and unpredictable. Inline
synthesis means a 429 from the model provider stalls *clustering*, which stalls the feed.
With a queue, model trouble only delays publication of the affected entities.

**Queue draining is 70 % newest-first, 30 % oldest-first.** Pure oldest-first starves fresh
content whenever a backlog exists (an 800-job backlog means today's story waits days);
pure newest-first never drains the backlog. The split bounds fresh-item latency to roughly
one run while still retiring old jobs every run. This is a genuinely non-obvious production
lesson.

### 7.2 Eligibility and idempotency

Enqueue requires: not unpublished, **≥3 items from ≥2 sources**, no blocking job already
present, and `shouldResummarize()`:

- no complete summary yet (neutral text + globalImpact + `lastSummarizedAt`), **or**
- `lastSummaryPromptVersion !== SUMMARY_PROMPT_VERSION` (a prompt bump re-runs each entity
  exactly once), **or**
- the entity changed since it was last summarized.

Plus an anti-thrash rule: an entity summarized successfully within the last hour is skipped
unless the prompt version changed.

**Content signature:** SHA-256 over `{promptVersion, entityId, title, sorted per-item
{id, url, publishedAt, sourceId, sourceBias, sourceReliability, summary, snippet, facts}}`.
If it equals `lastSummarySignature`, the job is skipped without a model call. **[CORE]** —
this one check is the difference between a pipeline that costs $1/day and one that costs
$40/day.

### 7.3 Input construction

Up to **6** most-recent items (`event_summary_max_input_articles`; the in-code fallback is 8),
each reduced to:
title + source lean/reliability + extracted summary + RSS snippet + **atomic facts**.

Optionally (`event_summary_body_fetch_enabled`, **off by default**) full bodies are fetched
*transiently* at synthesis time — used in the prompt, **never persisted**. Budget:
18 000 chars total across all items, ≥1 200 per item, concurrency 8, hard 12 s deadline for
the whole fan-out (proceed with whatever landed).

> **[CONVEX] cost note that generalizes anyway.** Convex bills action compute by
> *wall-clock*, including time blocked on the network. Fanning out one body fetch per input
> item was the single most expensive operation in the entire application. Even off Convex,
> a synthesis worker that blocks on a fan-out of slow publisher servers is a worker you are paying
> for to do nothing — cap the fan-out with a deadline, not just per-request timeouts.

### 7.4 Generation and the gate stack

The output is JSON-schema-constrained: `{neutral, reformist, suveranist, globalImpact,
perspectiveApplicable}` **[NEWS]**. Word caps 120/100/100/100, validated with one corrective
retry.

Then a stack of gates runs, and this stack is the reusable part:

| Gate | What it does | Failure behaviour |
|---|---|---|
| **Word caps** | Structural validation of model output | Retry once with the violation stated |
| **Quota fallback** | 429 on the primary model → rerun on a cheaper fallback model | Fail the job only if both fail |
| **Verbatim overlap** (L3) | No ≥12-word contiguous run may match any source text (`event_summary_max_verbatim_ngram`; the `lib/verbatimOverlap.ts` default is 8) | Up to 2 regenerations with an explicit paraphrase instruction naming the copied spans; then **publish anyway**, recording the surviving spans |
| **Grounding** (L4) | Every sentence must be entailed by source material: embedding shortlist → one LLM entailment call | Unsupported sentences **stripped**; if too many (>34 %) fail or `neutral` empties → block permanently (`blocked_ungrounded`, no retry) |
| **Audit append** (L7) | Immutable record: sources + content hashes + fetch times + permission state + check results | — |

**[CORE] The gate design principles here are worth stealing wholesale:**

- **Fail-*open* for cosmetic checks, fail-*closed* for truth checks.** The verbatim gate
  was originally blocking; in production the surviving spans were overwhelmingly formulaic
  language (`"în valoare de 20 de miliarde de dolari"`), and blocking silently deleted real
  stories. A feed that drops stories is a worse failure than one that reuses a stock phrase.
  Grounding, by contrast, still blocks — an unsupported sentence is a fabrication.
- **Strip, don't reject, when the failure is localized.** Grounding removes the specific
  unsupported sentences and publishes the rest.
- **Exempt facts from the paraphrase mandate.** Numbers, sums, dates, proper nouns and
  units are copied *exactly*. An early version dodged `"100 de lei"` into `"o sută de
  unități monetare"` to avoid overlap — a comprehension bug produced by a compliance rule.
- **Record what the gate saw, even when it passes.** `overlapCheckJson`, `summaryGrounding`
  rows and the append-only `generationAudit` table make every published artifact auditable
  after the fact.

The write funnel (`applyEventSummaryResult`) enforces the invariants transactionally: it
refuses to apply if the job lease moved, if `overlapCheck.passed === false` was passed
explicitly, or if `grounding.passed === false` — then patches the entity, marks it
`published`, stamps AI-disclosure fields, resyncs the read model, and queues a share image.

### 7.5 Other entity-level artifacts **[NEWS]**

Same pattern, currently **disabled for cost**:

- **Claim divergence** (`claimDivergenceNode.ts`) — groups atomic facts across sources into
  claims classified `agreement | divergence | framing | exclusive_left/right/center`, each
  variant citing an exact `(articleIndex, factIndex)`. Then **heavy server-side
  sanitization**: re-verify each variant supports the canonical statement via stemmed
  token overlap with synonym canonicalization; **recompute status from evidence** (a
  "divergence" whose values are identical becomes `agreement`; `divergence`/`framing`
  require ≥2 distinct sources); cap 12 claims. Empty results **preserve the prior stored
  card** rather than wiping it.
- **Daily quiz** (`quizNode.ts`) — questions generated from stored claims/facts, then
  **grounding-enforced**: any generated question whose claim doesn't token-overlap a real
  stored claim is dropped.

**[CORE] The pattern:** *never trust structured model output as final state.* Re-derive
every classification you can from the evidence the model cited, drop what you cannot
verify, and make an over-filtered result a no-op rather than a destructive write.

---

## 8. Stage 5 — Publication & read models

### 8.1 Denormalized read models **[CORE]**

The product **never** queries the entity or item tables. It queries purpose-built read
models, written by `syncPublicEventPreview` whenever an entity changes:

| Table | Purpose |
|---|---|
| `publicEventPreviews` | Ready-to-render card: title, image, summaries, source chips, bias counts, `trendingScore` |
| `publicEventPreviewTopics` | Per-topic index into the above |
| `publicFeedSnapshots` | Fully precomputed first-page JSON (rebuilt 4×/day) |
| `publicSitemapSnapshots` | Precomputed sitemap XML (rebuilt daily) |

Each layer removes work from a hotter path. Cold anonymous loads and crawlers hit static
JSON; pagination past the snapshot hands off to the live ranked query via an encoded
`ranked:` cursor so it never dead-ends at the snapshot boundary.

### 8.2 Ranking

Two sorts. `recent` is cheap indexed pagination by `lastUpdatedAt`. `trending` is a
**static, monotonic sort key written once at upsert time** — which forces it to be built
from an absolute timestamp, not a "now-relative" age, or the stored ordering would rot:

```
coverageBonus = min(sourceSignal × 10 + articleSignal × 3, 144)
recencyScore  = (lastUpdatedAt ?? firstPublishedAt) / 300_000     # 1 point / 5 min
trendingScore = coverageBonus + recencyScore
```

The ratio between the coverage cap (144) and the recency rate (12 pts/hour) **is** the
tuning knob: coverage can lift a stale entity at most 12 hours above a fresher one. Express
it that way in code so the trade-off stays legible.

`sourceSignal`/`articleSignal` fall back from claim-verified counts to raw counts —
because when the claim pipeline is paused the verified counts are all zero, and without the
fallback "trending" silently degenerates into "latest".

### 8.3 Personalization

Followed topics drive a **client-side boost, never a hard filter**. You still see
everything; your topics rank higher. A deliberate product stance for a bias-aware
aggregator — but also a good default for any aggregator that doesn't want to build a
filter bubble.

---

## 9. Maintenance stages

**[CORE]** An online clustering pass is necessarily greedy and myopic. These four jobs buy
back the quality that greediness costs:

| Job | Cadence | Rule |
|---|---|---|
| **Merge near-duplicates** | 2×/day | Two entities with cosine ≥0.94 **and** (titleJaccard ≥0.45 **or** ≥2 shared entity tokens **or** shared topic) within 48 h → merge. Canonical = more items → earlier → older row → lexicographic id. Re-parents items, merges summaries/topics/embeddings (article-count-weighted centroid), prefers the AI-authored summary. |
| **Recluster singletons** | Daily | Revisit recent singleton/tiny entities after more items landed; recovers stories under-clustered online. Bounded by seed caps and a reduced top-K. |
| **Archive stale singletons** | Daily | `processing` + ≤2 items + ≤1 source + no new item for 48 h → archive (detach items, drop from the vector index). Yields immediately if a clustering lock is held. |
| **Prune hot vectors** | Daily | Drop hot-mirror rows for entities that went quiet; the write path re-adds active ones. |

### Retention

Two distinct classes, deliberately separated:

**Legal minimization** (`lib/retentionPolicy.ts` — the single source of truth, also
rendered into the public privacy policy):

| Class | Period |
|---|---|
| Unengaged waitlist signups | 90 d |
| Reading history / interactions | 548 d (18 mo) |
| Unverified accounts | 7 d |
| Personalized insights | 30 d |
| **Article body text** | **0 — never persisted** |

**Operational (storage-cost) retention:** article embeddings 45 d (clustering never looks
back further than 48 h, so this is ~22× more history than anything reads), archived
detached articles 90 d, weekly orphan-vector sweep, run logs 14 d, vector telemetry 30 d.

**[CORE]** Storage grows without bound by default and compounds monthly. Budget for it at
design time: ~1 300 items/day × a 4 KB vector each is ~2 GB/year of pure vector storage for
data that stops being readable after two days.

---

## 10. Cross-cutting machinery

### 10.1 Cost control — reserve → call → settle **[CORE]**

Every model call goes through `callLLM` (`lib/aiCall.ts`):

1. **Estimate** cost from token estimates (`ceil(chars/4)`) × per-model rates, **+10 %**
   safety margin.
2. **Reserve** it against a **sharded daily counter** (`aiBudgetDaily`, sharded by UTC hour,
   plus a total row). Over the cap → return `budget_exhausted`; the caller **defers**.
3. **Call** with retry/backoff (`500 ms × 3^attempt` with ±25 % jitter; retry 429/5xx; bail
   immediately on 401/403/404).
4. **Settle** — replace the reservation with actual logged usage in `aiUsage`; on failure
   **release** it. Expired reservations swept twice daily.

Sharding by hour is what makes concurrent workers safe: without it, every call contends on
one hot row. **Reservations, not post-hoc accounting**, are what makes the cap actually
hold under concurrency — check-then-spend races; reserve-then-spend doesn't.

Cached input tokens are billed at 10 % (prompt caching, OpenAI only — the routing layer
omits `prompt_cache_*` for Gemini). Unknown models fall back to `gpt-4o-mini` rates.

### 10.2 Cost control — vector-search budget **[CONVEX]**

Convex bills vector search by bytes scanned ("qGB"). The same reserve/settle protocol
applies (`vectorSearchBudget.ts`), with **self-calibration**: observed qGB over the last
24 h ÷ observed searches = actual bytes/search, clamped to [1 MB, 200 MB]. When the budget
is exhausted, clustering **falls back to in-process candidate scoring** rather than
stopping.

Off Convex this specific budget mostly disappears — pgvector charges you in CPU and IOPS,
not per-byte-scanned. **Keep the fallback path anyway**: "degrade to a cheaper algorithm
under resource pressure" is worth having whatever the meter reads.

### 10.3 Concurrency & idempotency **[CORE]**

Four mechanisms, layered:

| Mechanism | Scope | Implementation |
|---|---|---|
| **Run lease** | One runner per job | `pipelineLocks` row keyed by job name, owner token, TTL (20 min). Acquire → work → release in `finally`. Expiry recovers from crashes. |
| **Record lease** | One runner per item | `enrichmentRunId` + expiry on the item; every write re-validates it |
| **Job lease** | One runner per queue job | `processingRunId` + `leaseExpiresAt` on the job row |
| **Content signature** | Skip unchanged work | SHA-256 of the exact inputs; equal → no-op |

All four are just columns with a `WHERE` guard. None needs a distributed lock service, and
none should be replaced by one during a port.

### 10.4 Self-chaining **[CORE]**

Each batched stage processes a fixed batch (40 enrich / 32 cluster) and then, **if the
batch came back full**, schedules *itself* again after a short delay (5 s / 10 s), up to
depth 60. Two counters (`enrichedSoFar`, `clusteredSoFar`) accumulate across the chain.

Three details that took production incidents to learn:

1. **The chain terminator must also hand off.** A drain whose item count is an exact
   multiple of the batch size ends with a link that claims zero items — if that link
   doesn't schedule the *next stage*, everything the chain just enriched sits there until
   the next cron window.
2. **Hand off on the chain total, not the batch total.** A terminal batch can legitimately
   do zero work while earlier links did hundreds.
3. **A link that loses the run lock must still hand off** whatever earlier links
   accomplished, or that work is stranded.

Chaining beats polling: an idle deployment schedules nothing at all, while throughput
scales with actual intake.

### 10.5 Runtime config & kill-switch **[CORE]**

A `config` key-value table (JSON-encoded values, ~100 keys) holds every threshold, limit,
model id, budget and feature flag. Read at runtime — **behaviour is tuned without a
deploy**, which matters enormously for a clustering system whose thresholds you will be
adjusting for months.

Two refinements:
- **`pipeline_paused = true` is a global kill-switch** checked first by every job. One
  toggle stops all spend.
- **A snapshot collapses the ~25 clustering-related keys into one document**
  (`pipelineRuntimeConfig`), refreshed 5 min before each pipeline window, so a run does one
  read instead of 25.

Hardcoded constants remain in code as fallbacks, and every config read is clamped to a
sane range. A bad config value degrades, it doesn't break.

### 10.6 Observability **[CORE]**

Every job writes one **run-log** row: `jobName`, `runId`, timings, `status ∈ {ok, skipped,
degraded, error}`, plus free-form `counters` / `gauges` / `metadata`. `skipped` is a
first-class outcome, not a failure — a job yielding to a lock did nothing wrong.

An alert job evaluates rules over those logs and writes `pipelineAlerts` rows:

| Code | Condition |
|---|---|
| `fallback_persistent` | ≥3 clustering runs in fallback mode since the last check |
| `feed_visibility_drought` | No preview became visible within 2 batch windows |
| `vector_budget_burn_rate` | ≥75 % of budget used with ≤half the day's windows done |
| `p0_budget_projected_exhaustion` | Burn ratio ≥ expected progress + 0.25 |
| `stuck_processing_growth` | Count of >72 h-old `processing` entities increased (or hit the cap) |
| `job_error_rate:<job>` | <80 % ok over the log window, min 3 non-skipped runs |
| `enrichment_failure_rate` | >20 % of claimed items failed, min 10 attempts |
| `archive_run_absent` | No successful archive run in one job period + one alert period |

**[CORE] The lesson embedded in every one of those rules: alert windows must be derived
from job cadence, not chosen by hand.** When this pipeline moved from continuous operation
to four batch windows per day, every hand-tuned window became either dead (never contains a
run) or permanently firing. The rules now compute their windows from
`PIPELINE_WINDOW_MS` / `DAILY_JOB_PERIOD_MS` × a tolerance factor.

### 10.7 Compliance layer **[NEWS/EU-specific, but the shape generalizes]**

If you aggregate third-party content, some version of this is not optional:

| Layer | Mechanism |
|---|---|
| **TDM opt-out resolution** | Per-domain state `full \| rss_only \| blocked`, cached 24 h. Resolved from: `TDM-Reservation` header → `/.well-known/tdmrep.json` → `<meta name="tdm-reservation">` → `robots.txt` (own token, `*`, and AI-convention tokens: GPTBot, Google-Extended, CCBot, anthropic-ai, ClaudeBot, PerplexityBot, …) → `noai` meta / `X-Robots-Tag` → `/ai.txt`. **Any** opt-out signal caps at `rss_only`. `blocked` is only ever set manually. |
| **Gate both consumers** | The fetcher and the summarizer both check state; `rss_only` domains contribute headline + link + snippet only |
| **Honest crawler identity** | Named bot UA, per-domain rate limiting, `Retry-After` honoured, conditional requests |
| **No body storage** | Article bodies are fetched transiently and never persisted — retention zero by construction |
| **Verbatim + grounding gates** | §7.4 |
| **Append-only audit** | `generationAudit`: one immutable record per pipeline action, with source hashes and check results. No update/delete mutation exists; corrections append a new version pointing at the old one. |
| **Notice-and-action** | Reports table, one-click unpublish (`unpublishedAt` — a separate field from `status` so the pipeline can never re-publish behind your back), publisher opt-out flow |

---

## 11. Removing Convex

**This is the section you came for.** What Convex actually provides, what breaks without
it, and what to replace it with.

### 11.1 Direct substitutions

| Convex feature | Used for | Replacement |
|---|---|---|
| `defineTable` + validators | Schema + runtime validation | Postgres DDL + Zod/Valibot at the boundary |
| `v.id("table")` | Typed foreign keys | `uuid`/`bigint` FK + branded TS types |
| `.index("by_x", [...])` | Query indexes | `CREATE INDEX` — Convex index order = column order |
| `.vectorIndex(…, 512)` | Clustering search | **pgvector** `vector(512)` + HNSW, or Qdrant |
| `.searchIndex(…)` | Feed search | `tsvector` + GIN (with an unaccent-folded column) |
| `crons.cron("…", expr, fn)` | Stage triggers | System cron / Cloud Scheduler / Temporal schedule |
| `ctx.scheduler.runAfter(ms, fn, args)` | Self-chaining, hand-offs | Queue with delay: BullMQ `delay`, SQS `DelaySeconds`, `pg_cron`, or a `scheduled_jobs` table + poller |
| `mutation` | Transactional step | `BEGIN … COMMIT` |
| `query` | Read | `SELECT` |
| `action` / `"use node"` | Orchestrator with I/O | An ordinary worker process |
| `ctx.runMutation/runQuery` | Orchestrator → step | Direct function calls (they get *cheaper*, not more expensive) |
| `_creationTime` | Implicit creation timestamp | `created_at timestamptz DEFAULT now()` — **add it explicitly**; several tiebreakers rely on it |
| `_storage` | Share images | S3 / R2 |
| Reactive `useQuery` | Live-updating client | Polling, SSE, or `LISTEN/NOTIFY` — see 11.4 |

### 11.2 Portable schema sketch

The essential pipeline tables (auth/engagement/compliance omitted for brevity — they carry
over mechanically):

```sql
CREATE TABLE sources (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  domain           text NOT NULL UNIQUE,
  name             text NOT NULL,
  base_bias        real NOT NULL,             -- [NEWS] domain attribute
  reliability_score real NOT NULL,            -- [NEWS]
  logo_url         text,
  rolling_bias_mean real, rolling_bias_stddev real,
  rolling_bias_sample_size int, rolling_bias_updated_at timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TYPE article_status AS ENUM
  ('unprocessed','processing','enriched','clustered','discarded','archived');

CREATE TABLE articles (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id            uuid REFERENCES events(id) ON DELETE SET NULL,
  source_id           uuid NOT NULL REFERENCES sources(id),
  title               text NOT NULL,
  url                 text NOT NULL,
  canonical_url       text NOT NULL,
  content_fingerprint text,
  rss_snippet         text,
  summary             text,                   -- derived, short; NOT the body
  entities            text[],
  atomic_facts        text[],
  extraction_quality  text CHECK (extraction_quality IN ('strong','weak')),
  image_url text, image_width int, image_height int, image_alt text, image_source text,
  ai_bias_score       real,                   -- [NEWS]
  bias_components     jsonb,                  -- [NEWS]
  source_bias_delta   real,
  status              article_status NOT NULL DEFAULT 'unprocessed',
  fact_extraction_status text, fact_extraction_attempts int DEFAULT 0,
  bias_detection_status  text, bias_detection_attempts  int DEFAULT 0,
  latest_embedding_version int,
  needs_reenrichment  boolean DEFAULT false,
  enrichment_run_id   uuid,
  enrichment_lease_expires_at timestamptz,
  published_at        timestamptz NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX ON articles (canonical_url);
CREATE UNIQUE INDEX ON articles (source_id, content_fingerprint)
  WHERE content_fingerprint IS NOT NULL;
CREATE INDEX ON articles (status, published_at);
-- The enrichment claim query: unprocessed OR lease expired
CREATE INDEX ON articles (status, enrichment_lease_expires_at);

CREATE TABLE article_embeddings (               -- hot/cold split: keep separate
  article_id uuid PRIMARY KEY REFERENCES articles(id) ON DELETE CASCADE,
  embedding  vector(512) NOT NULL,
  version    int NOT NULL
);

CREATE TYPE event_status AS ENUM ('processing','published');

CREATE TABLE events (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title               text NOT NULL,
  slug                text NOT NULL UNIQUE,
  image_url text, image_width int, image_height int, image_alt text,
  perspective_summaries jsonb,                -- [NEWS] {neutral, reformist, suveranist}
  perspective_applicable boolean,
  perspective_source  text CHECK (perspective_source IN ('heuristic','ai')),
  global_impact       text,
  status              event_status NOT NULL DEFAULT 'processing',
  unpublished_at      timestamptz,            -- kill switch, separate from status
  first_published_at  timestamptz NOT NULL,
  last_updated_at     timestamptz,
  last_article_at     timestamptz,
  article_count       int NOT NULL DEFAULT 0,
  source_count        int NOT NULL DEFAULT 0,
  source_ids          uuid[] NOT NULL DEFAULT '{}',
  last_summarized_at  timestamptz,
  last_summary_signature text,
  last_summary_prompt_version int,
  ai_generated boolean, human_reviewed boolean,
  model_used text, prompt_version text,
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ON events (status, last_article_at);
CREATE INDEX ON events (status, first_published_at);

CREATE TABLE event_embeddings (
  event_id  uuid PRIMARY KEY REFERENCES events(id) ON DELETE CASCADE,
  embedding vector(512) NOT NULL,             -- centroid of member articles
  version   int NOT NULL,
  status    event_status NOT NULL,
  last_article_at timestamptz NOT NULL,
  article_count int NOT NULL
);
-- Replaces eventEmbeddingHot: a PARTIAL index is the portable equivalent of a
-- separate physical hot table.
CREATE INDEX event_embeddings_recent_hnsw ON event_embeddings
  USING hnsw (embedding vector_cosine_ops)
  WHERE last_article_at > now() - interval '48 hours';

CREATE TABLE event_candidacy (                -- denormalized clustering snapshot
  event_id       uuid PRIMARY KEY REFERENCES events(id) ON DELETE CASCADE,
  title          text, slug text,
  status         event_status NOT NULL,
  first_published_at timestamptz NOT NULL,
  last_article_at    timestamptz NOT NULL,
  article_count int NOT NULL, source_count int NOT NULL,
  source_ids    uuid[] NOT NULL,
  title_tokens text[], evidence_tokens text[], fact_tokens text[],
  entity_tokens text[], topic_slugs text[],
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TYPE summary_job_status AS ENUM
  ('queued','processing','succeeded','failed','skipped');

CREATE TABLE event_summary_jobs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id      uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  status        summary_job_status NOT NULL DEFAULT 'queued',
  reason        text,
  attempts      int NOT NULL DEFAULT 0,
  requested_at  timestamptz NOT NULL DEFAULT now(),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  processing_run_id uuid,
  lease_expires_at  timestamptz,
  last_error    text,
  summary_signature text,
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON event_summary_jobs (status, next_attempt_at);
CREATE INDEX ON event_summary_jobs (event_id, status);

-- Infrastructure
CREATE TABLE config          (key text PRIMARY KEY, value jsonb NOT NULL,
                              description text, updated_at timestamptz DEFAULT now());
CREATE TABLE pipeline_locks  (key text PRIMARY KEY, owner uuid NOT NULL,
                              acquired_at timestamptz, expires_at timestamptz NOT NULL);
CREATE TABLE pipeline_run_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_name text NOT NULL, run_id uuid NOT NULL,
  started_at timestamptz, finished_at timestamptz, duration_ms int,
  status text NOT NULL CHECK (status IN ('ok','skipped','degraded','error')),
  error_message text, counters jsonb, gauges jsonb, metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON pipeline_run_logs (job_name, started_at DESC);

CREATE TABLE ai_usage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  date date NOT NULL, model text NOT NULL, call_type text,
  input_tokens int, output_tokens int, cached_input_tokens int,
  cost_usd numeric(12,6) NOT NULL, latency_ms int,
  event_id uuid, article_id uuid, created_at timestamptz DEFAULT now()
);
CREATE TABLE ai_budget_daily (
  date date NOT NULL, shard smallint NOT NULL,     -- UTC hour 0–23
  spent_usd numeric(12,6) NOT NULL DEFAULT 0,
  reserved_usd numeric(12,6) NOT NULL DEFAULT 0,
  PRIMARY KEY (date, shard)
);
CREATE TABLE ai_budget_reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  model text, call_type text, cost_usd numeric(12,6) NOT NULL,
  date date, shard smallint,
  created_at timestamptz DEFAULT now(), expires_at timestamptz NOT NULL
);
```

Plus the read models (`public_event_previews`, `public_event_preview_topics`,
`public_feed_snapshots`) exactly as described in §8.

### 11.3 Things that get *easier* off Convex

- **`runQuery`/`runMutation` become function calls.** Every one of these is currently a
  billed round trip that extends the orchestrator's wall clock — which is why the code
  goes out of its way to `Promise.all` three independent reads at the top of
  `processSummaryJob`. In-process, that micro-optimization is unnecessary.
- **Batching limits disappear.** The 50-row insert batches exist because of Convex mutation
  limits; Postgres takes a multi-row `INSERT … ON CONFLICT DO NOTHING` for the whole feed.
  In fact `INSERT … ON CONFLICT` replaces the entire "query existing canonical URLs, diff
  in memory, insert the remainder" dance in `ingestSingleFeed` with one statement.
- **The vector-search budget becomes mostly moot.** Delete `vectorSearchBudget.ts`,
  `vectorSearchDaily*`, `vectorSearchReservations`, `vectorSearchRuns` — but **keep the
  fallback code path** in clustering.
- **The hot vector mirror becomes an index predicate.** `eventEmbeddingHot`,
  `syncHotEventEmbedding` and `pruneHotEventEmbeddings` all collapse into one partial HNSW
  index.
- **Wall-clock billing goes away.** The body-fetch fan-out (`event_summary_body_fetch_enabled`)
  was turned **off** purely because Convex bills blocked network time. On your own worker,
  turn it back on — it is the single largest available quality win in the summarizer, and
  §7.3's caps are still worth keeping for latency.
- **The 4×/day batch cadence was a cost concession, not a design.** The stages are written
  to run continuously (they self-chain, they hand off, they lease). Restore short intervals
  and the whole `worst case ~6 h ingest-to-feed` freshness cost disappears.

### 11.4 Things that get *harder* off Convex

| What | Why | Mitigation |
|---|---|---|
| **Reactivity** | Convex pushes query updates to clients automatically; the feed updates itself | The read models already exist and are cheap — poll them, or `LISTEN/NOTIFY` on preview upserts, or SSE |
| **Transactional guarantees across steps** | Convex mutations are serializable by construction | Postgres `READ COMMITTED` is enough *if* you keep the guarded-update discipline: `UPDATE … WHERE status = 'x' AND lease_owner = $1 RETURNING *`, and treat zero rows as "someone else got it" |
| **Atomic claim-a-batch** | `claimUnprocessedArticles` is one mutation | `UPDATE articles SET status='processing', enrichment_run_id=$1, enrichment_lease_expires_at=now()+interval '15 minutes' WHERE id IN (SELECT id FROM articles WHERE (status='unprocessed' OR (status='processing' AND enrichment_lease_expires_at < now())) ORDER BY published_at LIMIT 40 FOR UPDATE SKIP LOCKED) RETURNING *` — **`FOR UPDATE SKIP LOCKED` is the whole trick** |
| **Schema validation at the DB boundary** | Convex validators reject malformed writes | Zod at every repository function; don't rely on TS types alone for model output |
| **Scheduler durability** | `runAfter` survives deploys | Use a durable queue, not `setTimeout`. A `scheduled_jobs(run_at, payload)` table polled every 5 s is perfectly adequate and easier to debug than most queue services |
| **Generated typed API** | `internal.module.fn` is type-checked end to end | Ordinary imports give you the same thing; you lose only the client-facing codegen |

### 11.5 Suggested target stack

```
Postgres 16 + pgvector          — store, vector search, full-text search
Node/TS worker (one process)    — orchestrators; the stage code ports almost verbatim
BullMQ (Redis) or pg-boss       — delayed jobs (self-chaining, hand-offs) + summary queue
node-cron / Cloud Scheduler     — stage triggers
Drizzle or Kysely               — typed SQL, keeps the "one small guarded write" discipline
```

Everything in `lib/` — `articleExtraction`, `verbatimOverlap`, `tdmPolicy`, `politeFetch`,
`biasAxis`, `romanian`, `summaryText`, `feedSerialization`, `retentionPolicy` — is
**already platform-independent** and ports by copy-paste. Same for the pure functions
lifted out for testability: `normalizeArticleTitle`, `canonicalizeUrl`,
`normalizeTitleTokens`, `evaluateTopicInference`, `inferTopicSlugs`, `combineBiasScore`,
`isFeedQuarantined`, `selectStaleSingleton`, `computeTrendingScore`, `shouldPublishCluster`.
Those functions plus their test files are the real portable asset in this repo.

---

## 12. Reusing this for a different domain

**[CORE] What is domain-independent:** everything in §§3–6 and §§9–10. Acquisition,
dedup, extraction, embedding, the clustering matcher, the maintenance passes, leases,
budgets, signatures, read models, ranking, alerting.

**[NEWS] What is Biviant-specific and needs replacing:**

| Component | What it is | Replace with |
|---|---|---|
| `feeds.ts` | 18 curated Romanian RSS feeds in 3 tiers | Your source registry |
| `sourceReputation.ts` | 31 hand-rated outlets (bias + reliability + provenance) | Your source-attribute table, or drop it |
| `lib/biasAxis.ts`, `bias.ts` | reformist↔suveranist axis, per-item scoring, outlier flags | Your per-item classification, or nothing |
| `prompts.ts` | Romanian, multi-perspective, CASE A/B/C/D rubric | Your synthesis prompt |
| `topics` catalog | Curated news taxonomy | Your taxonomy (keep the scoring algorithm) |
| `lib/romanian.ts` | Diacritic folding | Your locale's normalization |
| Perspective/claim/quiz artifacts | News-literacy features | Whatever entity-level artifact your product sells |

### Adaptation notes by aggregator type

- **The item-level LLM step is the customizable slot.** "Atomic facts + attribute scores"
  is one instantiation of *"reduce each item to a cheap structured representation before
  any cross-item reasoning."* For job postings that's `{title, seniority, stack,
  comp_range, remote_policy}`; for research papers `{claim, method, dataset, result}`; for
  product listings `{spec_key: value}`. Keep the shape: schema-constrained, capped input,
  per-item status, deferrable on budget.
- **Tune the clustering time window to your domain's event lifetime.** 48 h suits news.
  Job postings want weeks; research papers want none at all (use versions/DOIs instead of
  a window).
- **Re-derive the publish gate from your trust model.** "≥2 independent sources" is a news
  rule. For jobs it might be "the posting still 200s". For listings, "price seen twice".
  Keep the *structure* — coverage gates eligibility, artifact success gates publication.
- **Deterministic-first stays right.** Topic inference, dedup, canonicalization, entity
  extraction and status recomputation all avoid model calls. Only reach for a model where
  judgment is genuinely required.

---

## 13. Config key reference

Defaults as seeded by `config.seedDefaults`. All are runtime-overridable; code holds a
fallback and clamps every read.

### Kill-switch & budget
| Key | Default |
|---|---|
| `pipeline_paused` | `false` |
| `ai_daily_budget_usd` | `1` |
| `vector_search_daily_budget_qgb` | `25` **[CONVEX]** |
| `vector_search_budget_enabled` / `_fallback_mode_enabled` | `true` / `true` **[CONVEX]** |
| `vector_search_per_search_bytes_default` | `31457280` (30 MB) **[CONVEX]** |
| `backfill_enabled` | `false` |

### Clustering
| Key | Default |
|---|---|
| `clustering_min_similarity` | `0.74` |
| `clustering_strong_similarity` | `0.84` |
| `clustering_min_title_overlap` | `1` |
| `clustering_min_title_jaccard` | `0.1` |
| `clustering_same_source_min_similarity` | `0.84` |
| `clustering_weak_extraction_min_similarity` | `0.82` |
| `clustering_weak_extraction_strong_similarity` | `0.88` |
| `clustering_vector_search_limit` | `12` |
| `cluster_publish_min_articles` / `_min_sources` | `3` / `2` |

### Merge / recluster / cleanup
| Key | Default |
|---|---|
| `merge_min_similarity` | `0.94` |
| `merge_min_title_jaccard` | `0.45` |
| `merge_max_time_delta_hours` | `48` |
| `merge_vector_search_limit` / `merge_changed_seed_limit` | `8` / `8` |
| `singleton_recluster_min_similarity` | `0.74` |
| `singleton_recluster_window_hours` | `48` |
| `recluster_vector_search_limit` / `recluster_changed_seed_limit` | `8` / `8` |
| `singleton_cleanup_enabled` | `true` |
| `singleton_cleanup_stale_hours` | `48` |
| `singleton_cleanup_batch_size` | `75` |
| `singleton_cleanup_max_articles` / `_max_sources` | `2` / `1` |
| `singleton_cleanup_article_action` | `"archive"` |

### Topic inference
| Key | Default |
|---|---|
| `topic_inference_min_score` | `4.5` |
| `topic_inference_confidence_ratio` | `0.55` |
| `topic_inference_max_topics` | `3` |

### Enrichment
| Key | Default |
|---|---|
| `article_fact_extraction_enabled` | `true` |
| `article_fact_extraction_model` | `"gemini-3.1-flash-lite"` |
| `article_fact_extraction_max_articles_per_run` | `16` |
| `article_fact_extraction_max_facts_per_article` | `8` |
| `article_fact_extraction_max_input_chars` | `2600` |
| `article_bias_detection_enabled` | `false` |
| `article_bias_detection_model` | `"gemini-3.1-flash-lite"` |
| `article_bias_detection_max_articles_per_run` | `16` |
| `article_bias_detection_max_input_chars` | `6000` |
| `article_bias_source_delta_threshold` | `2` |
| `article_bias_outlier_window_days` | `30` |
| `article_bias_outlier_min_samples` | `10` |
| `article_bias_outlier_stddev_multiplier` / `_floor` | `2` / `0.5` |

### Summarization
| Key | Default |
|---|---|
| `event_summary_model` / `_fallback` | `"gemini-3.1-flash-lite"` |
| `event_summary_enqueue_limit` | `12` |
| `event_summary_batch_size` | `12` |
| `event_summary_max_attempts` | `3` |
| `event_summary_min_articles` / `_min_sources` | `3` / `2` |
| `event_summary_max_input_articles` | `6` |
| `event_summary_body_fetch_enabled` | `false` **[CONVEX cost — turn on when you port]** |
| `event_summary_body_chars` | `2600` |
| `event_summary_body_fetch_concurrency` | `8` |
| `event_summary_body_fetch_timeout_ms` | `12000` |
| `event_summary_max_verbatim_ngram` | `12` |
| `event_grounding_enabled` | `true` |
| `event_grounding_max_unsupported_ratio` | `0.34` |
| `event_share_asset_generation_enabled` | `false` |

### Claims / retention / ops
| Key | Default |
|---|---|
| `claim_analysis_enabled` | `false` |
| `claim_analysis_min_articles` / `_min_sources` | `3` / `2` |
| `claim_analysis_stale_after_ms` | `3600000` |
| `claim_analysis_max_input_articles` | `12` |
| `claim_analysis_max_facts_per_article` | `10` |
| `claim_analysis_max_claims_per_event` | `12` |
| `claim_analysis_min_confidence` | `0.5` |
| `pipeline_run_log_retention_days` | `14` |
| `pipeline_alert_check_interval_minutes` | `720` |
| `archived_article_retention_days` | `90` |
| `article_embedding_retention_days` | `45` |
| `vector_search_run_retention_days` | `30` |
| `feed_page_size` | `6` |

### Hardcoded constants (not config-driven)

| Constant | Value | Where |
|---|---|---|
| Embedding model / dimensions / version | `text-embedding-3-small` / 512 / `4` | `enrichmentNode.ts` |
| Default chat model | `gemini-3.1-flash-lite` | `lib/modelRouting.ts` |
| Enrich batch size / lease TTL / concurrency | 40 / 15 min / 5 | `enrichmentNode.ts` |
| Cluster batch size / candidate cap / token cap | 32 / 220 / 200 | `clustering.ts` |
| Recent event window | 48 h | `clustering.ts` |
| Chain depth / delay (enrich, cluster) | 60 / 5 s, 10 s | both |
| Run lock TTL | 20 min | `ingestion.ts`, `clustering.ts` |
| Summary job lease / backoff base / stagger | 10 min / 5 min×2ⁿ / 8 s | `summarizationNode.ts` |
| Summary word caps | 120/100/100/100 | `summarizationNode.ts` |
| Body budget total / min per article | 18 000 / 1 200 chars | `summarizationNode.ts` |
| Verbatim n-gram (lib default) | 8 words | `lib/verbatimOverlap.ts` |
| Max items per feed per run | 25 | `ingestion.ts` |
| Ingest recency window | 72 h | `ingestion.ts` |
| Feed quarantine threshold / probe interval | 5 failures / 6 h | `ingestion.ts` |
| Extraction fetch timeout / min body / max body | 8 s / 350 / 6 000 chars | `lib/articleExtraction.ts` |
| Polite fetch interval / jitter / concurrency | 1.5 s / 400 ms / 2 per domain | `lib/politeFetch.ts` |
| Trending recency rate / coverage cap | 1 pt / 5 min, 144 | `lib/publicEventPreviews.ts` |

---

## 14. Build order & pitfalls

### Suggested build order

Each step is independently useful — you have a working (if dumber) product at every stop.

| # | Step | You now have |
|---|---|---|
| 1 | Source registry + acquisition + 3-layer dedup + feed health | A clean, deduplicated item store |
| 2 | Config table + kill-switch + run-log table + leases | Operable infrastructure. **Do this before stage 3, not after** |
| 3 | Extraction + embeddings (+ hot/cold split) | Enriched items |
| 4 | Clustering: vector retrieval + the multi-signal gate + create/attach | Entities. **The product exists here** |
| 5 | Read models + ranking + feed | A shippable aggregator |
| 6 | AI budget (reserve → settle) | Safe to turn on model calls |
| 7 | Item-level structured extraction (your "atomic facts") | Cheap currency for synthesis |
| 8 | Synthesis queue + signatures + publish gate | Entity artifacts, safely |
| 9 | Maintenance passes (merge / recluster / archive / retention) | Quality and bounded storage |
| 10 | Alert rules + ground-truth labels + threshold tuning | A pipeline you can actually operate |

### Pitfalls, each one paid for in production here

1. **Don't cluster on cosine similarity alone.** It will merge unrelated stories about the
   same institution. Lexical corroboration is not optional. (§6.3)
2. **Publish-gate on artifact success, not just counts.** Otherwise a failed summary leaves
   a live entity with a raw snippet as its "summary".
3. **Every write must re-validate its lease.** Overlapping runs are not hypothetical; cron
   overrun plus a manual trigger is Tuesday.
4. **Chain terminators must hand off.** A drain that is an exact multiple of the batch size
   will otherwise strand a full window of work. (§10.4)
5. **Reserve budget, don't check it.** Check-then-spend races under concurrency; the cap
   silently doesn't hold.
6. **Signature-skip every expensive stage.** Without it, re-running is not idempotent —
   it's expensive.
7. **Derive alert windows from job cadence.** Hand-picked windows break the moment you
   change a schedule. (§10.6)
8. **`skipped` is not an error.** A job yielding to a lock must not count against an error-
   rate SLO, or every intentional yield flaps your alerting.
9. **Normalize Unicode-aware.** ASCII-only folding silently destroys non-English
   fingerprints and tokens. (§4)
10. **Distinguish backpressure from failure.** A 429 is not the item's fault; `deferred`
    must not burn a retry attempt — but cap total deferral (24 h here) so a permanently
    starved job eventually surfaces as a failure someone can see.
11. **Don't store scraped bodies.** Fetch transiently, use, discard. Retention zero by
    construction is far easier to defend than a purge job.
12. **A near-duplicate merge pass is mandatory**, not a nice-to-have. Greedy online
    clustering across separate runs *will* create duplicates.
13. **Plan storage from day one.** Vectors dominate, and they are the data with the
    shortest useful life.
14. **Keep the fallback path even when the budget it protected is gone.** Degrading to a
    cheaper algorithm under pressure is the difference between a slow pipeline and a
    stopped one.

---

## Appendix — file map

| Concern | File |
|---|---|
| Data shapes | `packages/backend/convex/schema.ts` |
| What runs when | `crons.ts` |
| Acquisition, dedup, canonicalization | `ingestion.ts` |
| Content extraction | `lib/articleExtraction.ts` |
| Enrichment orchestration | `enrichmentNode.ts` + `enrichment.ts` |
| Clustering (matcher: `findBestCandidate`) | `clustering.ts` |
| Topic inference | `clustering.ts` (`evaluateTopicInference`) + `topicCatalog.ts` |
| Synthesis | `summarizationNode.ts` + `summarization.ts` |
| Prompts | `prompts.ts` |
| Claim graph | `claimDivergence*.ts` |
| Read models / feed | `events.ts`, `lib/publicEventPreviews.ts`, `lib/feedSerialization.ts` |
| Model calls + budget | `lib/aiCall.ts`, `aiBudget.ts`, `lib/modelRouting.ts` |
| Vector budget **[CONVEX]** | `vectorSearchBudget.ts` |
| Locks / logs / alerts | `ingestion.ts` (locks), `pipeline.ts`, `pipelineDiagnostics.ts` |
| Config | `config.ts` |
| Compliance | `lib/tdmPolicy.ts`, `domainPermissions*.ts`, `lib/verbatimOverlap.ts`, `generationAudit.ts`, `lib/politeFetch.ts` |
| Retention | `retention.ts`, `lib/retentionPolicy.ts` |
| Maintenance | `singletonCleanup.ts`, `clustering.ts` (merge/recluster/prune) |

Related: `docs/SYSTEM-OVERVIEW.md` (product-level tour, incl. the user-facing surfaces this
document omits), `docs/pipeline-operations-runbook.md` (incident response),
`docs/clustering-romanian-tuning.md`, `docs/bias-axis-spec.md`.
