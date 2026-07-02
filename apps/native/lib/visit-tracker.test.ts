import { describe, expect, test, vi } from "vitest";

import { createVisitTracker } from "./visit-tracker";

describe("createVisitTracker (Ticket 8: one append per visit)", () => {
  test("commits exactly once with final time + max scroll, despite churn", () => {
    const onCommit = vi.fn();
    let now = 1_000_000;
    const tracker = createVisitTracker({
      startedAt: now,
      now: () => now,
      onCommit,
    });

    // Simulate scroll/time churn during the visit.
    tracker.recordScroll(0.2);
    tracker.recordScroll(0.7);
    tracker.recordScroll(0.5); // not deeper — ignored
    now += 42_000; // 42s elapsed

    tracker.commit();

    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith({
      timeSpentSeconds: 42,
      scrollDepthPercentage: 0.7,
    });
  });

  test("a second commit is ignored (idempotent)", () => {
    const onCommit = vi.fn();
    const tracker = createVisitTracker({
      startedAt: 0,
      now: () => 5_000,
      onCommit,
    });
    tracker.commit();
    tracker.commit();
    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  test("time is at least 1 second even for an instant visit", () => {
    const onCommit = vi.fn();
    const tracker = createVisitTracker({
      startedAt: 1000,
      now: () => 1000,
      onCommit,
    });
    tracker.commit();
    expect(onCommit).toHaveBeenCalledWith({
      timeSpentSeconds: 1,
      scrollDepthPercentage: 0,
    });
  });
});
