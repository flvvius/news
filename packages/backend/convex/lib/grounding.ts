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

import {
  LIMITED_COVERAGE_FALLBACK,
  SIDE_COVERAGE_FALLBACK,
} from "./perspectiveText";
import {
  GLOBAL_IMPACT_FALLBACK,
  isFallbackGlobalImpact,
  splitIntoSentences,
} from "./summaryText";

// Re-exported so existing importers (tests, callers) keep their entry point
// while the implementation lives in lib/summaryText.ts, which the clients
// share for rendering.
export { splitIntoSentences };

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
    // The model sometimes qualifies the impact fallback ("…furnizate în ceea
    // ce privește eventuale restricții"). That is still our own boilerplate,
    // not a claim, so it must not be sent to the entailment pass — where it
    // would come back unsupported and block or strip the field.
    if (field === "globalImpact" && isFallbackGlobalImpact(text)) continue;
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
