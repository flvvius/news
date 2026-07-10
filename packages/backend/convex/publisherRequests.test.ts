// L6: publisher opt-out form → requests table + alert; rate-limited; the
// executed block flows through domainPermissions (covered in L5 tests).
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";

import schema from "./schema";
import { api } from "./_generated/api";

const modules = (
  import.meta as unknown as {
    glob: (pattern: string) => Record<string, () => Promise<unknown>>;
  }
).glob("./**/!(*.*.*)*.*s");

describe("publisher opt-out requests (L6)", () => {
  test("a submission is stored with lifecycle state and raises an alert", async () => {
    const t = convexTest(schema, modules);
    const result = await t.mutation(
      api.publisherRequests.submitPublisherRequest,
      {
        domain: "https://www.exemplu.ro/",
        contact: "redactia@exemplu.ro",
        requestType: "opt_out",
        message: "Vă rugăm să opriți accesarea articolelor noastre.",
      },
    );
    expect(result.received).toBe(true);

    const rows = await t.run(async (ctx) =>
      ctx.db.query("publisherRequests").collect(),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.domain).toBe("exemplu.ro");
    expect(rows[0]!.status).toBe("received");
    expect(rows[0]!.receivedAt).toBeGreaterThan(0);

    const alerts = await t.run(async (ctx) =>
      ctx.db.query("pipelineAlerts").collect(),
    );
    expect(alerts.some((a) => a.code === "publisher_request_received")).toBe(
      true,
    );
  });

  test("invalid domains are rejected", async () => {
    const t = convexTest(schema, modules);
    await expect(
      t.mutation(api.publisherRequests.submitPublisherRequest, {
        domain: "not a domain",
        contact: "cineva@exemplu.ro",
        requestType: "takedown",
      }),
    ).rejects.toThrow();
  });

  test("per-domain submissions are rate limited", async () => {
    const t = convexTest(schema, modules);
    for (let i = 0; i < 3; i++) {
      await t.mutation(api.publisherRequests.submitPublisherRequest, {
        domain: "spam.ro",
        contact: "x@spam.ro",
        requestType: "other",
      });
    }
    await expect(
      t.mutation(api.publisherRequests.submitPublisherRequest, {
        domain: "spam.ro",
        contact: "x@spam.ro",
        requestType: "other",
      }),
    ).rejects.toThrow();
  });
});
