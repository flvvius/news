# Miez

Miez is a Romanian news aggregator that groups coverage of the same story from
outlets across the political spectrum, then shows how those outlets differ.
The repo is a pnpm/Turbo monorepo: a Convex backend, a TanStack Start web app,
and an Expo mobile app.

The product name is Miez. The workspace, packages and Convex functions are
still named `news-app` / `@news-app/*`, and older tickets and comments use the
previous name, Biviant.

## What it does today

- Ingests 18 hand-curated Romanian RSS feeds four times a day. `feeds.ts` has
  three tiers; `sourceReputation.ts` rates 29 outlets, including ones rated but
  never ingested.
- Embeds each article, then clusters articles into `events` by a mix of vector
  similarity and lexical overlap.
- Publishes an event only once at least 2 articles from at least 2 distinct
  sources cover it and a summary passes the grounding gate. Single-source and
  unsummarized clusters stay invisible.
- Writes perspective summaries per event on the reformist/suveranist axis, plus
  a neutral one and a "global impact" line.
- Shows per-source political lean and reliability, hand-curated in
  `sourceReputation.ts`.
- Serves the feed from denormalized read models and precomputed snapshots, not
  from `events` directly, because Convex bills database I/O by bytes read.
- Tracks reading streaks, a bias-balance meter, bookmarks and followed topics,
  with guest activity merged into the account on signup.

Both apps are Romanian-first. UI strings live in one catalog,
`packages/i18n/src/strings.ts`, with ro and en.

## What is deliberately switched off

Do not treat these as bugs or propose re-enabling them without asking. Each was
turned off on purpose, mostly to keep the Convex bill under control.

| Feature | Where it is off | Why |
|---|---|---|
| Claim divergence analysis | `claim_analysis_enabled = false`, commented-out cron, `FEATURE_FLAGS.claimAnalysis` | Paused for the Romanian launch (BIV-602) |
| Daily quiz | commented-out cron, `FEATURE_FLAGS.quiz`, `/quiz` redirects to `/` | Built from claim data the paused pipeline no longer produces |
| Bias outlier flagging | commented-out cron | Cost |
| Custom event share images | `event_share_asset_generation_enabled = false` | Sharing uses the original event photo instead |
| Summary body fetch | `event_summary_body_fetch_enabled = false` | Refetching bodies per summary was the most expensive operation in the app |
| Morning push briefing | `BRIEFING_ENABLED` unset | Waits on push infrastructure |

One invariant to know before touching any of this: either
`article_fact_extraction_enabled` or `event_summary_body_fetch_enabled` must
stay on. With both off, the grounding corpus shrinks to the article summary
plus the RSS snippet, roughly 200 characters per article, and every summary is
blocked as ungrounded. That combination stopped publishing entirely for about
three weeks in August 2026. Fact extraction is the cheap side of that pair and
is on.

Article body text is fetched transiently and never persisted. That is a legal
constraint, not a storage optimization. See `docs/compliance-storage-inventory.md`.

## Repo layout

```text
.
├── apps/
│   ├── web/            TanStack Start web app (Vercel)
│   └── native/         Expo / React Native app
├── packages/
│   ├── backend/        Convex functions, schema, pipeline, auth, emails
│   ├── i18n/           shared ro/en string catalog, brand name, date/plural helpers
│   └── config/         shared TS config
├── docs/               system overview, runbooks, compliance and tuning notes
├── .claude/            repo reference notes and project skills
├── eval/               offline scripts for clustering/claim evaluation
└── turbo.json
```

## Tech stack

- pnpm workspaces, Turbo
- Convex for data, scheduled jobs, auth storage and file storage
- TanStack Start, React 19, Tailwind v4, Radix on web
- Expo Router, React Native, FlashList on native
- Better Auth (email/password, Google, Apple) with the Convex adapter
- OpenAI `text-embedding-3-small` at 512 dimensions for embeddings
- `gemini-3.1-flash-lite` through Gemini's OpenAI-compatible API for chat work.
  Model ids are runtime config: a `gemini-*` id routes to Gemini, anything else
  to OpenAI (`lib/modelRouting.ts`)
- Resend for email, PostHog for analytics and LLM call instrumentation

## Local development

```bash
pnpm install
pnpm dev            # everything
pnpm dev:web        # web only, port 3001
pnpm dev:server     # convex dev
pnpm dev:setup      # convex dev --configure, first-time setup
pnpm dev:native     # expo start --clear
pnpm build
pnpm check-types
```

Two settings catch everyone out on a fresh dev deployment:

```bash
npx convex env set DEPLOY_ENV development
npx convex env set SITE_URL http://localhost:3001
```

Convex reports `NODE_ENV=production` on every deployment including dev, so
without `DEPLOY_ENV` a dev backend refuses localhost origins and all local auth
fails with "Invalid origin" (BIV-808/809). `SITE_URL` is Better Auth's
`baseURL`, so without it OAuth redirects and email links point at production.

Run Convex CLI commands from `packages/backend`. Running `npx convex dev` or a
deploy from the repo root pushes an empty function set and wipes the
deployment's functions.

Seeding a fresh deployment:

```bash
npx convex run seeds:seedRomanianSources   # sources with curated lean/reliability
npx convex run config:seedDefaults         # runtime config defaults
npx convex run seeds:seedDB                # demo topics/events/articles
npx convex run seeds:verifySeedData
```

## Tests

There is no root test script. Each package runs its own:

```bash
pnpm -F @news-app/backend test   # 40 convex-test suites
pnpm -F web test                 # vitest + testing-library
pnpm -F native test
pnpm -F web test:e2e             # playwright
```

## The pipeline

Everything runs from `packages/backend/convex/crons.ts`. Since PR #63 the chain
runs in four batch windows a day instead of continuously, because Convex bills
action compute by wall-clock time including time blocked on the network, and
the always-on version cost about $41/mo against a sub-$10 budget.

Each window is phase-staggered so a story still moves end to end inside 45
minutes:

```text
:00  ingest-rss-feeds          ingestion.ts        fetch, parse, canonicalize, dedup, insert
:15  enrich-articles           enrichmentNode.ts   extract body transiently, embed, score bias
:30  cluster-enriched-articles clustering.ts        vector search, multi-signal matching gate
:45  summarize-published-events summarizationNode.ts summaries, gates, and the actual publish
```

Windows start at 00, 06, 12 and 18 UTC. Worst case a story appears in the feed
about 6 hours after publication. That trade was made on purpose.

Supporting jobs run daily or twice daily: near-duplicate event merging,
singleton reclustering, stale singleton archiving, hot vector table pruning,
budget and telemetry cleanup, retention purges, sitemap and feed snapshot
rebuilds, and pipeline alert checks. Each has a comment above it explaining its
cadence, including why several cadences that look arbitrary are not.

Stages self-chain through the scheduler when they produce output, so the cron
only has to start each window.

Summarization is what actually publishes an event, so most "the feed is dead"
reports are summarization incidents, not clustering ones. Two gates sit in
front of a summary:

- The verbatim gate (`lib/verbatimOverlap.ts`) catches long runs of copied
  source wording. Since #69 it retries with a stronger paraphrase instruction
  and records what survived in the audit trail instead of blocking publication.
- The grounding gate (`lib/grounding.ts`) checks each sentence against the
  sources, strips unsupported ones, and blocks the summary as
  `blocked_ungrounded` if nothing survives.

Throughput ceiling is 4 runs a day times `event_summary_batch_size`, so about
48 summaries a day. Healthy observed output is 15 to 17 events a day, which is
news volume rather than capacity. Keep `event_summary_enqueue_limit` at or
below `event_summary_batch_size`: a higher enqueue limit grows the queue every
run and buries fresh events behind backlog.

## Key backend files

| File | What lives there |
|---|---|
| `schema.ts` | every table, index and vector index |
| `crons.ts` | what runs when, and why at that cadence |
| `ingestion.ts` | RSS fetch, parse, canonical URL and content-fingerprint dedup |
| `enrichmentNode.ts` | transient body extraction, embeddings, bias scoring |
| `clustering.ts` | candidate retrieval, the matching gate, publish gate, merge and recluster passes |
| `summarizationNode.ts` | the durable summary job queue |
| `prompts.ts` | every model prompt |
| `events.ts` | feed and event-detail queries |
| `config.ts` | runtime config, kill switch, defaults |
| `aiBudget.ts`, `vectorSearchBudget.ts` | reserve-then-settle spend guards |
| `pipeline.ts`, `pipelineDiagnostics.ts` | run logs, alerts, admin telemetry |
| `retention.ts` | legal minimization plus storage-cost purges |

## Web surface

The feed is at `/`. `/feed` is a permanent 308 redirect that preserves query
params, kept for previously indexed URLs (SEO-1).

Reader routes: `/`, `/event/$slug`, `/source/$sourceId`, `/surse`, `/salvate`,
`/activitate`, `/profil`, `/dashboard`, `/publishers`, `/contact`,
`/reset-password`, `/unsubscribe`.

Content and legal pages: `/despre`, `/cum-functioneaza`, `/metodologie`,
`/sursele-noastre`, `/parteneri`, `/finantare`, `/termeni`,
`/politica-confidentialitate`, `/bot`.

Crawler routes: `/robots.txt`, `/sitemap.xml`, `/news-sitemap.xml`, `/rss.xml`,
`/llms.txt`.

Admin routes are gated on `ADMIN_EMAILS`: `/admin/pipeline`, `/admin/review`,
`/admin/reports`, `/admin/publishers`, `/admin/contact`.

## Native surface

The Expo app is a real product surface now, not the shell the old README
described. It has tabs for feed, activity, saved and profile, plus event
detail, source detail and a topic-picking onboarding flow. It shares the
backend API and the i18n catalog with web.

## Environment variables

Backend variables are set on the Convex deployment with `npx convex env set`.

Auth and identity: `SITE_URL`, `DEPLOY_ENV`, `BETTER_AUTH_SECRET`,
`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `APPLE_CLIENT_ID`,
`APPLE_CLIENT_SECRET`, `APPLE_APP_BUNDLE_IDENTIFIER`, `NATIVE_APP_URL`,
`ADMIN_EMAILS`, and optionally `ALLOWED_ORIGINS` and `CONVEX_ALLOW_LOCALHOST`.

Models, email and analytics: `OPENAI_API_KEY`, `GEMINI_API_KEY`,
`RESEND_API_KEY`, `EMAIL_FROM_ADDRESS`, `EMAIL_REPLY_TO`, `POSTHOG_API_KEY`,
`POSTHOG_HOST`, `BRIEFING_ENABLED`.

Web (`apps/web/.env.example`): `VITE_CONVEX_URL`, `VITE_CONVEX_SITE_URL`.

Native (`apps/native/.env.example`): `EXPO_PUBLIC_CONVEX_URL`,
`EXPO_PUBLIC_CONVEX_SITE_URL`, `EXPO_PUBLIC_POSTHOG_KEY`,
`EXPO_PUBLIC_POSTHOG_HOST`, `EXPO_PUBLIC_SENTRY_DSN`,
`EXPO_PUBLIC_NOTIFICATIONS_ENABLED`, `EXPO_PUBLIC_INTERNAL_DEVICE`.

PostHog is an EU project. Do not point these at the US endpoint.

## Operating it

`pipeline_paused = true` is the global kill switch. Every job checks it first.

```bash
npx convex run config:togglePipeline
npx convex run config:list
npx convex env list
```

Dozens of thresholds are runtime config rather than constants: clustering
similarity gates, publish minimums, per-model ids, budgets, retention windows,
cooldowns. Change behavior there before changing code. `/admin/pipeline` shows
run logs and alerts.

There is one Convex deployment, `quirky-panda-609`, and `CONVEX_DEPLOY_KEY`
selects it. `npx convex run --prod` prints "Ignoring --prod" and uses the key's
deployment anyway, and `convex logs` labels it a dev deployment even though it
serves live data. `convex logs` is a live tail, so sample it for a minute or
two rather than expecting history.

## Deployment

Deploy the backend from `packages/backend` with `npx convex deploy -y`.

Vercel builds the web app with `pnpm turbo run build --filter=web...` and
serves `apps/web/.vercel/output`. Two Vercel projects build `apps/web`,
`news-web` and `news`, on different teams. One failing while the other succeeds
on the same commit is a project-config problem, not a code problem.

Deploy the backend first whenever a change touches both. The web build imports
generated API types, so shipping web against an older backend breaks the build
or the queries.

## Docs

- `.claude/repo-reference.md` is the shortest path to the operational facts:
  measured module sizes, gate layers, config invariants, cost traps, and the
  data conventions that a test will fail you for breaking.
- `docs/SYSTEM-OVERVIEW.md` is the deep dive on the pipeline, the clustering
  algorithm and every table. It is the best thing to read next. Note it
  predates the cost-mode change, so its cron cadences and its "Biviant" naming
  are stale even though the mechanics are accurate.
- `docs/pipeline-operations-runbook.md` covers day-to-day operations.
- `docs/clustering-romanian-tuning.md` and `docs/bias-axis-spec.md` cover the
  tuning decisions behind clustering thresholds and the bias axis.
- `docs/compliance-*.md` cover image policy, storage inventory and the
  third-party text audit.
- `roadmap.md` and `optimization-plan.md` are historical planning documents.
  Code wins over both.

## Notes for anyone editing this repo

- Code is the source of truth. Several markdown files in the repo describe an
  earlier state of the product.
- Never persist scraped article body text.
- Cost controls, leases, budget reservations and the pause flag are load-bearing.
  Removing one to "simplify" a job reintroduces a bill or a double-processing bug.
- `sources.provenance` is internal analyst shorthand in English, with ticket
  refs and notes like "never ingest as credible". Never render it. A
  design-system test fails the build if a web source file touches it.
- The feed reads `publicEventPreviews` and snapshots. Adding a field to `events`
  does not put it on a card until `syncPublicEventPreview` writes it, and stored
  scores stay stale until the next preview sync.
- `packages/backend/convex/README.md` is the default Convex starter doc and says
  nothing about this project.

## License

See [`LICENSE`](./LICENSE).
