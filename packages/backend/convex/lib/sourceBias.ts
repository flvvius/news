import type { Doc } from "../_generated/dataModel";

export type SourceBiasLabel =
  | "left"
  | "left-center"
  | "center"
  | "right-center"
  | "right"
  | "unknown";

export function sourceBiasLabel(
  source: Pick<Doc<"sources">, "baseBias" | "mbfcCategory"> | null,
): SourceBiasLabel {
  if (!source) return "unknown";

  const category = source.mbfcCategory?.toLowerCase();
  if (
    category === "left" ||
    category === "left-center" ||
    category === "center" ||
    category === "right-center" ||
    category === "right"
  ) {
    return category;
  }

  if (source.baseBias === 0) return "center";
  if (source.baseBias <= -3) return "left";
  if (source.baseBias < 0) return "left-center";
  if (source.baseBias >= 3) return "right";
  if (source.baseBias > 0) return "right-center";
  return "center";
}
