// Alert dedupe vs acknowledgement (pipeline.ts upsertPipelineAlert).
import { convexTest, type TestConvex } from "convex-test";
import { describe, expect, test } from "vitest";

import schema from "./schema";
import { internal } from "./_generated/api";
import { acknowledgedAlertPatch } from "./pipeline";

const modules = (
  import.meta as unknown as {
    glob: (pattern: string) => Record<string, () => Promise<unknown>>;
  }
).glob("./**/!(*.*.*)*.*s");

const ALERT = {
  severity: "error" as const,
  code: "job_error_rate:ingestAllFeeds",
  message: "ingestAllFeeds success ratio is below 80%.",
  details: { total: 6, ok: 0 },
};

async function alertsWithCode(t: TestConvex<typeof schema>) {
  return t.run(async (ctx) =>
    ctx.db
      .query("pipelineAlerts")
      .withIndex("by_code", (q) => q.eq("code", ALERT.code))
      .collect(),
  );
}

describe("pipeline alerts", () => {
  test("an open alert dedupes; once acknowledged the rule can fire again", async () => {
    const t = convexTest(schema, modules);
    const first = await t.mutation(internal.pipeline.upsertPipelineAlert, ALERT);
    const again = await t.mutation(internal.pipeline.upsertPipelineAlert, ALERT);
    expect(again).toBe(first);
    expect(await alertsWithCode(t)).toHaveLength(1);

    // What acknowledgeAlert writes.
    await t.run(async (ctx) =>
      ctx.db.patch(first, acknowledgedAlertPatch("ops@example.com", Date.now())),
    );

    const refired = await t.mutation(
      internal.pipeline.upsertPipelineAlert,
      ALERT,
    );
    expect(refired).not.toBe(first);
    expect(await alertsWithCode(t)).toHaveLength(2);
  });

  test("migration resolves acknowledged alerts and leaves open ones", async () => {
    const t = convexTest(schema, modules);
    const ackedAt = Date.now() - 1000;
    const [acked, open] = await t.run(async (ctx) => [
      await ctx.db.insert("pipelineAlerts", {
        ...ALERT,
        createdAt: ackedAt - 1000,
        acknowledgedAt: ackedAt,
        acknowledgedBy: "ops@example.com",
      }),
      await ctx.db.insert("pipelineAlerts", {
        ...ALERT,
        code: "archive_run_absent",
        createdAt: ackedAt,
      }),
    ]);

    const dry = await t.mutation(
      internal.migrations.resolveAcknowledgedAlerts,
      {},
    );
    expect(dry).toMatchObject({ dryRun: true, resolved: 1, stillOpen: 1 });
    expect((await t.run((ctx) => ctx.db.get(acked)))!.resolvedAt).toBeUndefined();

    await t.mutation(internal.migrations.resolveAcknowledgedAlerts, {
      dryRun: false,
    });
    expect((await t.run((ctx) => ctx.db.get(acked)))!.resolvedAt).toBe(ackedAt);
    expect((await t.run((ctx) => ctx.db.get(open)))!.resolvedAt).toBeUndefined();
  });
});
