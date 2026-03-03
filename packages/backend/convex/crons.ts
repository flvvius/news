import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// ---------------------------------------------------------------------------
// RSS Ingestion — Every 60 minutes
// ---------------------------------------------------------------------------
// Fetches all curated RSS feeds, deduplicates articles, and inserts new ones.
// Frequency can be tuned down to 30min once the pipeline is proven stable.
crons.interval(
  "ingest-rss-feeds",
  { minutes: 60 },
  internal.ingestion.ingestAllFeeds,
);

// ---------------------------------------------------------------------------
// MBFC Enrichment — DISABLED for MVP
// ---------------------------------------------------------------------------
// MBFC ratings are seeded manually from feeds.ts (curated from
// mediabiasfactcheck.com). Re-enable via the API when the source list
// grows past what can be maintained by hand.
// crons.interval(
//   "enrich-sources-mbfc",
//   { hours: 24 },
//   internal.mbfc.enrichAllSources,
// );

// ---------------------------------------------------------------------------
// Article Enrichment (Embeddings) — Every 30 minutes
// ---------------------------------------------------------------------------
// Generates embeddings for unprocessed articles.
// Runs more frequently than ingestion to keep the pipeline flowing.
crons.interval(
  "enrich-articles",
  { minutes: 30 },
  internal.enrichmentNode.enrichUnprocessedArticles,
);

export default crons;
