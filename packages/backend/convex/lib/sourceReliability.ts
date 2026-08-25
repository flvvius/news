/**
 * Reliability presentation — shared by web and native.
 *
 * The stored `reliabilityScore` is a 1-10 integer. On its own a bare number
 * tells a reader nothing: "4/10" is only meaningful next to the scale and a
 * word for what 4 means. This maps the score onto the five bands the UI
 * labels, so both clients describe the same score identically.
 */

export type ReliabilityBand =
  | "veryHigh"
  | "high"
  | "medium"
  | "low"
  | "veryLow";

/** Map a 1-10 reliability score onto its label band. */
export function reliabilityBand(score: number): ReliabilityBand {
  if (score >= 9) return "veryHigh";
  if (score >= 7) return "high";
  if (score >= 5) return "medium";
  if (score >= 3) return "low";
  return "veryLow";
}

/** i18n key for the band label, e.g. "source.reliabilityBand.high". */
export function reliabilityBandKey(score: number): string {
  return `source.reliabilityBand.${reliabilityBand(score)}`;
}
