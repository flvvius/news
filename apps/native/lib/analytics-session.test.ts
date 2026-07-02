import { beforeEach, describe, expect, test } from "vitest";

import {
  __resetSessionGuardForTests,
  markFiredOncePerSession,
} from "./analytics-session";

beforeEach(() => __resetSessionGuardForTests());

describe("markFiredOncePerSession (Ticket 16: per-session once guard)", () => {
  test("returns true the first time, false after, per key", () => {
    expect(markFiredOncePerSession("first_feed_render")).toBe(true);
    expect(markFiredOncePerSession("first_feed_render")).toBe(false);
    expect(markFiredOncePerSession("first_feed_render")).toBe(false);
  });

  test("distinct keys are independent", () => {
    expect(markFiredOncePerSession("a")).toBe(true);
    expect(markFiredOncePerSession("b")).toBe(true);
    expect(markFiredOncePerSession("a")).toBe(false);
  });
});
