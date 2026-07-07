/**
 * Named-axis bias representation (BIV-302).
 *
 * Bias is stored as `{ axis, score }` so adding another axis later is
 * additive instead of a migration. The launch axis is the
 * reformist↔suveranist cleavage specced in docs/bias-axis-spec.md:
 * negative = reformist/pro-european framing, positive = suveranist framing,
 * range −5..+5.
 *
 * `sources.baseBias` and `articles.aiBiasScore` remain the derived
 * single-score mirrors the UI consumes; writers must keep them in sync via
 * the helpers here.
 */

import { v } from "convex/values";

export const BIAS_AXIS = "reformist_suveranist" as const;

export const BIAS_SCORE_MIN = -5;
export const BIAS_SCORE_MAX = 5;

export type NamedAxisBias = {
  axis: string;
  score: number;
};

/** Convex validator for the named-axis bias object. */
export const namedAxisBiasValidator = v.object({
  axis: v.string(),
  score: v.number(),
});

export function clampBiasScore(score: number): number {
  if (!Number.isFinite(score)) return 0;
  return Math.min(BIAS_SCORE_MAX, Math.max(BIAS_SCORE_MIN, score));
}

/** Build the canonical bias object for a single-axis score. */
export function namedAxisBias(score: number): NamedAxisBias {
  return { axis: BIAS_AXIS, score: clampBiasScore(score) };
}

/** Read the single score out of a bias object, with a numeric fallback. */
export function biasScoreOf(
  bias: NamedAxisBias | undefined | null,
  fallback: number,
): number {
  return bias ? bias.score : fallback;
}

// ---------------------------------------------------------------------------
// Perspective summaries (BIV-303): neutral / reformist / suveranist
// ---------------------------------------------------------------------------

export type PerspectiveSummaries = {
  neutral?: string;
  reformist?: string;
  suveranist?: string;
  /** @deprecated pre-BIV-303 key — read-only until backfillPerspectiveAxisKeys runs */
  center?: string;
  /** @deprecated pre-BIV-303 key — read-only until backfillPerspectiveAxisKeys runs */
  left?: string;
  /** @deprecated pre-BIV-303 key — read-only until backfillPerspectiveAxisKeys runs */
  right?: string;
};

/**
 * Convex validator for event perspective summaries on the
 * reformist↔suveranist axis. The legacy center/left/right keys stay
 * accepted so pre-migration rows still validate; no code writes them.
 */
export const perspectiveSummariesValidator = v.object({
  neutral: v.optional(v.string()),
  reformist: v.optional(v.string()),
  suveranist: v.optional(v.string()),
  center: v.optional(v.string()),
  left: v.optional(v.string()),
  right: v.optional(v.string()),
});

/**
 * Collapse a stored perspective object to the canonical axis keys,
 * falling back to the legacy keys for pre-migration rows.
 * Returns undefined when nothing is set.
 */
export function normalizedPerspectives(
  summaries: PerspectiveSummaries | undefined | null,
):
  | { neutral?: string; reformist?: string; suveranist?: string }
  | undefined {
  if (!summaries) return undefined;
  const neutral = summaries.neutral ?? summaries.center;
  const reformist = summaries.reformist ?? summaries.left;
  const suveranist = summaries.suveranist ?? summaries.right;
  if (
    neutral === undefined &&
    reformist === undefined &&
    suveranist === undefined
  ) {
    return undefined;
  }
  return {
    ...(neutral !== undefined ? { neutral } : {}),
    ...(reformist !== undefined ? { reformist } : {}),
    ...(suveranist !== undefined ? { suveranist } : {}),
  };
}
