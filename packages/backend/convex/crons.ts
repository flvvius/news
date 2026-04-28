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

// ---------------------------------------------------------------------------
// Article Clustering — Every 30 minutes
// ---------------------------------------------------------------------------
// Clusters enriched articles into published events so the feed can render
// real ingested data even before AI summarization exists.
crons.interval(
  "cluster-enriched-articles",
  { minutes: 30 },
  internal.clustering.clusterEnrichedArticles,
);

// ---------------------------------------------------------------------------
// Event Merge Pass — Every 30 minutes
// ---------------------------------------------------------------------------
// Collapses near-duplicate recently published events created across separate
// clustering runs.
crons.interval(
  "merge-near-duplicate-events",
  { minutes: 30 },
  internal.clustering.mergeNearDuplicateEvents,
);

// ---------------------------------------------------------------------------
// Singleton Recluster Pass — Every 6 hours
// ---------------------------------------------------------------------------
// Re-examines recent singleton / tiny events after more articles have landed,
// improving recall for stories that were under-clustered during the online pass.
crons.interval(
  "recluster-recent-singletons",
  { hours: 6 },
  internal.clustering.reclusterRecentSingletonEvents,
);

// ---------------------------------------------------------------------------
// Event Summarization — Every 30 minutes
// ---------------------------------------------------------------------------
// Generates GPT-backed perspective summaries for published events that have
// enough source diversity. Runs independently so clustering is never blocked on
// model latency or budget state.
crons.interval(
  "summarize-published-events",
  { minutes: 30 },
  internal.summarizationNode.summarizeQueuedEvents,
);

// ---------------------------------------------------------------------------
// Claim Divergence Detection — Every 30 minutes
// ---------------------------------------------------------------------------
// Builds the eventClaims graph from atomic facts so the product can show
// agreements, conflicts, framing differences, and lean-specific exclusives.
crons.interval(
  "detect-event-claims",
  { minutes: 30 },
  internal.claimDivergenceNode.processStaleEventClaims,
);

// ---------------------------------------------------------------------------
// Article Bias Outlier Detection — Daily
// ---------------------------------------------------------------------------
// Computes rolling per-source article bias stats and flags articles that are
// unusually partisan for their outlet.
crons.daily(
  "flag-bias-outliers",
  { hourUTC: 5, minuteUTC: 0 },
  internal.bias.flagBiasOutliers,
);

export default crons;
