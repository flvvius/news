# Biviant — System & Feature Deep-Dive

> Status: this document reflects the **current code** (not the stale top-level `README.md`, which predates clustering, summarization, claims, quizzes, and the public read-model). Where they disagree, the code wins. File references point at `packages/backend/convex/*` unless noted.

Biviant is a **bias-aware news aggregator** for the Romanian market (the web app routes are Romanian; content is bilingual EN/RO in places). It ingests RSS feeds from outlets across the political spectrum, clusters articles that cover the same real-world story into **events**, and for each event produces:

- **Multi-perspective summaries** (left / center / right) plus a "global impact" line, all strictly grounded in the source articles.
- A **claim agreement/divergence graph** showing where outlets agree, disagree on numbers, frame things differently, or report something only one side covers.
- **Source reputation** metadata (political lean + factual reliability, MBFC-style) and **per-article AI bias scoring** that can flag an article as an outlier vs. its own outlet.
- Engagement mechanics: reading streaks, a personal "bias balance" meter, a daily grounded news quiz, bookmarks, and (gated) morning push briefings.

The whole content pipeline is **autonomous**: a set of Convex cron jobs run continuously, each picking up where the last left off, with cost controls, leases, and kill-switches so it stays cheap and safe to run unattended.

---

## 1. Tech stack & runtime model

- **Backend: [Convex](https://convex.dev)** — a reactive serverless DB + function platform. This is where ~all the interesting logic lives (`packages/backend/convex`).
- **Web: TanStack Start + React 19 + Tailwind v4** (`apps/web`).
- **Native: Expo / React Native** (`apps/native`) — now a real product surface (feed, event detail, claims, quiz, streaks), not just a shell.
- **Auth: Better Auth** with a Convex storage adapter (email/password + Google + Apple, cross-domain + Expo plugins).
- **AI: Gemini + OpenAI** — `text-embedding-3-small` (OpenAI) for embeddings (512 dims), and **`gemini-3.1-flash-lite`** (via Gemini's OpenAI-compatible API) as the default chat model for reasoning tasks (bias scoring, summaries; fact extraction/claim divergence are paused). Every model id is **runtime-configurable** via the `config` table — gemini-* ids route to Gemini, everything else to OpenAI (`lib/modelRouting.ts`).
- **Email: Resend**. **Analytics: PostHog** (instruments every LLM call for token/cost/latency tracking).

### Convex function types you'll see everywhere
- **`query`** — read-only, reactive, runs in Convex's deterministic V8 runtime.
- **`mutation`** — transactional writes, V8 runtime, no network/`fetch`.
- **`action`** — can do I/O (`fetch`, OpenAI). Cannot touch the DB directly; it calls queries/mutations via `ctx.runQuery`/`ctx.runMutation`. Files ending in `Node.ts` (`enrichmentNode`, `summarizationNode`, etc.) declare `"use node"` so they run in the **Node.js runtime** (needed for the OpenAI SDK, PostHog, `crypto`).
- **`internal*`** variants are not exposed to clients; the pipeline is built almost entirely from `internalAction`/`internalMutation`/`internalQuery`.

The recurring architectural pattern: **an action orchestrates** (fetch, call OpenAI, decide), and **delegates all DB reads/writes to internal queries/mutations**, so the side-effecting steps are small, transactional, and idempotent.

---

## 2. Data model (the important tables)

Full definitions in `schema.ts`. Highlights and *why* they're shaped that way:

### Core content
- **`sources`** — one row per outlet (`domain`, `name`, `baseBias` −5..+5, `reliabilityScore` 1–10, optional MBFC fields `mbfcCategory`/`mbfcFactual`/`mbfcCredibility`). Also stores **rolling article-bias stats** (`rollingBiasMean/Stddev/SampleSize`) used by the daily outlier job.
- **`articles`** — the evidence layer. Ingested first as `unprocessed`, then walks a status machine: `unprocessed → processing → enriched → clustered` (or `discarded`/`archived`). Holds the enrichment outputs: `summary`, `entities`, `atomicFacts`, `aiBiasScore` + `biasComponents`, `extractionQuality` (`strong`/`weak`), image metadata, and a `contentFingerprint` for dedup. Many `*Status`/`*Attempts`/`*LeaseExpiresAt` fields drive durable retry of each AI sub-step.
- **`events`** — the UI-facing story cluster. Holds `perspectiveSummaries{center,left,right}`, `globalImpact`, `status` (`processing`/`published`), counts, `sourceIds`, and "freshness" markers (`lastSummarizedAt`, `lastSummarySignature`, `lastClaimAnalysisAt`, `factualArticleCount/SourceCount`).
- **`eventTopics`** — junction (event ↔ topic), avoids an array column and gives reverse lookups.
- **`articleEmbeddings` / `eventEmbeddings`** — embeddings are stored in **separate tables** (hot/cold split) so normal reads don't drag ~12 KB vectors around. Both have a 512-dim `vectorIndex`.

### Clustering-specific read models (performance)
- **`eventEmbeddingHot`** — a *small* physical mirror of embeddings for only **recent (≤48 h)** events. Clustering vector-searches this tiny table instead of the full `eventEmbeddings`, which keeps query cost (and Convex's billed "qGB") low. Pruned hourly.
- **`eventCandidacy`** — a denormalized per-event "clustering snapshot": title/evidence/fact/entity tokens, topic slugs, counts, source ids. Lets the matcher score candidates without re-reading articles.
- **`publicEventPreviews` + `publicEventPreviewTopics`** — denormalized **feed cards** for anonymous traffic (title, image, summaries, source chips, bias counts, `trendingScore`). The feed never scans `events`; it scans these.
- **`publicFeedSnapshots` / `publicSitemapSnapshots`** — fully precomputed first-page JSON / sitemap XML so crawler and cold anonymous loads skip live ranked scans entirely.

### AI features
- **`eventSummaryJobs`** — a durable queue (queued/processing/succeeded/failed/skipped, with leases + `nextAttemptAt` backoff) for perspective summarization.
- **`eventClaims`** — the agreement/divergence graph: `canonicalStatement`, `claimType`, `status`, `variants[]` (each pointing at a specific article + source + lean + the exact statement/value), `importance`, `confidence`.
- **`dailyQuizzes` / `quizAttempts`** — one globally-shared, UTC-dated quiz built from grounded claims/facts; bilingual questions.

### Users & engagement
- **`users`** (profile + `followedTopicIds`), **`userStats`** (streak, `articlesRead`, `biasBalance` −100..+100), **`userPrivateContext`** (income/concerns/leaning — structurally isolated for stricter RLS), **`userInsights`** (the personalized "So What?" per event), **`interactions`** (immutable event log: view/click/bookmark/share/feedback), **`guestMerges`** (idempotent guest→account migration ledger), **`pushTokens`**, **`briefingSends`** (dedupe ledger).

### Ops / cost
- **`config`** (runtime KV, JSON-encoded) + **`pipelineRuntimeConfig`** (a single collapsed snapshot of all clustering knobs).
- **`aiUsage`** + sharded **`aiBudgetDaily`/`aiBudgetDailyTotal`/`aiBudgetReservations`** (AI spend), **`vectorSearchDaily*`/`vectorSearchReservations`/`vectorSearchRuns`** (Convex vector-search budget), **`pipelineLocks`** (leases), **`pipelineRunLogs`/`pipelineAlerts`/`pipelineAdminRollups`** (observability), **`clusteringJobState`** (cursors), **`rateLimits`** (fixed-window abuse limits).

---

## 3. The autonomous pipeline (ingestion → published event)

This is the heart of the system. It's a chain of cron-driven stages (`crons.ts`), each of which also **self-schedules the next stage** when it produces output, so fresh content flows through faster than the fixed cron cadence alone.

```
RSS feeds
  │  ingest-rss-feeds (60m)            ingestion.ts
  ▼
articles (unprocessed)
  │  enrich-articles (40m)             enrichmentNode.ts
  │   • fetch full text, extract body/entities/summary
  │   • embeddings (text-embedding-3-small, 512d)
  │   • atomic-fact extraction (gpt-5-nano)
  │   • per-article bias scoring (gpt-5-nano)
  ▼
articles (enriched)
  │  cluster-enriched-articles (40m)   clustering.ts
  │   • vector search hot index → candidate events
  │   • multi-signal gate → attach or create event
  │   • publish when ≥2 articles AND ≥2 sources
  ▼
events (processing → published)  +  publicEventPreviews
  ├─ merge-near-duplicate-events (20m)        collapse dupes
  ├─ recluster-recent-singletons (30m)        improve recall
  ├─ archive-stale-singleton-events (1h)      shrink vector index
  │
  ├─ summarize-published-events (45m)  summarizationNode.ts  → perspectiveSummaries + globalImpact
  ├─ detect-event-claims (45m)         claimDivergenceNode.ts → eventClaims graph
  ├─ flag-bias-outliers (daily)        bias.ts                → per-source rolling stats
  └─ generate-daily-news-quiz (daily)  quizNode.ts            → dailyQuizzes
```

### 3.1 Ingestion (`ingestion.ts`)
Entry: `ingestAllFeeds` (cron, 60 min). Feeds are **curated by hand** in `feeds.ts` (Romanian launch set, two tiers), with bias/reliability derived from the manual reputation seed in `sourceReputation.ts` — the single source-metadata path (the old MBFC API integration was removed in BIV-402).

Per feed (`ingestSingleFeed`, an action):
1. **Get-or-create the source** by domain (logo via Clearbit).
2. **Fetch** the XML with a browser-like User-Agent and a 15 s timeout.
3. **Parse** RSS 2.0 or Atom with a dependency-free regex parser (handles CDATA, `media:content`/`enclosure` images, etc.). Titles are normalized (strips " - Reuters"-style outlet suffixes); snippets are HTML-stripped.
4. **Canonicalize URLs** for dedup: force https, drop `www.`/`m.`/`amp.`/`edition.` prefixes, apply host aliases (`bbc.co.uk → bbc.com`), strip all `utm_*`/`fbclid`/`gclid`-type params, sort remaining params, drop trailing slash, normalize `/amp` paths.
5. **Filter** to the last 72 h.
6. **Dedup** three ways: a **feed-level fingerprint** (if the whole feed is unchanged since last run *and* there were no failures, short-circuit with zero work), **canonical URL** match, and a **content fingerprint** (`sourceId` + hash of normalized title+snippet) to catch the same story re-published at a new URL.
7. **Insert** new articles as `unprocessed` (batches of 50).
8. **Update `ingestionMeta`** (feed health: last success, consecutive failures, last error, running article count).

The batch driver processes feeds sequentially, **retries failed feeds once** after a 3 s delay, holds a **run-level lease** (`pipelineLocks`) so overlapping cron/manual runs don't pile up, respects the **`pipeline_paused` kill-switch**, writes a `pipelineRunLogs` row, and—if anything was inserted—**schedules enrichment 60 s later** instead of waiting for the enrichment cron.

### 3.2 Enrichment (`enrichmentNode.ts` + `enrichment.ts`)
Entry: `enrichUnprocessedArticles` (cron, 40 min; also self-triggered after ingestion). Batch size 40, with a budget check up front.

1. **Atomically claim** a batch of `unprocessed` (or expired-lease) articles via a lease (`enrichmentRunId` + `enrichmentLeaseExpiresAt`, 15 min TTL). Every later write re-checks the lease so two overlapping runs never double-process an article ("lease no longer belongs to run X → skip").
2. **Content extraction** (`lib/articleExtraction.ts`, concurrency 5): fetches the real article HTML (8 s timeout), pulls the body via priority patterns (`<article>`, `<main>`, `articleBody`/`story-body` selectors), then JSON-LD, then meta tags, falling back to the RSS snippet. Resolves **Google News redirect links** via the `batchexecute` RPC. Derives entities via a Unicode-aware capitalized-sequence matcher (the English-only `wink-nlp` model was removed in BIV-601) and a short summary. Detects an OG/Twitter/JSON-LD/inline lead image. Classifies `extractionQuality` as **`strong`** (real body text) or **`weak`** (snippet-only) — this later loosens/tightens clustering thresholds.
3. **Embeddings**: one `text-embedding-3-small` call for the batch at **512 dimensions** (`EMBEDDING_VERSION = 4`; bumping it triggers re-enrichment). Articles whose embedding failed are `discarded`.
4. **Atomic fact extraction** (`gpt-5-nano`, JSON-schema-constrained): each article → up to 8 short, standalone, verifiable claims ("Vote count: 60–40", "Passed Tuesday"). These are the cheap tokens fed to summarization and claim analysis instead of full text. Prompt in `prompts.ts → buildArticleFactExtractionPrompt`.
5. **Per-article bias scoring** (`gpt-5-nano`, JSON-schema): scores four sub-dimensions on anchored scales — `politicalLean` (−5..+5), `emotionalLanguage` (0..5), `sourceDiversity` (0..5), `factOpinionRatio` (0..5) + a cited rationale. **The model scores the *text*, explicitly not the outlet's reputation.** These combine into a single `aiBiasScore` via a weighted formula (`combineBiasScore`): political lean amplified by emotional/opinion intensity, dampened by source diversity, clamped to ±5. `sourceBiasDelta = aiBiasScore − source.baseBias`; if `|delta| ≥ threshold` the article is flagged as diverging from its outlet's baseline.
6. **Persist** (`markArticleEnriched`) and mark `enriched`. Each AI sub-step has its **own status** (`succeeded`/`deferred`/`failed`/`skipped`), so a budget-exhausted fact-extraction defers *just that step* (re-tried later) without blocking the embedding/bias path. Touched events get their presentation refreshed.
7. If anything was enriched, **schedule clustering 90 s later**.

Backfill variants exist for re-embedding (`reenrichArticlesBackfill`), filling atomic facts on old articles (`backfillAtomicFacts`), and re-doing a single event's articles.

### 3.3 Clustering (`clustering.ts`, ~6.6k lines — the core algorithm)
Entry: `clusterEnrichedArticles` (cron, 40 min; also self-triggered). Goal: assign each enriched article to an existing event or create a new one, then promote events to `published`.

**Event embedding = the running arithmetic mean of its member-article embeddings** (`appendArticleEmbeddingToEventMean`), so an event's vector is the centroid of its coverage.

For a batch of up to 32 enriched articles:

1. **Candidate retrieval (two modes).** Normally each article's embedding is searched against the **hot vector index** (`eventEmbeddingHot`, recent events only). Matches are hydrated into `ClusterCandidate`s (centroid embedding + token sets + counts). When the **vector-search budget** is exhausted, it falls back to loading recent candidates from `eventCandidacy` and scoring them in-process. A **representative cache** reuses one article's search results for near-identical later articles (above the strong-similarity threshold) to save vector queries.

2. **Matching gate (`findBestCandidate`).** This is *not* pure cosine similarity — it's a multi-signal gate combining the embedding score with **lexical evidence**:
   - Cosine similarity must clear a **min** threshold (default 0.74), or a **strong** threshold (0.84) that bypasses the lexical check.
   - **Lexical/semantic/topic support**: token overlap + Jaccard across **title, evidence (snippet+summary), atomic-fact, and entity** token sets; shared topic slugs lower the bar slightly.
   - **Same-source guard**: two articles from the *same* outlet need a higher similarity to merge (default 0.84+) — prevents one outlet's two stories collapsing together.
   - **Weak-extraction guard**: snippet-only (`weak`) articles need higher thresholds (0.82/0.88) because their embeddings are noisier.
   - Candidates outside a **48 h time window** are rejected.
   - Surviving candidates are ranked by a weighted score (similarity 0.43 + evidence/entity/title/fact Jaccards + recency + overlap + a small cross-source-diversity bonus). Near-misses are logged for tuning.

3. **Two-phase batch attach.** Articles that match an existing event attach immediately (`attachArticleToEvent`, which updates the centroid, counts, tokens, and may promote the event to `published`). Unmatched articles go into a **pending list**, sorted by a "seed rank" (strong extraction > more entities > longer title > newer). The pending pass then tries **batch-local matching** — matching pending articles against events *created earlier in the same batch* — and, if the batch state changed, re-runs a fresh vector search. Whatever still doesn't match **creates a new event** (`createEventFromArticle`) seeded with the article's snippet as a heuristic `center` summary.

4. **Publish gate (`shouldPublishCluster`).** An event becomes `published` only with **≥2 articles AND ≥2 distinct sources** (configurable). Single-source clusters stay `processing` (invisible to the feed) until corroborated — this is the "we only show a story once more than one outlet covers it" rule.

5. **Follow-ups.** If anything clustered, it schedules **merge-near-duplicate-events** (5 min) and, if new events were created, **recluster-recent-singletons** (10 min). Throughout, it holds a lease, tracks vector-search reservations, and flushes detailed metrics to `vectorSearchRuns`/`pipelineRunLogs`.

**Merge pass (`mergeNearDuplicateEvents`, 20 min):** collapses near-duplicate *published* events created across separate runs (very high similarity ≥0.94 + high title Jaccard + within 48 h). Picks a canonical event, re-parents articles, merges summaries/topics/embeddings.

**Recluster pass (`reclusterRecentSingletonEvents`, 30 min):** revisits recent singleton/tiny events after more articles have arrived, recovering stories that were under-clustered online.

**Archive pass (`archiveStaleSingletonEvents`, hourly):** archives stale `processing` singletons so they stop bloating the vector index; **`pruneHotEventEmbeddings`** drops hot rows for events that went quiet.

### 3.4 Topic inference (in `clustering.ts` + `topicCatalog.ts`)
Topics are a curated taxonomy (`topics` table: slug, display name, keywords, key phrases, exclude phrases). At cluster time, `inferTopicSlugs` scores an article's text against each topic (keyword + phrase matching with exclude-phrase vetoes), and assigns topics that clear a **min score (4.5)** and a **confidence ratio** relative to the top topic, capped at 3. No LLM call — it's deterministic lexical scoring, kept in sync via `syncTopicCatalog`.

---

## 4. Event-level AI features (what's behind each thing on the event page)

### 4.1 Perspective summaries + global impact (`summarization*.ts`, prompt in `prompts.ts`)
The three-column **left / center / right** summaries plus the **"global impact"** line shown on every event.

- **Queue, not inline.** `summarize-published-events` (cron, 45 min) enqueues eligible events (published, **≥3 articles & ≥2 sources**, summary stale) into `eventSummaryJobs`, then schedules a few `processSummaryJob` actions. Decoupling from clustering means model latency/budget never blocks the feed. Jobs have leases, exponential backoff (`5min × 2^attempt`), max attempts, and a queue-health alarm cron that warns on duplicate/too-deep queues.
- **Input is cheap.** Up to 12 most-recent articles, each reduced to title + source lean/reliability + extracted summary + RSS snippet + **atomic facts** — not full text.
- **Strict grounding (the prompt is the product).** The system prompt forces: use only supplied material, never invent; prefer facts confirmed by ≥2 sources, attribute single-source facts; call out contradictions with attribution; group by source lean (left/left-center → left field, etc.); a **precomputed per-side article count** drives one of three "cases" — if a side has ≤1 article it must emit a fixed "Limited X-leaning coverage" fallback (no hallucinated framing), otherwise 50–100 words of real shared/divergent framing. `globalImpact` must be a concrete stated consequence/stake with a source name, or an exact fallback string if the coverage is purely procedural. Banned: hype words, unsupported "could/may/might", source-motive editorializing.
- **Output**: JSON-schema-constrained `{center,left,right,globalImpact}`, validated against word caps with one corrective retry. On success it patches the event (`perspectiveSource:"ai"`), **resyncs the public preview**, and queues a **social share image** render (`shareAssets*.ts`, an OG card stored in Convex file storage).
- **Idempotency**: a SHA-256 **summary signature** over the event's articles/facts; if unchanged since last run the job is skipped (and the timestamp bumped) — no wasted tokens.

### 4.2 Claim agreement/divergence (`claimDivergence*.ts`, prompt in `prompts.ts`)
The **"where sources agree / disagree"** comparison cards (`event-claim-comparison.tsx`).

- `detect-event-claims` (cron, 45 min) scans for **stale eligible events** and runs `gpt-5-nano` on their atomic facts. Eligibility uses `factualArticleCount/SourceCount` coverage (maintained by `eventClaimCoverage.ts`) so events without enough fact-bearing articles are skipped cheaply.
- The model groups facts that express the **same underlying claim** and classifies each into one of six **statuses**: `agreement`, `divergence` (same claim, different numbers/dates/outcomes), `framing` (same fact, different characterization), or `exclusive_left/right/center` (only one lean reports it). Each claim also gets a `claimType` (quantitative/event/attribution/policy/characterization), `importance` (1–5), and `confidence` (0–1). Every variant must cite the **exact `articleIndex`+`factIndex`** of a real input fact.
- **Heavy server-side sanitization (`sanitizeClaims`)** before storing — the model is not trusted blindly:
  - Each variant is re-verified to actually support the canonical statement via **token-overlap with stemming + synonym canonicalization** (`rise/rises/grow → increase`, `ban → prohibit`, etc.); unsupported variants are dropped.
  - Status is **recomputed from evidence**: `divergence`/`framing` require ≥2 distinct sources or they downgrade to `agreement`/exclusive; a "divergence" whose values are actually identical becomes `agreement`; `exclusive_*` is derived from the actual lean groups present.
  - Capped at 12 claims, sorted by importance then confidence.
- **Fail-closed**: an empty/over-filtered result **preserves the prior stored card** rather than wiping it. A SHA-256 input signature skips unchanged events.

### 4.3 Source factuality & per-article bias (what the bias indicators mean)
Two distinct, layered signals the UI surfaces:

- **Source level** (`sources` + `lib/sourceBias.ts`): each outlet's **political lean** (MBFC category if present, else `baseBias` bucketed into left / left-center / center / right-center / right) and **factual reliability** (1–10 + MBFC factual/credibility). Drives the source chips and the `bias-distribution-bar` / `source-coverage-summary` (how many left/center/right outlets cover this story).
- **Article level** (`enrichmentNode` + `bias.ts`): the AI `aiBiasScore` for the *specific article's text*, and an **outlier flag**. The daily **`flag-bias-outliers`** job computes each source's **rolling mean/stddev** of article bias over 30 days (min 10 samples) and flags any article more than `multiplier × stddev` from its outlet's norm — i.e. "this piece is unusually partisan *for this outlet*." This is why an article from a normally-centrist source can be highlighted as off-baseline.

### 4.4 Personalized "So What?" (`insights.ts` + `userInsights`)
A signed-in user can have a per-event **`personalImpact` + `actionableTip`** generated against their private context (job, location, concerns, leaning in `userPrivateContext`). `insights.ts` exposes the **read** (with 30-day expiry + event-version invalidation); generation is gated/personal and intentionally separate from the public `globalImpact` (which is the consensus "so what" shown to guests).

### 4.5 Daily news quiz (`quiz*.ts`)
`generate-daily-news-quiz` (daily, 06:00 UTC) builds **one globally-shared, UTC-dated quiz** from recent events' claims and atomic facts.

- Question types: `claim_attribution`, `fact_check`, `perspective_match`, `coverage_gap` — all **media-literacy** oriented (who said what, what only one side covered) rather than trivia. Bilingual EN/RO.
- **Grounding is enforced** (`hasGrounding`): every generated question's claim must token-overlap an actual stored claim/fact, or it's dropped — the quiz can't drift into invented facts.
- Correct-answer placement is **deterministically reshuffled** (`quizHelpers.ts`) so the right answer isn't always in the same slot. An input signature avoids regenerating an identical quiz. Users submit `quizAttempts` (score/maxScore).

---

## 5. The reading surface (feed, event page, engagement)

### 5.1 Feed (`events.ts` + `lib/feedSerialization.ts` + `lib/publicEventPreviews.ts`)
The feed is **event-driven and served entirely from denormalized read models**, never from the `events`/`articles` tables directly:

- **`publicEventPreviews`** holds ready-to-render cards; **`publicEventPreviewTopics`** indexes them per topic. They're (re)written by `syncPublicEventPreview` whenever an event changes/publishes.
- **Two sorts**: `recent` (cheap indexed pagination by `lastUpdatedAt`) and `trending`. **Trending score** = `factualSourceCount×10 + factualArticleCount×3 + recencyHours` — i.e. cross-source corroboration dominates, with recency as a tiebreaker. This deliberately ranks **well-corroborated stories** above single-outlet noise.
- **Anonymous acceleration**: the trending first page is precomputed into `publicFeedSnapshots` by a cron (every 20 min) and served as static JSON to cold/anonymous loads; pagination then hands off to the live ranked query via an encoded `ranked:` cursor so it never dead-ends at the snapshot size. Sitemap XML is similarly precomputed.
- **Search** uses Convex full-text search over preview titles. **Topic filtering** uses the per-topic index.
- **Personalization** (signed-in): `followedTopicIds` drive a **client-side boost**, explicitly *not* a hard filter — you still see everything, your topics just rank higher.

### 5.2 Event detail (`events.ts → getEventBySlug`)
Loads the event + its topic ids + all member articles (joined to their sources) + the ready share image. The page renders: the perspective tabs (4.1), the claim comparison cards (4.2), the source list with bias/reliability (4.3), and the article evidence list. Native mirrors this (`apps/native/components/event/*`: `perspective-summaries`, `event-claim-comparison`, `event-sources`).

### 5.3 Engagement (`interactions.ts`)
- **Reading streak** (`lib/streaks.ts`): UTC-day based; consecutive days increment, a gap resets to 1, `longestStreak` tracked. Surfaced as a streak calendar + teaser banner.
- **Bias balance** (`foldViewStats`): a rolling average of the **source bias** of everything you read, scaled to −100..+100 ("Left Bubble" ↔ "Right Bubble"). Rounded **at every step** so the stored value is reproducible; this matters because the **guest-merge replay** must fold N offline reads and land on exactly the same number as if they'd been applied live one-by-one (the explicit correctness contract behind guest→account migration).
- **Bookmarks**: stored as `interactions` rows (not a separate table) with a **cooldown dedup** — rapid toggles patch the existing row instead of inserting, bounding writes.
- **Guest-first onboarding**: guests accumulate reads/topics/streaks locally (device UUID); on signup `mergeGuestActivity` folds them into the account **once** (idempotent via `guestMerges`, keyed on device id, rate-limited). The device UUID rotates on logout so each guest session merges at most once.

### 5.4 Notifications (`notifications.ts` + `briefing.ts`)
Expo push tokens (one row per device, deduped, registered only for authed users). The **morning briefing** (daily 07:00 UTC) picks one fresh story in each user's followed topics they haven't been sent (deduped via `briefingSends`) and pushes it. **Gated behind `BRIEFING_ENABLED`** so it stays dormant until push infra is live. Invalid tokens are pruned on send failure.

---

## 6. Cross-cutting infrastructure

### 6.1 Cost control — AI budget (`aiBudget.ts` + `lib/aiCall.ts`)
Every OpenAI call goes through **`callOpenAI`**, which implements a **reserve → call → settle** protocol so concurrent actions can't collectively blow the daily cap:
1. **Estimate** cost from token estimates × per-model rates (`DEFAULT_MODEL_RATES`, overridable via `config.model_rates`), +10% safety margin.
2. **Reserve** that amount against the **sharded daily budget** (`aiBudgetDaily` sharded by UTC hour + a total). If it'd exceed `ai_daily_budget_usd`, the call returns `budget_exhausted` and the caller defers.
3. **Call** OpenAI with retry/backoff (retries 429/5xx, bails on 401/403/404). GPT-5-family calls use `reasoning_effort`/`max_completion_tokens` and **prompt caching** (`prompt_cache_key` per call type) — cached input tokens are billed at 10%.
4. **Settle**: replace the reservation with actual logged usage in `aiUsage`; on failure, **release** the reservation. Expired reservations are swept hourly.

Budget checks also happen *before* each batch stage, and the **per-sub-step `deferred` status** means a mid-batch budget exhaustion degrades gracefully (do the cheap parts now, retry the expensive parts next run).

### 6.2 Cost control — vector-search budget (`vectorSearchBudget.ts`)
Convex bills vector search by bytes scanned ("qGB"). Clustering **reserves** an estimated qGB budget per run (calibrated from observed per-search bytes), and when exhausted **falls back** to the in-process candidate-scoring mode (§3.3) instead of vector search. Detailed per-run telemetry (`vectorSearchRuns`) is retained short-term; daily totals persist.

### 6.3 Concurrency & idempotency
- **Leases** (`pipelineLocks`, `acquirePipelineLock`/`releasePipelineLock`) give every long job an at-most-one-runner guarantee with TTL-based recovery.
- **Per-record leases** (`enrichmentRunId`, summary `processingRunId`, job `leaseExpiresAt`) make individual items safe under overlapping runs.
- **Content/summary/claim/quiz signatures** (SHA-256 of inputs) make every expensive stage a no-op when nothing changed.
- **Self-scheduling** (`ctx.scheduler.runAfter`) chains stages reactively without tightening cron cadence.

### 6.4 Runtime config & kill-switch (`config.ts`)
A `config` KV table holds **dozens of tunables** (clustering thresholds, publish minimums, summary/claim/quiz model + limits, budgets, cooldowns, feature flags) read at runtime — so behavior is tuned without deploys. `refresh-pipeline-runtime-config` (hourly) collapses the clustering-related keys into **one `pipelineRuntimeConfig` snapshot** so each pipeline run does one read instead of N. **`pipeline_paused = true`** is a global kill-switch every job checks first.

### 6.5 Observability (`pipeline.ts` + `pipelineDiagnostics.ts`)
Every job writes a **`pipelineRunLogs`** row (status ok/skipped/degraded/error, counters, gauges). **`check-pipeline-alerts`** (every 20 min) raises `pipelineAlerts` for persistent fallback mode, publish droughts, stuck `processing` growth, vector-budget burn, job error rates, and missed archive runs. There's an **admin pipeline dashboard** (`apps/web/src/routes/admin.pipeline.tsx`, backed by admin queries in `clustering.ts`, `summarization.ts`, etc.) and a **cluster-pair labeling** tool (`clusterPairLabels`) to build ground truth for tuning thresholds. Logs are retained ~14 days.

### 6.6 Auth, privacy, maintenance
- **Better Auth** (`auth.ts`) with email/password + Google + Apple (incl. bundle-id `aud` verification), cross-domain + Expo. On user create → triggers create `users` + `userStats`; on delete → cascade cleanup. Email verification via Resend; **unverified accounts are GC'd after 7 days** (`authMaintenance.ts`).
- **Privacy by structure**: profile, hot stats, and sensitive `userPrivateContext` live in separate tables so private context never rides along on profile reads. GDPR work and rate limiting (`lib/rateLimit.ts`) on guest-reachable mutations are in place.

---

## 7. Mental model / glossary

- **Article** = one outlet's coverage (the evidence). **Event** = a cluster of articles about one real-world story (the unit users browse). **Source** = an outlet, with lean + reliability.
- **Atomic facts** = short verifiable claims extracted per-article; the cheap currency that powers summaries, claims, and quizzes (full text is never sent to the synthesis models).
- **Embedding** = 512-dim `text-embedding-3-small` vector; an event's embedding is the **centroid** of its articles'.
- **Publish gate** = a story only reaches the feed once **≥2 sources** corroborate it.
- **Hot vs cold tables** = recent/active data is mirrored into small physical tables (`eventEmbeddingHot`, `publicEventPreviews`, snapshots) so hot read/search paths stay cheap.
- **Reserve-then-settle** = the pattern guarding both the dollar (AI) budget and the Convex vector-search budget.

### Where to look first
| To understand… | Read… |
|---|---|
| Data shapes | `schema.ts` |
| What runs when | `crons.ts` |
| Ingestion/dedup | `ingestion.ts` |
| Embeddings + facts + article bias | `enrichmentNode.ts`, `lib/articleExtraction.ts` |
| Clustering algorithm | `clustering.ts` (`findBestCandidate`, `clusterEnrichedArticles`) |
| The AI prompts (the product's "voice" + rules) | `prompts.ts` |
| Summaries | `summarizationNode.ts` + `summarization.ts` |
| Claims | `claimDivergenceNode.ts` |
| Bias outliers | `bias.ts` |
| Feed/trending | `events.ts`, `lib/publicEventPreviews.ts`, `lib/feedSerialization.ts` |
| Engagement | `interactions.ts`, `lib/streaks.ts` |
| Cost controls | `lib/aiCall.ts`, `aiBudget.ts`, `vectorSearchBudget.ts` |
| Config/kill-switch | `config.ts` |
