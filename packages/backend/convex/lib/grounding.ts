/**
 * L4 — grounding verification + named-entity risk gate (pure helpers).
 *
 * The Munich AI Overviews ruling holds the operator directly liable for
 * synthesized claims appearing in no source; disclaimers are no defense.
 * Every published sentence must therefore carry a recorded supporting
 * source, and sentences pairing a named person/organization with an
 * accusation term are held for human review instead of auto-publishing.
 */

import {
  GLOBAL_IMPACT_FALLBACK,
  LIMITED_COVERAGE_FALLBACK,
  SIDE_COVERAGE_FALLBACK,
} from "../prompts";

export type SummaryFieldName =
  | "neutral"
  | "reformist"
  | "suveranist"
  | "globalImpact";

export type SummarySentence = {
  field: SummaryFieldName;
  index: number;
  sentence: string;
};

export type SentenceGroundingResult = {
  field: SummaryFieldName;
  sentence: string;
  supported: boolean;
  /** IDs into the articles array used for the check (mapped by caller). */
  supportingArticleIds: string[];
};

/** Our own fixed fallback strings are not factual claims — never checked. */
const OWN_TEXT_FALLBACKS = new Set<string>([
  GLOBAL_IMPACT_FALLBACK,
  SIDE_COVERAGE_FALLBACK,
  LIMITED_COVERAGE_FALLBACK.reformist,
  LIMITED_COVERAGE_FALLBACK.suveranist,
]);

const ABBREVIATIONS =
  /\b(dl|dna|dr|prof|ing|nr|art|lit|alin|pct|etc|ex|approx|cca|str|jud|mun)\.$/i;

/** Split Romanian prose into sentences, robust to common abbreviations. */
export function splitIntoSentences(text: string): string[] {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (!cleaned) return [];

  const sentences: string[] = [];
  let current = "";
  for (let i = 0; i < cleaned.length; i++) {
    current += cleaned[i];
    const char = cleaned[i];
    if (char === "." || char === "!" || char === "?") {
      const next = cleaned[i + 1];
      const isEnd =
        (next === undefined || next === " ") &&
        !ABBREVIATIONS.test(current.trim()) &&
        // Decimal numbers ("2.5 miliarde") and enumerations ("1. ...").
        !/\d\.$/.test(current.trim());
      if (isEnd) {
        const trimmed = current.trim();
        if (trimmed) sentences.push(trimmed);
        current = "";
      }
    }
  }
  const rest = current.trim();
  if (rest) sentences.push(rest);
  return sentences;
}

/** Enumerate the checkable sentences of a generated summary. */
export function collectSummarySentences(
  fields: Partial<Record<SummaryFieldName, string>>,
): SummarySentence[] {
  const result: SummarySentence[] = [];
  for (const field of [
    "neutral",
    "reformist",
    "suveranist",
    "globalImpact",
  ] as const) {
    const text = fields[field];
    if (!text?.trim() || OWN_TEXT_FALLBACKS.has(text.trim())) continue;
    for (const sentence of splitIntoSentences(text)) {
      if (OWN_TEXT_FALLBACKS.has(sentence)) continue;
      result.push({ field, index: result.length, sentence });
    }
  }
  return result;
}

export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  const length = Math.min(a.length, b.length);
  for (let i = 0; i < length; i++) {
    dot += a[i]! * b[i]!;
    normA += a[i]! * a[i]!;
    normB += b[i]! * b[i]!;
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

// ---------------------------------------------------------------------------
// Named-entity risk gate
// ---------------------------------------------------------------------------

/**
 * Default accusation lexicon (Romanian + a few international terms).
 * Runtime-extendable via the `accusation_lexicon` config key (JSON array).
 */
export const DEFAULT_ACCUSATION_LEXICON: string[] = [
  "crimă",
  "criminal",
  "omor",
  "ucis",
  "fraudă",
  "fraudat",
  "furt",
  "furat",
  "corupție",
  "corupt",
  "mită",
  "șpagă",
  "luare de mită",
  "dare de mită",
  "agresiune",
  "agresat",
  "viol",
  "violat",
  "abuz",
  "abuzat",
  "hărțuire",
  "hărțuit",
  "escrocherie",
  "escroc",
  "înșelăciune",
  "înșelat",
  "delapidare",
  "deturnare",
  "spălare de bani",
  "evaziune",
  "trafic de influență",
  "trafic de droguri",
  "trafic de persoane",
  "pedofil",
  "condamnat",
  "inculpat",
  "arestat",
  "reținut",
  "anchetat",
  "urmărit penal",
  "pus sub acuzare",
  "dosar penal",
  "plagiat",
  "minciună",
  "mințit",
  "scandal",
  "misconduct",
  "scam",
];

export type RiskFlag = {
  field: SummaryFieldName;
  sentence: string;
  entity: string;
  term: string;
};

const ENTITY_STOPWORDS = new Set(
  [
    // Sentence starters / common capitalized non-entities in Romanian prose.
    "În",
    "În plus",
    "De",
    "La",
    "Un",
    "O",
    "Cel",
    "Cea",
    "Acest",
    "Această",
    "După",
    "Până",
    "Pe",
    "Din",
    "Potrivit",
    "Conform",
    "Deși",
    "Dacă",
    "Când",
    "Astfel",
    "Totodată",
    "Ministerul",
    "Guvernul",
    "Parlamentul",
    "Senatul",
    "Camera",
    "Comisia",
    "Consiliul",
    "Curtea",
    "Primăria",
    "Poliția",
    "Jandarmeria",
    "România",
    "Bucureşti",
    "București",
    "Uniunea",
  ].map((w) => w.toLowerCase()),
);

/**
 * Heuristic person/organization detector: runs of ≥2 capitalized words, or a
 * single capitalized word that is not sentence-initial and not a common
 * capitalized non-entity. Generic institutions alone (Guvernul, Parlamentul)
 * are excluded — the defamation risk targets identifiable persons/orgs.
 */
export function findNamedEntities(sentence: string): string[] {
  const entities: string[] = [];
  // ≥2 capitalized words, optionally joined by a Romanian connector
  // ("Ministerul de Interne", "Banca Națională a României") — else a single
  // capitalized word.
  const runRegex =
    /\p{Lu}[\p{L}'’-]*(?:\s+(?:(?:de|al|a|ale|lui)\s+)?\p{Lu}[\p{L}'’-]*)+|\p{Lu}[\p{L}'’-]+/gu;
  for (const match of sentence.matchAll(runRegex)) {
    const candidate = match[0].trim();
    const isSentenceStart = match.index === 0;
    const words = candidate.split(/\s+/);
    if (words.length >= 2) {
      entities.push(candidate);
      continue;
    }
    if (
      !isSentenceStart &&
      !ENTITY_STOPWORDS.has(candidate.toLowerCase()) &&
      candidate.length > 2
    ) {
      entities.push(candidate);
    }
  }
  return entities;
}

/**
 * Flag sentences where a named entity co-occurs with an accusation term.
 * Flagged summaries are held for human review instead of auto-publishing.
 */
export function findRiskySentences(
  fields: Partial<Record<SummaryFieldName, string>>,
  lexicon: string[] = DEFAULT_ACCUSATION_LEXICON,
): RiskFlag[] {
  const flags: RiskFlag[] = [];
  const terms = lexicon
    .map((term) => term.trim().toLowerCase())
    .filter(Boolean);

  for (const { field, sentence } of collectSummarySentences(fields)) {
    const lower = sentence.toLowerCase();
    const matchedTerm = terms.find((term) =>
      new RegExp(
        `(?:^|[^\\p{L}])${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`,
        "iu",
      ).test(lower),
    );
    if (!matchedTerm) continue;
    const entities = findNamedEntities(sentence);
    if (entities.length === 0) continue;
    flags.push({
      field,
      sentence,
      entity: entities[0]!,
      term: matchedTerm,
    });
  }
  return flags;
}
