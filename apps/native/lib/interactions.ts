export type InteractionContextSnapshot = {
  biasRating: number;
  sourceReliability: number;
};

type InteractionSourceSnapshot = {
  _id: string;
  baseBias: number;
  reliabilityScore: number;
};

/** Mirrors apps/web/src/lib/interaction-tracking.ts. */
export function buildInteractionContextFromSources(
  sources: Array<InteractionSourceSnapshot | null | undefined>,
): InteractionContextSnapshot | undefined {
  const uniqueSources = new Map<string, InteractionSourceSnapshot>();
  for (const source of sources) {
    if (!source) continue;
    if (!uniqueSources.has(source._id)) {
      uniqueSources.set(source._id, source);
    }
  }

  if (uniqueSources.size === 0) {
    return undefined;
  }

  const sourceList = Array.from(uniqueSources.values());
  const totalBias = sourceList.reduce((sum, source) => sum + source.baseBias, 0);
  const totalReliability = sourceList.reduce(
    (sum, source) => sum + source.reliabilityScore,
    0,
  );

  return {
    biasRating: Number((totalBias / sourceList.length).toFixed(2)),
    sourceReliability: Number(
      (totalReliability / sourceList.length).toFixed(2),
    ),
  };
}

export const NATIVE_DEVICE_TYPE = "mobile" as const;
