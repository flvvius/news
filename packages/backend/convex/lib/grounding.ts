/**
 * L4 — grounding verification (pure helpers).
 *
 * The Munich AI Overviews ruling holds the operator directly liable for
 * synthesized claims appearing in no source; disclaimers are no defense.
 * Every published sentence must therefore carry a recorded supporting source.
 *
 * The named-entity risk gate that used to live here was removed: it matched
 * accusation terms by prefix, so ordinary coverage tripped it, and one flagged
 * sentence held the entire event out of publication indefinitely.
 */

import { GLOBAL_IMPACT_FALLBACK } from "../prompts";
import {
  LIMITED_COVERAGE_FALLBACK,
  SIDE_COVERAGE_FALLBACK,
} from "./perspectiveText";

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
