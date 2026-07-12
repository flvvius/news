// General contact form: a message is stored for the admin dashboard and an
// admin alert email is scheduled; input is validated and rate-limited.
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";

import schema from "./schema";
import { api } from "./_generated/api";

const modules = (
  import.meta as unknown as {
    glob: (pattern: string) => Record<string, () => Promise<unknown>>;
  }
).glob("./**/!(*.*.*)*.*s");

const VALID = {
  name: "Ana Pop",
  email: "ana@example.com",
  subject: "Întrebare",
  message: "Aș vrea să vă întreb ceva despre o știre.",
};

describe("contact form", () => {
  test("stores the message (status new) and schedules the admin email", async () => {
    const t = convexTest(schema, modules);

    const result = await t.mutation(api.contact.submitContactMessage, VALID);
    expect(result.received).toBe(true);

    const rows = await t.run(async (ctx) =>
      ctx.db.query("contactMessages").collect(),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe("new");
    expect(rows[0]!.email).toBe("ana@example.com");
    expect(rows[0]!.createdAt).toBeGreaterThan(0);

    const scheduled = await t.run(async (ctx) =>
      ctx.db.system.query("_scheduled_functions").collect(),
    );
    expect(
      scheduled.some((fn) => fn.name.includes("sendContactMessageEmail")),
      "submit must schedule the admin alert email",
    ).toBe(true);
  });

  test("falls back to a placeholder subject when omitted", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(api.contact.submitContactMessage, {
      ...VALID,
      subject: "   ",
    });
    const rows = await t.run(async (ctx) =>
      ctx.db.query("contactMessages").collect(),
    );
    expect(rows[0]!.subject).toBe("(fără subiect)");
  });

  test("rejects an invalid email and a too-short message", async () => {
    const t = convexTest(schema, modules);
    await expect(
      t.mutation(api.contact.submitContactMessage, {
        ...VALID,
        email: "not-an-email",
      }),
    ).rejects.toThrow();
    await expect(
      t.mutation(api.contact.submitContactMessage, { ...VALID, message: "scurt" }),
    ).rejects.toThrow();

    const rows = await t.run(async (ctx) =>
      ctx.db.query("contactMessages").collect(),
    );
    expect(rows).toHaveLength(0);
  });

  test("rate-limits repeated messages from the same sender", async () => {
    const t = convexTest(schema, modules);
    for (let i = 0; i < 5; i++) {
      await t.mutation(api.contact.submitContactMessage, {
        ...VALID,
        message: `Mesajul numărul ${i}, suficient de lung.`,
      });
    }
    await expect(
      t.mutation(api.contact.submitContactMessage, {
        ...VALID,
        message: "Al șaselea mesaj, ar trebui blocat.",
      }),
    ).rejects.toThrow();
  });
});
