/**
 * Curated RSS feed list for ingestion.
 *
 * MBFC ratings are seeded manually from mediabiasfactcheck.com (as of Feb 2026).
 * These change ~1-2x/year; no need for API at MVP scale. When the source list
 * grows past what's curated by hand, integrate the MBFC Data API (see mbfc.ts).
 *
 * Expand to 100+ after clustering proves stable.
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
  /** Primary domain (used for MBFC lookup + source dedup) */
  domain: string;
  /** Manually curated MBFC ratings (from mediabiasfactcheck.com) */
  mbfc: MBFCData;
  /** Numeric bias: -5 (far left) to +5 (far right) derived from MBFC category */
  baseBias: number;
  /** Reliability 1-10 derived from MBFC factual reporting */
  reliabilityScore: number;
}

// ---------------------------------------------------------------------------
// Wire services & centrist outlets
// ---------------------------------------------------------------------------
const CENTER: FeedEntry[] = [
  {
    url: "https://news.google.com/rss/search?q=site:apnews.com&hl=en-US&gl=US&ceid=US:en",
    name: "Associated Press",
    domain: "apnews.com",
    mbfc: { category: "center", factual: "very-high", credibility: "high" },
    baseBias: 0,
    reliabilityScore: 9,
  },
  {
    url: "https://news.google.com/rss/search?q=site:reuters.com&hl=en-US&gl=US&ceid=US:en",
    name: "Reuters",
    domain: "reuters.com",
    mbfc: { category: "center", factual: "very-high", credibility: "high" },
    baseBias: 0,
    reliabilityScore: 9,
  },
  {
    url: "https://feeds.bbci.co.uk/news/rss.xml",
    name: "BBC News",
    domain: "bbc.com",
    mbfc: { category: "left-center", factual: "high", credibility: "high" },
    baseBias: -1,
    reliabilityScore: 8,
  },
  {
    url: "https://www.pbs.org/newshour/feeds/rss/headlines",
    name: "PBS NewsHour",
    domain: "pbs.org",
    mbfc: {
      category: "left-center",
      factual: "very-high",
      credibility: "high",
    },
    baseBias: -1,
    reliabilityScore: 9,
  },
  {
    url: "https://thehill.com/feed/",
    name: "The Hill",
    domain: "thehill.com",
    mbfc: { category: "center", factual: "high", credibility: "high" },
    baseBias: 0,
    reliabilityScore: 8,
  },
  {
    url: "https://abcnews.go.com/abcnews/topstories",
    name: "ABC News",
    domain: "abcnews.go.com",
    mbfc: { category: "left-center", factual: "high", credibility: "high" },
    baseBias: -1,
    reliabilityScore: 8,
  },
];

// ---------------------------------------------------------------------------
// Left-leaning outlets (per MBFC)
// ---------------------------------------------------------------------------
const LEFT: FeedEntry[] = [
  {
    url: "https://feeds.npr.org/1001/rss.xml",
    name: "NPR",
    domain: "npr.org",
    mbfc: {
      category: "left-center",
      factual: "very-high",
      credibility: "high",
    },
    baseBias: -2,
    reliabilityScore: 9,
  },
  {
    url: "https://rss.nytimes.com/services/xml/rss/nyt/HomePage.xml",
    name: "The New York Times",
    domain: "nytimes.com",
    mbfc: { category: "left-center", factual: "high", credibility: "high" },
    baseBias: -2,
    reliabilityScore: 8,
  },
  {
    url: "https://feeds.washingtonpost.com/rss/national",
    name: "The Washington Post",
    domain: "washingtonpost.com",
    mbfc: {
      category: "left-center",
      factual: "mostly-factual",
      credibility: "high",
    },
    baseBias: -2,
    reliabilityScore: 7,
  },
  {
    url: "http://rss.cnn.com/rss/cnn_topstories.rss",
    name: "CNN",
    domain: "cnn.com",
    mbfc: {
      category: "left",
      factual: "mostly-factual",
      credibility: "medium",
    },
    baseBias: -4,
    reliabilityScore: 7,
  },
  {
    url: "https://www.nbcnews.com/id/3032091/device/rss/rss.xml",
    name: "NBC News",
    domain: "nbcnews.com",
    mbfc: {
      category: "left-center",
      factual: "mostly-factual",
      credibility: "high",
    },
    baseBias: -2,
    reliabilityScore: 7,
  },
  {
    url: "https://www.theguardian.com/us-news/rss",
    name: "The Guardian US",
    domain: "theguardian.com",
    mbfc: {
      category: "left-center",
      factual: "mostly-factual",
      credibility: "high",
    },
    baseBias: -2,
    reliabilityScore: 7,
  },
  {
    url: "https://www.politico.com/rss/politicopicks.xml",
    name: "Politico",
    domain: "politico.com",
    mbfc: { category: "left-center", factual: "high", credibility: "high" },
    baseBias: -1,
    reliabilityScore: 8,
  },
];

// ---------------------------------------------------------------------------
// Right-leaning outlets (per MBFC)
// ---------------------------------------------------------------------------
const RIGHT: FeedEntry[] = [
  {
    url: "https://moxie.foxnews.com/google-publisher/latest.xml",
    name: "Fox News",
    domain: "foxnews.com",
    mbfc: { category: "right", factual: "mixed", credibility: "medium" },
    baseBias: 4,
    reliabilityScore: 5,
  },
  {
    url: "https://feeds.content.dowjones.io/public/rss/RSSWorldNews",
    name: "Wall Street Journal",
    domain: "wsj.com",
    mbfc: {
      category: "right-center",
      factual: "mostly-factual",
      credibility: "high",
    },
    baseBias: 2,
    reliabilityScore: 7,
  },
  {
    url: "https://nypost.com/feed/",
    name: "New York Post",
    domain: "nypost.com",
    mbfc: { category: "right-center", factual: "mixed", credibility: "medium" },
    baseBias: 2,
    reliabilityScore: 5,
  },
  {
    url: "https://www.nationalreview.com/feed/",
    name: "National Review",
    domain: "nationalreview.com",
    mbfc: { category: "right", factual: "mostly-factual", credibility: "high" },
    baseBias: 4,
    reliabilityScore: 7,
  },
  {
    url: "https://www.washingtontimes.com/rss/headlines/news/",
    name: "Washington Times",
    domain: "washingtontimes.com",
    mbfc: { category: "right-center", factual: "mixed", credibility: "medium" },
    baseBias: 2,
    reliabilityScore: 5,
  },
];

// ---------------------------------------------------------------------------
// Business / Tech
// ---------------------------------------------------------------------------
const BUSINESS_TECH: FeedEntry[] = [
  {
    url: "https://www.cnbc.com/id/100003114/device/rss/rss.html",
    name: "CNBC",
    domain: "cnbc.com",
    mbfc: {
      category: "left-center",
      factual: "mostly-factual",
      credibility: "high",
    },
    baseBias: -1,
    reliabilityScore: 7,
  },
  {
    url: "https://feeds.bloomberg.com/politics/news.rss",
    name: "Bloomberg",
    domain: "bloomberg.com",
    mbfc: {
      category: "left-center",
      factual: "mostly-factual",
      credibility: "high",
    },
    baseBias: -1,
    reliabilityScore: 7,
  },
  {
    url: "https://techcrunch.com/feed/",
    name: "TechCrunch",
    domain: "techcrunch.com",
    mbfc: { category: "left-center", factual: "high", credibility: "high" },
    baseBias: -1,
    reliabilityScore: 8,
  },
  {
    url: "https://www.wired.com/feed/rss",
    name: "Wired",
    domain: "wired.com",
    mbfc: { category: "left-center", factual: "high", credibility: "high" },
    baseBias: -1,
    reliabilityScore: 8,
  },
  {
    url: "https://arstechnica.com/feed/",
    name: "Ars Technica",
    domain: "arstechnica.com",
    mbfc: { category: "left-center", factual: "high", credibility: "high" },
    baseBias: -1,
    reliabilityScore: 8,
  },
];

// ---------------------------------------------------------------------------
// International / World News
// ---------------------------------------------------------------------------
const INTERNATIONAL: FeedEntry[] = [
  {
    url: "https://www.aljazeera.com/xml/rss/all.xml",
    name: "Al Jazeera",
    domain: "aljazeera.com",
    mbfc: { category: "left-center", factual: "mixed", credibility: "medium" },
    baseBias: -2,
    reliabilityScore: 5,
  },
  {
    url: "https://www.france24.com/en/rss",
    name: "France 24",
    domain: "france24.com",
    mbfc: { category: "left-center", factual: "high", credibility: "high" },
    baseBias: -1,
    reliabilityScore: 8,
  },
  {
    url: "https://www.dw.com/rss/en/top-stories/s-9097",
    name: "DW News",
    domain: "dw.com",
    mbfc: {
      category: "left-center",
      factual: "very-high",
      credibility: "high",
    },
    baseBias: -1,
    reliabilityScore: 9,
  },
];

// ---------------------------------------------------------------------------
// All feeds — single export
// ---------------------------------------------------------------------------
export const ALL_FEEDS: FeedEntry[] = [
  ...CENTER,
  ...LEFT,
  ...RIGHT,
  ...BUSINESS_TECH,
  ...INTERNATIONAL,
];

/** Total number of curated feeds */
export const FEED_COUNT = ALL_FEEDS.length;
