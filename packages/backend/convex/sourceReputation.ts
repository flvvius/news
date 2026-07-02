/**
 * Romanian source reputation seed (BIV-401) — the authoritative manual
 * source-metadata layer.
 *
 * No single machine-readable Romanian bias DB exists, so this is assembled
 * from three layers:
 *  1. MBFC open dataset filtered country=Romania (bias + factuality), where
 *     the outlet is rated;
 *  2. the Ethical Media Alliance quality whitelist (Recorder, PressOne,
 *     Context, G4Media, …) — reliability floor 7;
 *  3. low-reliability lists from Veridica "Top Fake News" and Expert Forum
 *     (ActiveNews, SolidNews, Național, OrtodoxINFO, …) — reliability cap 4.
 *
 * bias.score is hand-assigned on the reformist↔suveranist axis
 * (docs/bias-axis-spec.md): negative = reformist/pro-european framing,
 * positive = suveranist framing, −5..+5. reliabilityScore keeps the 1-10
 * scale. Each entry carries a one-line provenance note stored on the source
 * row.
 *
 * Outlets beyond the launch feed list are seeded too so articles that arrive
 * via discovery overlays (BIV-103 Google News) resolve to rated sources by
 * domain instead of getting neutral defaults.
 *
 * BACKLOG (BIV-402): if the source list ever grows past what can be curated
 * by hand, add an automated refresh against an external ratings API. The old
 * MBFC RapidAPI integration was deleted (it barely covered Romania); any
 * future integration must never overwrite provenance-marked manual scores.
 */

export interface SourceReputationEntry {
  /** Primary domain — dedup key for the sources table. */
  domain: string;
  /** Display name. */
  name: string;
  /** Hand-assigned score on the reformist(−)↔suveranist(+) axis, −5..+5. */
  biasScore: number;
  /** Reliability 1-10. */
  reliabilityScore: number;
  /** One-line provenance for the ratings above. */
  provenance: string;
}

export const ROMANIAN_SOURCE_REPUTATION: SourceReputationEntry[] = [
  // ── Launch feeds, tier 1 ──────────────────────────────────────────────
  {
    domain: "digi24.ro",
    name: "Digi24",
    biasScore: -1,
    reliabilityScore: 8,
    provenance:
      "MBFC-Romania: least biased/high factual; mainstream TV news with mild pro-european tilt. Hand-scored 2026-07.",
  },
  {
    domain: "hotnews.ro",
    name: "HotNews",
    biasScore: -2,
    reliabilityScore: 8,
    provenance:
      "MBFC-Romania: left-center/high factual; consistently reformist/pro-european framing. Hand-scored 2026-07.",
  },
  {
    domain: "g4media.ro",
    name: "G4Media",
    biasScore: -3,
    reliabilityScore: 7,
    provenance:
      "Ethical Media Alliance whitelist; strongly reformist anti-corruption editorial line. Hand-scored 2026-07.",
  },
  {
    domain: "recorder.ro",
    name: "Recorder",
    biasScore: -2,
    reliabilityScore: 9,
    provenance:
      "Ethical Media Alliance whitelist; independent investigative outlet, reformist framing. Hand-scored 2026-07.",
  },
  {
    domain: "agerpres.ro",
    name: "Agerpres",
    biasScore: 0,
    reliabilityScore: 9,
    provenance:
      "National wire service; wire-style neutral framing is the axis anchor. Hand-scored 2026-07.",
  },
  {
    domain: "zf.ro",
    name: "Ziarul Financiar",
    biasScore: 0,
    reliabilityScore: 8,
    provenance:
      "Business daily; financial coverage largely orthogonal to the axis. Hand-scored 2026-07.",
  },
  {
    domain: "riseproject.ro",
    name: "RISE Project",
    biasScore: -1,
    reliabilityScore: 9,
    provenance:
      "OCCRP member investigative outlet; Ethical Media Alliance whitelist. Hand-scored 2026-07.",
  },
  {
    domain: "romania.europalibera.org",
    name: "Europa Liberă România",
    biasScore: -2,
    reliabilityScore: 9,
    provenance:
      "RFE/RL service; MBFC rates parent very-high factual; pro-european framing by mission. Hand-scored 2026-07.",
  },
  // ── Launch feeds, tier 2 ──────────────────────────────────────────────
  {
    domain: "adevarul.ro",
    name: "Adevărul",
    biasScore: 0,
    reliabilityScore: 6,
    provenance:
      "MBFC-Romania: center/mostly-factual; broad legacy daily, mixed op-ed stable. Hand-scored 2026-07.",
  },
  {
    domain: "libertatea.ro",
    name: "Libertatea",
    biasScore: -1,
    reliabilityScore: 6,
    provenance:
      "Ex-tabloid turned news; investigative desk respected, mild reformist framing. Hand-scored 2026-07.",
  },
  {
    domain: "stirileprotv.ro",
    name: "Știrile ProTV",
    biasScore: 0,
    reliabilityScore: 7,
    provenance:
      "Largest TV news audience; mainstream neutral-to-descriptive framing. Hand-scored 2026-07.",
  },
  {
    domain: "antena3.ro",
    name: "Antena 3 CNN",
    biasScore: 3,
    reliabilityScore: 4,
    provenance:
      "MBFC-Romania: right/mixed factual; recurrent 'stat paralel' framing; Veridica-flagged narratives. Hand-scored 2026-07.",
  },
  {
    domain: "gandul.ro",
    name: "Gândul",
    biasScore: 1,
    reliabilityScore: 5,
    provenance:
      "Mainstream portal with intermittent suveranist-adjacent framing. Hand-scored 2026-07.",
  },
  {
    domain: "biziday.ro",
    name: "Biziday",
    biasScore: 0,
    reliabilityScore: 8,
    provenance:
      "Curated news digest with strict sourcing policy; neutral framing. Hand-scored 2026-07.",
  },
  {
    domain: "spotmedia.ro",
    name: "SpotMedia",
    biasScore: -2,
    reliabilityScore: 7,
    provenance:
      "Independent digital outlet; reformist/pro-european commentary line. Hand-scored 2026-07.",
  },
  // ── Ethical Media Alliance whitelist (not yet ingested) ───────────────
  {
    domain: "pressone.ro",
    name: "PressOne",
    biasScore: -2,
    reliabilityScore: 9,
    provenance:
      "Ethical Media Alliance whitelist; long-form independent journalism, reformist framing. Hand-scored 2026-07.",
  },
  {
    domain: "context.ro",
    name: "Context",
    biasScore: -1,
    reliabilityScore: 9,
    provenance:
      "Ethical Media Alliance whitelist; investigative data journalism. Hand-scored 2026-07.",
  },
  {
    domain: "snoop.ro",
    name: "Snoop",
    biasScore: -2,
    reliabilityScore: 8,
    provenance:
      "Independent investigative project (ex-Libertatea desk); reformist framing. Hand-scored 2026-07.",
  },
  // ── Low-reliability layer: Veridica "Top Fake News" + Expert Forum ────
  {
    domain: "activenews.ro",
    name: "ActiveNews",
    biasScore: 4,
    reliabilityScore: 2,
    provenance:
      "Veridica top fake-news list; recurring suveranist disinformation narratives. Hand-scored 2026-07.",
  },
  {
    domain: "national.ro",
    name: "Național",
    biasScore: 3,
    reliabilityScore: 3,
    provenance:
      "Expert Forum low-reliability list; suveranist tabloid framing. Hand-scored 2026-07.",
  },
  {
    domain: "ortodoxinfo.ro",
    name: "OrtodoxINFO",
    biasScore: 5,
    reliabilityScore: 1,
    provenance:
      "Veridica top fake-news list; religious-suveranist conspiracy narratives. Hand-scored 2026-07.",
  },
  {
    domain: "solidnews.ro",
    name: "SolidNews",
    biasScore: 4,
    reliabilityScore: 2,
    provenance:
      "Veridica top fake-news list; suveranist disinformation narratives. Hand-scored 2026-07.",
  },
  {
    domain: "realitatea.net",
    name: "Realitatea Plus",
    biasScore: 3,
    reliabilityScore: 3,
    provenance:
      "Veridica-flagged narratives; strongly suveranist-aligned TV framing. Hand-scored 2026-07.",
  },
];

const byDomain = new Map(
  ROMANIAN_SOURCE_REPUTATION.map((entry) => [entry.domain, entry]),
);

/** Look up the manual reputation entry for a domain, if rated. */
export function getSourceReputation(
  domain: string,
): SourceReputationEntry | undefined {
  return byDomain.get(domain);
}
