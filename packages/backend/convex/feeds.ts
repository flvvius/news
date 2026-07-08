/**
 * Curated RSS feed list for ingestion — Romanian sources (BIV-101).
 *
 * The product ingests Romanian news only. Feeds are split in two tiers:
 *  - Tier 1: verified-direct set (fetch-tested 2026-07-02), the launch core.
 *  - Tier 2: mainstream reach feeds, also fetch-verified live before adding.
 *
 * Staged ramp: start at 15 feeds; expand only after clustering and the
 * Romanian eval harness (BIV-701) prove stable. Do NOT jump to 100+.
 *
 * Bias + reliability come from the manual Romanian source-reputation seed
 * (sourceReputation.ts, BIV-401) — the single authoritative source-metadata
 * layer. A feed without a reputation entry fails the module-load assertion
 * below, so every launch feed's domain always resolves to a rated source.
 *
 * Broken feeds are quarantined by the ingestion loop after repeated
 * consecutive failures (see QUARANTINE_* in ingestion.ts) and surfaced in
 * pipeline run logs — never silently dropped.
 */

import { getSourceReputation } from "./sourceReputation";

export interface MBFCData {
  /** MBFC bias category */
  category: "left" | "left-center" | "center" | "right-center" | "right";
  /** MBFC factual reporting grade */
  factual: "very-high" | "high" | "mostly-factual" | "mixed" | "low";
  /** MBFC credibility rating */
  credibility: "high" | "medium" | "low";
}

export interface FeedEntry {
  /** RSS/Atom feed URL */
  url: string;
  /** Display name of the outlet (used to seed `sources.name`) */
  name: string;
  /** Primary domain (used for source lookup + dedup) */
  domain: string;
  /**
   * Ramp tier: 1 = verified-direct launch core, 2 = mainstream reach,
   * 3 = suveranist balance additions (BIV-806) — included for axis balance,
   * never for credibility; their reliability scores stay honest and low-ish.
   */
  tier: 1 | 2 | 3;
  /** Curated ratings (MBFC where rated; otherwise editor-curated equivalent) */
  mbfc: MBFCData;
  /** Numeric bias from the reputation seed: -5 (reformist) to +5 (suveranist) */
  baseBias: number;
  /** Reliability 1-10 from the reputation seed */
  reliabilityScore: number;
  /** Provenance note for the ratings, from the reputation seed */
  provenance: string;
  /**
   * Optional per-feed fetch timeout override in ms. Defaults to the ingestion
   * default (15s). Raise it for slow third-party proxy/extractor feeds (e.g.
   * the bazqux createfeed extractor) that legitimately take longer than a
   * direct-origin RSS fetch and would otherwise abort every run.
   */
  fetchTimeoutMs?: number;
}

type FeedDefinition = Omit<
  FeedEntry,
  "baseBias" | "reliabilityScore" | "provenance"
>;

// ---------------------------------------------------------------------------
// Tier 1 — verified-direct Romanian set (fetch-tested 2026-07-02)
// ---------------------------------------------------------------------------
const TIER_1: FeedDefinition[] = [
  {
    url: "https://www.digi24.ro/rss",
    name: "Digi24",
    domain: "digi24.ro",
    tier: 1,
    mbfc: { category: "center", factual: "high", credibility: "high" },
  },
  {
    url: "https://hotnews.ro/feed",
    name: "HotNews",
    domain: "hotnews.ro",
    tier: 1,
    mbfc: { category: "left-center", factual: "high", credibility: "high" },
  },
  {
    url: "https://www.g4media.ro/feed",
    name: "G4Media",
    domain: "g4media.ro",
    tier: 1,
    mbfc: { category: "left-center", factual: "high", credibility: "high" },
  },
  {
    url: "https://recorder.ro/feed/",
    name: "Recorder",
    domain: "recorder.ro",
    tier: 1,
    mbfc: { category: "left-center", factual: "very-high", credibility: "high" },
  },
  {
    // Agerpres has no native RSS: www.agerpres.ro/rss/stiri 301-redirects to an
    // allorigins.win proxy wrapper that returns 520/522 (dead), which kept the
    // feed permanently quarantined. The underlying bazqux "createfeed" extractor
    // over the Agerpres widget returns valid RSS directly, so we point at it
    // without the broken proxy layer. If this third-party extractor ever fails,
    // the ingestion quarantine covers it. Kept because Agerpres is the national
    // wire service.
    url: "https://createfeed.bazqux.com/extract.php?url=https%3A%2F%2Fagerpres.ro%2Fwidget&max=50&order=document&guid=0",
    name: "Agerpres",
    domain: "agerpres.ro",
    tier: 1,
    mbfc: { category: "center", factual: "very-high", credibility: "high" },
    // The bazqux extractor scrapes the Agerpres widget live and routinely takes
    // ~7-20s, so the default 15s timeout aborted it most runs. Give it headroom.
    fetchTimeoutMs: 30_000,
  },
  {
    url: "https://www.zf.ro/rss/",
    name: "Ziarul Financiar",
    domain: "zf.ro",
    tier: 1,
    mbfc: { category: "right-center", factual: "high", credibility: "high" },
  },
  {
    url: "https://www.riseproject.ro/feed/",
    name: "RISE Project",
    domain: "riseproject.ro",
    tier: 1,
    mbfc: { category: "center", factual: "very-high", credibility: "high" },
  },
  {
    // Canonical RSS endpoint behind the /rssfeeds listing page (Pangea CMS
    // "Știri" zone; atom:link self). Channel verified live, item volume varies.
    url: "https://romania.europalibera.org/api/zvo_mml-vomx-tpeukvm_",
    name: "Europa Liberă România",
    domain: "romania.europalibera.org",
    tier: 1,
    mbfc: { category: "center", factual: "very-high", credibility: "high" },
  },
];

// ---------------------------------------------------------------------------
// Tier 2 — mainstream reach (each fetch-verified live 2026-07-02)
// ---------------------------------------------------------------------------
const TIER_2: FeedDefinition[] = [
  {
    url: "https://adevarul.ro/rss",
    name: "Adevărul",
    domain: "adevarul.ro",
    tier: 2,
    mbfc: { category: "center", factual: "mostly-factual", credibility: "medium" },
  },
  {
    url: "https://www.libertatea.ro/feed",
    name: "Libertatea",
    domain: "libertatea.ro",
    tier: 2,
    mbfc: {
      category: "left-center",
      factual: "mostly-factual",
      credibility: "medium",
    },
  },
  {
    url: "https://stirileprotv.ro/rss",
    name: "Știrile ProTV",
    domain: "stirileprotv.ro",
    tier: 2,
    mbfc: { category: "center", factual: "mostly-factual", credibility: "high" },
  },
  {
    url: "https://www.antena3.ro/rss",
    name: "Antena 3 CNN",
    domain: "antena3.ro",
    tier: 2,
    mbfc: { category: "right", factual: "mixed", credibility: "low" },
  },
  {
    url: "https://www.gandul.ro/feed",
    name: "Gândul",
    domain: "gandul.ro",
    tier: 2,
    mbfc: { category: "right-center", factual: "mixed", credibility: "medium" },
  },
  {
    url: "https://www.biziday.ro/feed/",
    name: "Biziday",
    domain: "biziday.ro",
    tier: 2,
    mbfc: { category: "center", factual: "high", credibility: "high" },
  },
  {
    url: "https://spotmedia.ro/rss",
    name: "SpotMedia",
    domain: "spotmedia.ro",
    tier: 2,
    mbfc: { category: "left-center", factual: "high", credibility: "high" },
  },
];

// ---------------------------------------------------------------------------
// Tier 3 — suveranist balance additions (BIV-806)
//
// The launch mix skewed reformist (8 reformist / 5 neutral / 2 suveranist
// feeds). These four move the ratio to 8:5:6 — "slightly more balanced, not
// equal" — while reliability stays independently honest (3/3/2/3). Each feed
// fetch-verified live 2026-07-03. Candidates that failed verification or are
// too low-volume (Buciumul — intermittently empty feed; Certitudinea, Napoca
// News, Națiunea — low-volume opinion/republication) are rated in
// sourceReputation.ts but NOT ingested. Tier C disinformation nodes (Flux24,
// SolidNews, AzNews, OrtodoxINFO) are never ingested — reputation rows with
// bottom reliability only. See docs/source-balance-biv806.md.
// ---------------------------------------------------------------------------
const TIER_3: FeedDefinition[] = [
  {
    // /rss 301s here; use the canonical endpoint (origin is slow — ~7s).
    url: "https://www.romaniatv.net/feed",
    name: "România TV",
    domain: "romaniatv.net",
    tier: 3,
    mbfc: { category: "right", factual: "mixed", credibility: "low" },
  },
  {
    // Canonical homepage feed advertised in the site <head> (no /rss route).
    url: "https://www.realitatea.net/access/share/feeds/rss/homepage.xml",
    name: "Realitatea Plus",
    domain: "realitatea.net",
    tier: 3,
    mbfc: { category: "right", factual: "mixed", credibility: "low" },
  },
  {
    url: "https://www.activenews.ro/rss",
    name: "ActiveNews",
    domain: "activenews.ro",
    tier: 3,
    mbfc: { category: "right", factual: "low", credibility: "low" },
  },
  {
    url: "https://www.national.ro/feed",
    name: "Național",
    domain: "national.ro",
    tier: 3,
    mbfc: { category: "right", factual: "mixed", credibility: "low" },
  },
];

function withReputation(definition: FeedDefinition): FeedEntry {
  const reputation = getSourceReputation(definition.domain);
  if (!reputation) {
    // Fail fast at module load: a launch feed must always resolve to a rated
    // source row (BIV-401 acceptance).
    throw new Error(
      `Feed ${definition.domain} has no entry in ROMANIAN_SOURCE_REPUTATION`,
    );
  }
  return {
    ...definition,
    baseBias: reputation.biasScore,
    reliabilityScore: reputation.reliabilityScore,
    provenance: reputation.provenance,
  };
}

// ---------------------------------------------------------------------------
// All feeds — single export
// ---------------------------------------------------------------------------
export const ALL_FEEDS: FeedEntry[] = [...TIER_1, ...TIER_2, ...TIER_3].map(
  withReputation,
);

/** Total number of curated feeds */
export const FEED_COUNT = ALL_FEEDS.length;
