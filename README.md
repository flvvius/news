# Biviant

Current-state documentation for the `news-app` monorepo.

This README is intentionally written for both humans and AI agents. It describes what the repository actually contains today, what is wired end-to-end, what is only partially implemented, and where the important code lives.

## What This Project Is

Biviant is a bias-aware news product with:

- A web app for a landing page, feed, event detail pages, auth, bookmarks, and waitlist capture
- A Convex backend for auth, data, ingestion, enrichment, config, waitlist, email, and interaction logging
- An Expo native app that currently acts as a lightweight auth/connectivity shell rather than a full mobile product

The product direction is:

- Group multiple sources around the same story
- Show source bias and reliability metadata
- Eventually support AI-generated summaries and richer event clustering

The current repo is in a transitional state:

- The web app is the most complete surface
- The backend has a meaningful ingestion/enrichment foundation
- The native app exists but is still early
- Real RSS ingestion exists
- Real embedding generation exists
- Real clustering into `events` from ingested articles does not exist yet
- Seeded events are still the main way the feed renders useful content

## Current Status At A Glance

### Working today

- Monorepo with `pnpm` workspaces and Turbo
- Web app with:
  - Landing page
  - Waitlist signup
  - Feed page
  - Event detail page
  - Auth page
  - Bookmarks page
  - Unsubscribe page
- Better Auth + Convex auth integration
- Convex schema for topics, sources, events, articles, users, interactions, waitlist, config, AI usage, and pipeline metadata
- RSS ingestion pipeline with:
  - feed fetching
  - lightweight RSS/Atom parsing
  - canonical URL dedup
  - source lookup/creation by domain
  - ingestion health metadata
  - retry behavior
  - cron scheduling
- Article embedding pipeline using OpenAI `text-embedding-3-small`
- AI usage logging and budget enforcement
- Bookmarking via interaction records
- Waitlist email support via Resend
- Seed data for demo/dev flows

### Partially implemented

- MBFC RapidAPI integration exists in code, but is not the default active path
- Source MBFC data is currently seeded manually from the curated feed list
- Native app auth and Convex connection work, but the app is mostly scaffold/UI shell
- Event model and event pages exist, but the current real-data pipeline does not yet create/publish events from ingested articles

### Not implemented yet

- True clustering from enriched articles into live events
- Automatic creation/updating of `events` from ingested RSS articles
- Automatic event publishing from real ingestion
- AI event summarization pipeline for real ingested events
- Production-grade admin UI for config/pipeline control
- Meaningful native feature parity with the web app
- A real automated test suite

## Repo Layout

```text
.
├── apps/
│   ├── web/         # TanStack Start web app
│   └── native/      # Expo / React Native app
├── packages/
│   ├── backend/     # Convex functions, schema, ingestion, auth, emails
│   └── config/      # shared TS config
├── roadmap.md       # roadmap / planning doc
├── turbo.json       # Turbo task graph
└── pnpm-workspace.yaml
```

## Tech Stack

- Package manager: `pnpm`
- Monorepo/task runner: `turbo`
- Web: TanStack Start, React 19, Vite, Tailwind CSS v4
- Native: Expo, Expo Router, React Native 0.81, HeroUI Native
- Backend: Convex
- Auth: Better Auth with Convex adapter
- AI: OpenAI embeddings
- Email: Resend
- Analytics instrumentation for AI calls: PostHog client integration in backend OpenAI wrapper

## Package Overview

### `apps/web`

Primary product surface today.

Important routes:

- [`/`](./apps/web/src/routes/index.tsx): marketing landing page + waitlist CTA + preview events
- [`/feed`](./apps/web/src/routes/feed.tsx): paginated published events feed with topic filters
- [`/event/$slug`](./apps/web/src/routes/event.$slug.tsx): event detail view with summaries and source articles
- [`/dashboard`](./apps/web/src/routes/dashboard.tsx): auth entry and lightweight authenticated dashboard
- [`/bookmarks`](./apps/web/src/routes/bookmarks.tsx): authenticated bookmarked events
- [`/unsubscribe`](./apps/web/src/routes/unsubscribe.tsx): email unsubscribe landing flow
- [`/api/auth/$`](./apps/web/src/routes/api/auth/$.ts): Better Auth HTTP route passthrough

Important UI components:

- [`EventCard`](./apps/web/src/components/feed/event-card.tsx)
- [`ArticlesList`](./apps/web/src/components/feed/articles-list.tsx)
- [`BookmarkButton`](./apps/web/src/components/bookmark-button.tsx)
- auth forms in [`sign-in-form.tsx`](./apps/web/src/components/sign-in-form.tsx) and [`sign-up-form.tsx`](./apps/web/src/components/sign-up-form.tsx)

### `apps/native`

Early mobile shell.

What it currently does:

- Connects to Convex
- Uses Better Auth client plugins for Expo
- Shows backend connectivity status via `healthCheck`
- Supports sign up / sign in / sign out
- Contains drawer/tab scaffolding and placeholder screens

What it does not currently do:

- Render the news feed
- Render event detail pages
- Support bookmarks or waitlist flows
- Match the web feature set

Important entry points:

- [`app/_layout.tsx`](./apps/native/app/_layout.tsx)
- [`app/(drawer)/index.tsx`](./apps/native/app/(drawer)/index.tsx)
- [`components/sign-in.tsx`](./apps/native/components/sign-in.tsx)
- [`components/sign-up.tsx`](./apps/native/components/sign-up.tsx)

### `packages/backend`

This is the Convex backend package and the most important backend logic in the repo.

## Backend Module Map

### Core data + queries

- [`schema.ts`](./packages/backend/convex/schema.ts): canonical data model
- [`events.ts`](./packages/backend/convex/events.ts): published event feed + event detail queries
- [`topics.ts`](./packages/backend/convex/topics.ts): topic listing
- [`user.ts`](./packages/backend/convex/user.ts): current user profile + updates
- [`privateData.ts`](./packages/backend/convex/privateData.ts): minimal auth-protected demo/private query

### Auth

- [`auth.ts`](./packages/backend/convex/auth.ts): Better Auth + Convex integration, user lifecycle triggers
- [`auth.config.ts`](./packages/backend/convex/auth.config.ts): Convex auth config
- [`http.ts`](./packages/backend/convex/http.ts): registers Better Auth HTTP routes

### Ingestion / enrichment

- [`feeds.ts`](./packages/backend/convex/feeds.ts): curated RSS feed list and seeded source metadata
- [`ingestion.ts`](./packages/backend/convex/ingestion.ts): RSS fetch/parse/dedup/source creation/article insert/pipeline locks
- [`enrichment.ts`](./packages/backend/convex/enrichment.ts): article claiming and DB-side enrichment mutations
- [`enrichmentNode.ts`](./packages/backend/convex/enrichmentNode.ts): OpenAI embedding generation
- [`mbfc.ts`](./packages/backend/convex/mbfc.ts): MBFC API integration path
- [`crons.ts`](./packages/backend/convex/crons.ts): scheduled ingestion and enrichment jobs

### Product support

- [`interactions.ts`](./packages/backend/convex/interactions.ts): bookmark toggle, bookmark queries, generic interaction logging
- [`waitlist.ts`](./packages/backend/convex/waitlist.ts): waitlist signup, unsubscribe, admin stats
- [`emails.ts`](./packages/backend/convex/emails.ts): welcome/invite email sending via Resend
- [`config.ts`](./packages/backend/convex/config.ts): runtime config store and pipeline pause toggle
- [`aiBudget.ts`](./packages/backend/convex/aiBudget.ts): AI spend checks and usage logging
- [`healthCheck.ts`](./packages/backend/convex/healthCheck.ts): simple liveness query

### Dev/support

- [`seeds.ts`](./packages/backend/convex/seeds.ts): demo seed data
- [`migrations.ts`](./packages/backend/convex/migrations.ts): currently present but not central to runtime behavior

## Current Product Behavior

### Web app behavior

#### Landing page

The landing page is both a marketing page and a thin product preview.

It currently includes:

- product positioning copy
- waitlist signup form
- a preview of published events from Convex
- SEO metadata and structured data

The waitlist form writes to `waitlist` and optionally schedules a welcome email if `RESEND_API_KEY` is configured.

#### Feed page

The feed page renders published events only.

Data comes from:

- `api.events.getPublishedEvents`
- `api.topics.getTopics`
- selected public config values such as feed page size and max source chips

Important implication:

- the feed is event-driven, not article-driven
- if real ingestion does not produce `events`, the feed will still rely on seeded/demo events

#### Event detail page

The event page expects:

- an `event`
- associated `articles`
- optional perspective summaries
- optional global impact text

This means the frontend is built for the later event-centric product shape, even though the real-data backend pipeline has not fully caught up.

#### Dashboard and auth

The dashboard currently functions as:

- sign in / sign up entrypoint for unauthenticated users
- a basic welcome screen for authenticated users
- a proof that current user and private data access work

It is not yet a full user dashboard.

#### Bookmarks

Bookmarks are implemented using the `interactions` table, not a dedicated bookmarks table.

The bookmark system currently supports:

- toggle bookmark / unbookmark
- dedup/cooldown behavior to avoid excessive writes
- bookmarked event listing for the current user

#### Unsubscribe

The unsubscribe route:

- reads `email` from the URL
- calls the Convex mutation
- marks the waitlist record as `unsubscribed`

## Backend Data Model

The data model is centered around `events`, but the ingestion system currently produces `articles` first.

Main tables:

- `topics`
- `sources`
- `events`
- `eventTopics`
- `eventEmbeddings`
- `articles`
- `articleEmbeddings`
- `users`
- `userStats`
- `userPrivateContext`
- `userInsights`
- `interactions`
- `waitlist`
- `ingestionMeta`
- `config`
- `aiUsage`
- `pipelineLocks`

Important modeling notes:

- `events` are the UI-facing unit for feed/detail pages
- `articles` are the evidence/source layer under an event
- embeddings are stored in separate tables, not inline on primary records
- user profile, stats, and private context are structurally separated

For exact fields and indexes, use [`packages/backend/convex/schema.ts`](./packages/backend/convex/schema.ts).

## Real Data Pipeline

This is the most important “current state” section for anyone trying to understand the repo.

### What exists

#### 1. RSS source curation

[`feeds.ts`](./packages/backend/convex/feeds.ts) contains the curated feed list.

Current state:

- about two dozen feeds
- each feed includes:
  - feed URL
  - display name
  - domain
  - manually curated MBFC-style metadata
  - numeric bias score
  - reliability score

#### 2. Feed ingestion

[`ingestion.ts`](./packages/backend/convex/ingestion.ts) does:

- fetch RSS/Atom XML
- parse feed items
- strip/normalize snippets
- canonicalize URLs
- deduplicate against existing articles
- resolve source by domain
- create source if missing
- insert new articles as `unprocessed`
- update `ingestionMeta`
- acquire/release a pipeline lock for the batch run
- retry failed feeds once

Article records inserted by ingestion currently contain:

- `title`
- `url`
- `canonicalUrl`
- `rssSnippet`
- `publishedAt`
- `sourceId`
- `status: "unprocessed"`

#### 3. Scheduled ingestion

[`crons.ts`](./packages/backend/convex/crons.ts) schedules:

- RSS ingestion every 60 minutes
- article enrichment every 30 minutes

#### 4. Article enrichment

[`enrichmentNode.ts`](./packages/backend/convex/enrichmentNode.ts) currently:

- claims unprocessed articles
- builds embedding input from `title + snippet`
- generates OpenAI embeddings with `text-embedding-3-small`
- stores vectors in `articleEmbeddings`
- copies source bias into `aiBiasScore`
- marks articles as `enriched`
- discards failed per-article embedding outputs
- logs AI usage
- checks daily budget before spending

#### 5. MBFC API integration path

[`mbfc.ts`](./packages/backend/convex/mbfc.ts) exists and supports:

- source lookup via RapidAPI
- normalization of bias/factual ratings
- writing back to `sources`
- fallback marking as `unrated`
- batch enrichment

But today:

- the MBFC cron is disabled
- the feed list still carries manual MBFC data
- the active MVP path is manual metadata in `feeds.ts`, not API-enriched metadata

### What does not exist yet

This is the biggest architectural gap in the repo today.

There is no implemented pipeline that:

- reads `enriched` articles
- clusters them into story groups
- creates or updates `events`
- assigns `eventId` on articles
- creates event embeddings for live data
- publishes those events to the feed

So the current real-data pipeline is:

```text
RSS feeds -> articles -> article embeddings
```

Not yet:

```text
RSS feeds -> articles -> embeddings -> events -> published feed
```

## Seed Data

The repo includes a seed script for UI/demo development in [`seeds.ts`](./packages/backend/convex/seeds.ts).

What it seeds:

- 2 topics
- 3 sources
- 2 published events
- event-topic links
- placeholder event embeddings
- 6 clustered articles

This seeded content is currently the easiest way to see the web app in a meaningful state.

Useful commands:

```bash
npx convex run seeds:seedDB
npx convex run seeds:verifySeedData
```

There is also a `clearDB` helper in the same file.

## Auth Model

Auth is powered by Better Auth with Convex storage.

Current auth capabilities:

- email/password auth
- Google auth
- cross-domain client plugin support
- Expo auth client support

On user creation, backend triggers create:

- a `users` row
- a `userStats` row

On update/delete, backend triggers sync or clean up related user data.

Important files:

- [`packages/backend/convex/auth.ts`](./packages/backend/convex/auth.ts)
- [`apps/web/src/lib/auth-client.ts`](./apps/web/src/lib/auth-client.ts)
- [`apps/native/lib/auth-client.ts`](./apps/native/lib/auth-client.ts)

## Waitlist + Email System

The waitlist system is real and usable today.

Current behavior:

- stores email, optional name, queue position, and status
- prevents duplicate signup rows
- supports resubscribe from `unsubscribed`
- optionally sends welcome email on signup
- supports unsubscribe links
- includes an admin-only waitlist stats query

Email sending:

- uses Resend
- includes unsubscribe headers and unsubscribe URL
- uses runtime config overrides for sender/reply-to/address/unsubscribe base URL

Important files:

- [`packages/backend/convex/waitlist.ts`](./packages/backend/convex/waitlist.ts)
- [`packages/backend/convex/emails.ts`](./packages/backend/convex/emails.ts)
- [`apps/web/src/routes/unsubscribe.tsx`](./apps/web/src/routes/unsubscribe.tsx)

## Runtime Config System

The project already has a real config layer in Convex.

It supports:

- public client-readable config keys
- admin-only config listing and updates
- pipeline pause/resume
- config defaults seeding

Examples of config-driven behavior:

- feed page size
- landing preview count
- event card source count
- waitlist toast timeout
- bookmark cooldown
- pipeline pause flag

Important file:

- [`packages/backend/convex/config.ts`](./packages/backend/convex/config.ts)

## AI Usage and Cost Controls

The backend includes a practical AI budget layer.

What it currently does:

- checks daily spend before embedding generation
- records usage by date/model/operation
- calculates approximate cost
- prevents new usage logging if the budget would be exceeded

Important file:

- [`packages/backend/convex/aiBudget.ts`](./packages/backend/convex/aiBudget.ts)

## Cron Jobs

Defined in [`packages/backend/convex/crons.ts`](./packages/backend/convex/crons.ts).

Currently active:

- `ingest-rss-feeds`: every 60 minutes
- `enrich-articles`: every 30 minutes

Currently disabled:

- MBFC API source enrichment cron

## Environment Variables

This repo uses a mix of web env vars, native public env vars, and backend/server env vars.

### Web client

From [`apps/web/.env.example`](./apps/web/.env.example):

```bash
VITE_CONVEX_URL=
VITE_CONVEX_SITE_URL=
```

### Important backend / auth env vars

Required or commonly expected by the current code:

- `CONVEX_URL`
- `CONVEX_SITE_URL`
- `SITE_URL`
- `ALLOWED_ORIGINS` (optional, comma-separated origins allowed for verification links)
- `BETTER_AUTH_SECRET`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `NATIVE_APP_URL`
- `ADMIN_EMAILS`

### AI / ingestion / email env vars

- `OPENAI_API_KEY`
- `POSTHOG_API_KEY` (optional)
- `RAPIDAPI_KEY` for MBFC API path
- `RESEND_API_KEY`

### Native public env vars

- `EXPO_PUBLIC_CONVEX_URL`
- `EXPO_PUBLIC_CONVEX_SITE_URL`

Note:

- not every integration is required for local development
- the easiest local path is usually seeded data + web app + Convex
- MBFC API and Resend can be omitted if you do not need those flows locally

## Local Development

### Install

```bash
pnpm install
```

### Start the whole workspace

```bash
pnpm dev
```

### Start pieces individually

```bash
pnpm dev:web
pnpm dev:native
pnpm dev:server
pnpm dev:setup
```

### Build

```bash
pnpm build
```

### Type checking

```bash
pnpm check-types
```

## Recommended Local Workflow

If you want to see the app in a convincing state today:

1. Start Convex and the web app.
2. Seed the database.
3. Open the web app.
4. Use the landing page, feed, event detail pages, auth, and bookmarks.

If you want to inspect ingestion:

1. Configure Convex/backend env vars.
2. Run Convex.
3. Trigger or wait for ingestion/enrichment.
4. Inspect `articles`, `sources`, `ingestionMeta`, and `articleEmbeddings`.

Do not expect ingested articles to automatically become live feed events yet.

## Important Constraints And Caveats

### Product/data caveats

- The UI is event-driven, but real ingestion currently stops at the article/enrichment layer.
- Published feed data is still best represented by seeds, not by the real ingestion pipeline.
- MBFC metadata is manually curated for the current feed set even though an API integration exists.

### Engineering caveats

- There is no substantial automated test suite in this repo right now.
- The native app is not feature-complete.
- Some backend tables are designed for later phases and are not fully exercised by current runtime flows.
- `packages/backend/convex/README.md` is still the default Convex starter doc and is not authoritative for this project.

## For AI Agents

If you are modifying this repo, read this section first.

### Source of truth

- Treat code as the source of truth over `roadmap.md`.
- The most important current-state files are:
  - [`packages/backend/convex/schema.ts`](./packages/backend/convex/schema.ts)
  - [`packages/backend/convex/ingestion.ts`](./packages/backend/convex/ingestion.ts)
  - [`packages/backend/convex/enrichmentNode.ts`](./packages/backend/convex/enrichmentNode.ts)
  - [`packages/backend/convex/events.ts`](./packages/backend/convex/events.ts)
  - [`apps/web/src/routes`](./apps/web/src/routes)

### Current architectural reality

- The web app expects `published` events.
- The real ingestion pipeline currently produces `articles`, not `events`.
- Seeds bridge that gap for development.

### Safe assumptions

- Web is the primary product surface.
- Native is still a scaffold.
- Config-driven behavior already matters.
- AI cost controls and pipeline pause logic are intentional and should be preserved.

### Easy mistakes to avoid

- Do not assume clustering exists just because the schema has `events` and `eventEmbeddings`.
- Do not assume MBFC API is active just because `mbfc.ts` exists.
- Do not remove seed support unless you also finish the real event pipeline.
- Do not document article embeddings as inline on `articles`; they are stored in `articleEmbeddings`.

## Suggested Next Documentation Targets

If this repo keeps evolving, the next useful docs would be:

- a dedicated setup guide with exact env examples
- a data-flow doc for ingestion/enrichment/clustering
- an auth doc for web/native/cross-domain behavior
- an operator doc for config keys and pipeline controls

## License

See [`LICENSE`](./LICENSE).
