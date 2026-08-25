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
  /** One-line provenance for the ratings above. Internal: analyst shorthand,
   *  English, with ticket refs and process notes. Never rendered to readers. */
  provenance: string;
  /** Reader-facing Romanian line explaining the scores, shown on the source
   *  profile. Plain language, no acronyms, no internal references. */
  readerNote: string;
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
    readerNote:
      "Televiziune de știri mainstream, relatare descriptivă, cu o ușoară înclinație pro-europeană.",
  },
  {
    domain: "hotnews.ro",
    name: "HotNews",
    biasScore: -2,
    reliabilityScore: 8,
    provenance:
      "MBFC-Romania: left-center/high factual; consistently reformist/pro-european framing. Hand-scored 2026-07.",
    readerNote:
      "Redacție online consacrată, cu acuratețe ridicată și încadrare constant pro-europeană.",
  },
  {
    domain: "g4media.ro",
    name: "G4Media",
    biasScore: -3,
    reliabilityScore: 7,
    provenance:
      "Ethical Media Alliance whitelist; strongly reformist anti-corruption editorial line. Hand-scored 2026-07.",
    readerNote:
      "Publicație independentă, cu linie editorială anticorupție pronunțată.",
  },
  {
    domain: "recorder.ro",
    name: "Recorder",
    biasScore: -2,
    reliabilityScore: 9,
    provenance:
      "Ethical Media Alliance whitelist; independent investigative outlet, reformist framing. Hand-scored 2026-07.",
    readerNote:
      "Jurnalism de investigație independent, cu standarde editoriale ridicate.",
  },
  {
    domain: "zf.ro",
    name: "Ziarul Financiar",
    biasScore: 0,
    reliabilityScore: 8,
    provenance:
      "Business daily; financial coverage largely orthogonal to the axis. Hand-scored 2026-07.",
    readerNote:
      "Cotidian de business; acoperirea financiară nu se așază pe axa politică.",
  },
  {
    domain: "riseproject.ro",
    name: "RISE Project",
    biasScore: -1,
    reliabilityScore: 9,
    provenance:
      "OCCRP member investigative outlet; Ethical Media Alliance whitelist. Hand-scored 2026-07.",
    readerNote:
      "Centru de investigații din rețeaua OCCRP, cu verificare riguroasă a documentelor.",
  },
  {
    domain: "romania.europalibera.org",
    name: "Europa Liberă România",
    biasScore: -2,
    reliabilityScore: 9,
    provenance:
      "RFE/RL service; MBFC rates parent very-high factual; pro-european framing by mission. Hand-scored 2026-07.",
    readerNote:
      "Serviciu public internațional; acuratețe foarte ridicată, perspectivă pro-europeană asumată.",
  },
  // ── Launch feeds, tier 2 ──────────────────────────────────────────────
  {
    domain: "adevarul.ro",
    name: "Adevărul",
    biasScore: 0,
    reliabilityScore: 6,
    provenance:
      "MBFC-Romania: center/mostly-factual; broad legacy daily, mixed op-ed stable. Hand-scored 2026-07.",
    readerNote:
      "Cotidian generalist cu tradiție; știrile sunt solide, paginile de opinie sunt eterogene.",
  },
  {
    domain: "libertatea.ro",
    name: "Libertatea",
    biasScore: -1,
    reliabilityScore: 6,
    provenance:
      "Ex-tabloid turned news; investigative desk respected, mild reformist framing. Hand-scored 2026-07.",
    readerNote:
      "Fost tabloid, azi publicație de știri cu o echipă de investigații respectată.",
  },
  {
    domain: "stirileprotv.ro",
    name: "Știrile ProTV",
    biasScore: 0,
    reliabilityScore: 7,
    provenance:
      "Largest TV news audience; mainstream neutral-to-descriptive framing. Hand-scored 2026-07.",
    readerNote:
      "Cea mai urmărită televiziune de știri; relatare mainstream, preponderent descriptivă.",
  },
  {
    domain: "antena3.ro",
    name: "Antena 3 CNN",
    biasScore: 2,
    reliabilityScore: 4,
    provenance:
      "MBFC-Romania: right/mixed factual; sovereignist-leaning framing ('stat paralel' recurs but is not the outlet's constant voice); Veridica-flagged narratives. Hand-scored 2026-07 (lean, not strong).",
    readerNote:
      "Televiziune cu încadrare suveranistă intermitentă; unele relatări au fost semnalate ca dezinformare.",
  },
  {
    domain: "gandul.ro",
    name: "Gândul",
    biasScore: 1,
    reliabilityScore: 5,
    provenance:
      "Mainstream portal with intermittent suveranist-adjacent framing. Hand-scored 2026-07.",
    readerNote:
      "Portal generalist, cu încadrare ocazional apropiată de discursul suveranist.",
  },
  {
    domain: "biziday.ro",
    name: "Biziday",
    biasScore: 0,
    reliabilityScore: 8,
    provenance:
      "Curated news digest with strict sourcing policy; neutral framing. Hand-scored 2026-07.",
    readerNote:
      "Digest de știri cu politică strictă de citare a surselor și ton neutru.",
  },
  {
    domain: "spotmedia.ro",
    name: "SpotMedia",
    biasScore: -2,
    reliabilityScore: 7,
    provenance:
      "Independent digital outlet; reformist/pro-european commentary line. Hand-scored 2026-07.",
    readerNote:
      "Publicație digitală independentă, cu linie de comentariu reformistă.",
  },
  // ── Ethical Media Alliance whitelist (not yet ingested) ───────────────
  {
    domain: "pressone.ro",
    name: "PressOne",
    biasScore: -2,
    reliabilityScore: 9,
    provenance:
      "Ethical Media Alliance whitelist; long-form independent journalism, reformist framing. Hand-scored 2026-07.",
    readerNote:
      "Jurnalism independent de tip long-form, cu standarde editoriale ridicate.",
  },
  {
    domain: "context.ro",
    name: "Context",
    biasScore: -1,
    reliabilityScore: 9,
    provenance:
      "Ethical Media Alliance whitelist; investigative data journalism. Hand-scored 2026-07.",
    readerNote:
      "Investigații bazate pe date, cu verificare riguroasă.",
  },
  {
    domain: "snoop.ro",
    name: "Snoop",
    biasScore: -2,
    reliabilityScore: 8,
    provenance:
      "Independent investigative project (ex-Libertatea desk); reformist framing. Hand-scored 2026-07.",
    readerNote:
      "Proiect independent de investigații, pornit de foști jurnaliști de la Libertatea.",
  },
  // ── Low-reliability layer: Veridica "Top Fake News" + Expert Forum ────
  {
    domain: "activenews.ro",
    name: "ActiveNews",
    biasScore: 4,
    reliabilityScore: 2,
    provenance:
      "Veridica top fake-news list; recurring suveranist disinformation narratives. Hand-scored 2026-07.",
    readerNote:
      "Apare constant în topurile de dezinformare, cu narațiuni suveraniste false recurente.",
  },
  {
    domain: "national.ro",
    name: "Național",
    biasScore: 3,
    reliabilityScore: 3,
    provenance:
      "Expert Forum low-reliability list; suveranist tabloid framing. Hand-scored 2026-07.",
    readerNote:
      "Inclus pe lista publicațiilor cu fiabilitate scăzută; ton tabloid, încadrare suveranistă.",
  },
  {
    domain: "ortodoxinfo.ro",
    name: "OrtodoxINFO",
    biasScore: 5,
    reliabilityScore: 1,
    provenance:
      "Veridica top fake-news list; religious-suveranist conspiracy narratives. Hand-scored 2026-07.",
    readerNote:
      "Publică frecvent teorii conspiraționiste cu tentă religioasă; apare în topurile de dezinformare.",
  },
  {
    domain: "solidnews.ro",
    name: "SolidNews",
    biasScore: 4,
    reliabilityScore: 1,
    provenance:
      "Veridica top fake-news list; pro-Kremlin disinformation node (Tier C, BIV-806) — bottom reliability. Hand-scored 2026-07.",
    readerNote:
      "Nod de dezinformare pro-Kremlin; apare în topurile de fake news.",
  },
  {
    domain: "realitatea.net",
    name: "Realitatea Plus",
    biasScore: 3,
    reliabilityScore: 3,
    provenance:
      "Veridica-flagged narratives; strongly suveranist-aligned TV framing. Hand-scored 2026-07.",
    readerNote:
      "Televiziune puternic aliniată discursului suveranist; relatări semnalate ca dezinformare.",
  },
  // ── BIV-806: suveranist balance additions ─────────────────────────────
  // Bias balance must never degrade reliability integrity: axis score and
  // reliabilityScore are assigned independently. Tier A = mainstream
  // suveranist-leaning (moderate-low reliability); Tier B = hard
  // nationalist (low reliability, capped ≤3); Tier C = documented
  // disinformation nodes (bottom reliability 1, never ingested as feeds —
  // rated here only so overlay/discovery articles resolve to a rated LOW
  // source instead of a neutral default).
  {
    domain: "romaniatv.net",
    name: "România TV",
    biasScore: 3,
    reliabilityScore: 3,
    provenance:
      "Tier A balance addition (BIV-806): mainstream suveranist-leaning TV; repeated CNA sanctions for accuracy/sensationalism. Hand-scored 2026-07.",
    readerNote:
      "Televiziune cu înclinație suveranistă, sancționată repetat de CNA pentru acuratețe și senzaționalism.",
  },
  {
    domain: "napocanews.ro",
    name: "Napoca News",
    biasScore: 4,
    reliabilityScore: 2,
    provenance:
      "Tier B balance addition (BIV-806): hard nationalist/suveranist framing (glasul.info suveranist list); weak sourcing standards. Hand-scored 2026-07.",
    readerNote:
      "Încadrare naționalistă dură și standarde slabe de documentare.",
  },
  {
    domain: "certitudinea.ro",
    name: "Certitudinea",
    biasScore: 5,
    reliabilityScore: 2,
    provenance:
      "Tier B balance addition (BIV-806): nationalist-conspiracist framing, opinion-heavy, low publication volume. Hand-scored 2026-07.",
    readerNote:
      "Preponderent opinie, cu încadrare naționalist-conspiraționistă.",
  },
  {
    domain: "buciumul.ro",
    name: "Buciumul",
    biasScore: 4,
    reliabilityScore: 2,
    provenance:
      "Tier B balance addition (BIV-806): traditionalist-nationalist framing; RSS unstable (empty responses at verification 2026-07-03), not ingested. Hand-scored 2026-07.",
    readerNote:
      "Încadrare tradiționalist-naționalistă; volum redus și publicare neregulată.",
  },
  {
    domain: "ziarulnatiunea.ro",
    name: "Națiunea",
    biasScore: 4,
    reliabilityScore: 2,
    provenance:
      "Tier B balance addition (BIV-806): nationalist framing, largely opinion/republication, low volume. Hand-scored 2026-07.",
    readerNote:
      "Majoritar opinie și preluări, cu încadrare naționalistă și volum redus.",
  },
  {
    domain: "flux24.ro",
    name: "Flux24",
    biasScore: 5,
    reliabilityScore: 1,
    provenance:
      "Tier C (BIV-806): identified as a pro-Kremlin narrative relay (universul.net network investigation); never ingest as credible. Hand-scored 2026-07.",
    readerNote:
      "Identificat ca releu de narațiuni pro-Kremlin; nu este tratat ca sursă credibilă.",
  },
  {
    domain: "aznews.ro",
    name: "AzNews",
    biasScore: 5,
    reliabilityScore: 1,
    provenance:
      "Tier C (BIV-806): identified as a pro-Kremlin narrative relay (universul.net network investigation); never ingest as credible. Hand-scored 2026-07.",
    readerNote:
      "Identificat ca releu de narațiuni pro-Kremlin; nu este tratat ca sursă credibilă.",
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
