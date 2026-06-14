import { convexTest } from "convex-test";
import { ConvexError } from "convex/values";
import { describe, expect, test } from "vitest";

import { enforceRateLimit } from "./lib/rateLimit";
import schema from "./schema";

const modules = (
  import.meta as unknown as {
    glob: (pattern: string) => Record<string, () => Promise<unknown>>;
  }
).glob("./**/!(*.*.*)*.*s");

describe("enforceRateLimit (Ticket 18)", () => {
  test("allows up to the limit, then throws within the window", async () => {
    const t = convexTest(schema, modules);
    const run = (now: number) =>
      t.run((ctx) =>
        enforceRateLimit(ctx, { key: "merge:dev1", limit: 3, windowMs: 60_000, now }),
      );

    await run(1000); // 1
    await run(1000); // 2
    await run(1000); // 3
    await expect(run(1000)).rejects.toBeInstanceOf(ConvexError); // 4 → blocked
  });

  test("resets after the window elapses", async () => {
    const t = convexTest(schema, modules);
    const run = (now: number) =>
      t.run((ctx) =>
        enforceRateLimit(ctx, { key: "merge:dev2", limit: 1, windowMs: 1000, now }),
      );

    await run(0); // 1, ok
    await expect(run(500)).rejects.toBeInstanceOf(ConvexError); // within window
    await run(1500); // window elapsed → allowed again
  });

  test("different keys are independent", async () => {
    const t = convexTest(schema, modules);
    await t.run((ctx) =>
      enforceRateLimit(ctx, { key: "a", limit: 1, windowMs: 1000, now: 0 }),
    );
    // Different key still allowed.
    await t.run((ctx) =>
      enforceRateLimit(ctx, { key: "b", limit: 1, windowMs: 1000, now: 0 }),
    );
  });
});
