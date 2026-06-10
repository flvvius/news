export type BiasBucket = "left" | "center" | "right";

type BiasSourceLike = {
  baseBias: number;
  mbfcCategory?: string;
};

/** Same bucketing as the web event card / coverage summary. */
export function getBiasBucket(source: BiasSourceLike): BiasBucket {
  const category = source.mbfcCategory?.toLowerCase();
  if (category === "left" || category === "left-center") return "left";
  if (category === "right" || category === "right-center") return "right";
  if (category === "center") return "center";
  if (source.baseBias < 0) return "left";
  if (source.baseBias > 0) return "right";
  return "center";
}

export function biasBucketBgClass(bucket: BiasBucket): string {
  if (bucket === "left") return "bg-bias-left-muted";
  if (bucket === "right") return "bg-bias-right-muted";
  return "bg-bias-center";
}

export const DEFAULT_BIAS_THRESHOLDS = [-2, -0.5, 0.5, 2];

export function validateBiasThresholds(raw: unknown): number[] {
  if (
    !Array.isArray(raw) ||
    raw.length < 4 ||
    !raw.slice(0, 4).every((v) => typeof v === "number" && Number.isFinite(v))
  ) {
    return DEFAULT_BIAS_THRESHOLDS;
  }
  return (raw.slice(0, 4) as number[]).sort((a, b) => a - b);
}

export function getBiasLabel(bias: number, thresholds: number[]): string {
  if (bias < thresholds[0]) return "Left";
  if (bias < thresholds[1]) return "Lean left";
  if (bias <= thresholds[2]) return "Center";
  if (bias <= thresholds[3]) return "Lean right";
  return "Right";
}
