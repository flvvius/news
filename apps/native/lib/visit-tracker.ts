/**
 * Per-visit read tracker (Ticket 8). An event visit must produce exactly ONE
 * read append — on leave (blur/unmount) with the final time + max scroll —
 * regardless of how many scroll/time updates happened during the visit.
 *
 * Scroll updates only advance the max depth; the single commit happens once and
 * is idempotent (a second commit, e.g. a duplicate cleanup, is ignored).
 */
export type VisitCommit = {
  timeSpentSeconds: number;
  scrollDepthPercentage: number;
};

export function createVisitTracker(opts: {
  startedAt: number;
  now: () => number;
  onCommit: (commit: VisitCommit) => void;
}) {
  let maxScrollDepth = 0;
  let committed = false;

  return {
    /** Record a scroll depth (0–1); keeps only the deepest seen. */
    recordScroll(depth: number) {
      if (depth > maxScrollDepth) maxScrollDepth = depth;
    },
    /** Commit the single read for this visit. No-op after the first call. */
    commit() {
      if (committed) return;
      committed = true;
      const timeSpentSeconds = Math.max(
        1,
        Math.round((opts.now() - opts.startedAt) / 1000),
      );
      opts.onCommit({ timeSpentSeconds, scrollDepthPercentage: maxScrollDepth });
    },
  };
}
