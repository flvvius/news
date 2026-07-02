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
 * Bias/reliability values are provisional hand-curated seeds; the layered
 * Romanian source-reputation seed (BIV-401: MBFC-Romania + Ethical Media
 * Alliance whitelist + Veridica/Expert Forum low-reliability list) is the
 * authoritative pass.
 *
 * Broken feeds are quarantined by the ingestion loop after repeated
 * consecutive failures (see QUARANTINE_* in ingestion.ts) and surfaced in
 * pipeline run logs — never silently dropped.
 */

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
  /** Ramp tier: 1 = verified-direct launch core, 2 = mainstream reach */
  tier: 1 | 2;
  /** Curated ratings (MBFC where rated; otherwise editor-curated equivalent) */
  mbfc: MBFCData;
  /** Numeric bias: -5 to +5 (axis semantics defined in BIV-301) */
  baseBias: number;
  /** Reliability 1-10 (10 = wire service, 1 = tabloid) */
  reliabilityScore: number;
}

// ---------------------------------------------------------------------------
// Tier 1 — verified-direct Romanian set (fetch-tested 2026-07-02)
// ---------------------------------------------------------------------------
const TIER_1: FeedEntry[] = [
  {
    url: "https://www.digi24.ro/rss",
    name: "Digi24",
    domain: "digi24.ro",
    tier: 1,
    mbfc: { category: "center", factual: "high", credibility: "high" },
    baseBias: -1,
    reliabilityScore: 8,
  },
  {
    url: "https://hotnews.ro/feed",
    name: "HotNews",
    domain: "hotnews.ro",
    tier: 1,
    mbfc: { category: "left-center", factual: "high", credibility: "high" },
    baseBias: -2,
    reliabilityScore: 8,
  },
  {
    url: "https://www.g4media.ro/feed",
    name: "G4Media",
    domain: "g4media.ro",
    tier: 1,
    mbfc: { category: "left-center", factual: "high", credibility: "high" },
    baseBias: -2,
    reliabilityScore: 7,
  },
  {
    url: "https://recorder.ro/feed/",
    name: "Recorder",
    domain: "recorder.ro",
    tier: 1,
    mbfc: { category: "left-center", factual: "very-high", credibility: "high" },
    baseBias: -1,
    reliabilityScore: 9,
  },
  {
    // NOTE: endpoint returned 520/522 at verification time while the homepage
    // was healthy — kept because Agerpres is the national wire service; the
    // ingestion quarantine covers it if the RSS endpoint stays broken.
    url: "https://www.agerpres.ro/rss/stiri",
    name: "Agerpres",
    domain: "agerpres.ro",
    tier: 1,
    mbfc: { category: "center", factual: "very-high", credibility: "high" },
    baseBias: 0,
    reliabilityScore: 9,
  },
  {
    url: "https://www.zf.ro/rss/",
    name: "Ziarul Financiar",
    domain: "zf.ro",
    tier: 1,
    mbfc: { category: "right-center", factual: "high", credibility: "high" },
    baseBias: 1,
    reliabilityScore: 8,
  },
  {
    url: "https://www.riseproject.ro/feed/",
    name: "RISE Project",
    domain: "riseproject.ro",
    tier: 1,
    mbfc: { category: "center", factual: "very-high", credibility: "high" },
    baseBias: 0,
    reliabilityScore: 9,
  },
  {
    // Canonical RSS endpoint behind the /rssfeeds listing page (Pangea CMS
    // "Știri" zone; atom:link self). Channel verified live, item volume varies.
    url: "https://romania.europalibera.org/api/zvo_mml-vomx-tpeukvm_",
    name: "Europa Liberă România",
    domain: "romania.europalibera.org",
    tier: 1,
    mbfc: { category: "center", factual: "very-high", credibility: "high" },
    baseBias: -1,
    reliabilityScore: 9,
  },
];

// ---------------------------------------------------------------------------
// Tier 2 — mainstream reach (each fetch-verified live 2026-07-02)
// ---------------------------------------------------------------------------
const TIER_2: FeedEntry[] = [
  {
    url: "https://adevarul.ro/rss",
    name: "Adevărul",
    domain: "adevarul.ro",
    tier: 2,
    mbfc: { category: "center", factual: "mostly-factual", credibility: "medium" },
    baseBias: 0,
    reliabilityScore: 6,
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
    baseBias: -1,
    reliabilityScore: 6,
  },
  {
    url: "https://stirileprotv.ro/rss",
    name: "Știrile ProTV",
    domain: "stirileprotv.ro",
    tier: 2,
    mbfc: { category: "center", factual: "mostly-factual", credibility: "high" },
    baseBias: 0,
    reliabilityScore: 7,
  },
  {
    url: "https://www.antena3.ro/rss",
    name: "Antena 3 CNN",
    domain: "antena3.ro",
    tier: 2,
    mbfc: { category: "right", factual: "mixed", credibility: "low" },
    baseBias: 3,
    reliabilityScore: 4,
  },
  {
    url: "https://www.gandul.ro/feed",
    name: "Gândul",
    domain: "gandul.ro",
    tier: 2,
    mbfc: { category: "right-center", factual: "mixed", credibility: "medium" },
    baseBias: 1,
    reliabilityScore: 5,
  },
  {
    url: "https://www.biziday.ro/feed/",
    name: "Biziday",
    domain: "biziday.ro",
    tier: 2,
    mbfc: { category: "center", factual: "high", credibility: "high" },
    baseBias: 0,
    reliabilityScore: 8,
  },
  {
    url: "https://spotmedia.ro/rss",
    name: "SpotMedia",
    domain: "spotmedia.ro",
    tier: 2,
    mbfc: { category: "left-center", factual: "high", credibility: "high" },
    baseBias: -2,
    reliabilityScore: 7,
  },
];

// ---------------------------------------------------------------------------
// All feeds — single export
// ---------------------------------------------------------------------------
export const ALL_FEEDS: FeedEntry[] = [...TIER_1, ...TIER_2];

/** Total number of curated feeds */
export const FEED_COUNT = ALL_FEEDS.length;
