export type InteractionContextSnapshot = {
  biasRating: number;
  sourceReliability: number;
};

type InteractionSourceSnapshot = {
  _id: string;
  baseBias: number;
  reliabilityScore: number;
};

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

export function getClientDeviceType(): "mobile" | "tablet" | "desktop" {
  if (typeof window === "undefined") {
    return "desktop";
  }

  const width = window.innerWidth;
  if (width < 768) return "mobile";
  if (width < 1024) return "tablet";
  return "desktop";
}

export function getScrollDepthPercentage(): number {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return 0;
  }

  const doc = document.documentElement;
  const scrollableHeight = doc.scrollHeight - window.innerHeight;
  if (scrollableHeight <= 0) return 1;

  return Math.max(0, Math.min(1, window.scrollY / scrollableHeight));
}
