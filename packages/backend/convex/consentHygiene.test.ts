// L12: provable consent + one-click unsubscribe. Every waitlist row carries
// the consent record; the token round-trip needs no auth and takes effect
// immediately; the suppression gate refuses unsubscribed addresses.
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";

import schema from "./schema";
import { api, internal } from "./_generated/api";
import {
  hashConsentText,
  WAITLIST_CONSENT_TEXT,
  WAITLIST_CONSENT_TEXT_VERSION,
} from "./lib/consent";

const modules = (
  import.meta as unknown as {
    glob: (pattern: string) => Record<string, () => Promise<unknown>>;
  }
).glob("./**/!(*.*.*)*.*s");

describe("waitlist consent records (L12)", () => {
  test("every signup stores timestamp, IP, consent text version/hash, source page", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(api.waitlist.addToWaitlist, {
      email: "consent@example.com",
      consentSourcePage: "/",
      clientIp: "203.0.113.7",
    });

    const rows = await t.run(async (ctx) => ctx.db.query("waitlist").collect());
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.consentAt).toBeGreaterThan(0);
    expect(row.consentIp).toBe("203.0.113.7");
    expect(row.consentTextVersion).toBe(WAITLIST_CONSENT_TEXT_VERSION);
    expect(row.consentTextHash).toBe(hashConsentText(WAITLIST_CONSENT_TEXT));
    expect(row.consentSourcePage).toBe("/");
    expect(row.unsubscribeToken).toBeTruthy();
  });

  test("one-click token unsubscribe works without auth and takes effect immediately", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(api.waitlist.addToWaitlist, {
      email: "unsub@example.com",
    });
    const token = await t.run(async (ctx) => {
      const row = await ctx.db.query("waitlist").first();
      return row!.unsubscribeToken!;
    });

    const result = await t.mutation(api.waitlist.unsubscribeByToken, {
      token,
    });
    expect(result.success).toBe(true);

    const row = await t.run(async (ctx) => ctx.db.query("waitlist").first());
    expect(row?.status).toBe("unsubscribed");

    // Suppression is immediate: the send gate refuses the address.
    const sendable = await t.query(
      internal.waitlist.getSendableWaitlistEntry,
      { waitlistId: row!._id },
    );
    expect(sendable).toBeNull();
  });

  test("an invalid token fails without revealing anything", async () => {
    const t = convexTest(schema, modules);
    const result = await t.mutation(api.waitlist.unsubscribeByToken, {
      token: "not-a-real-token",
    });
    expect(result.success).toBe(false);
  });

  test("re-subscribing after unsubscribe records fresh consent", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(api.waitlist.addToWaitlist, {
      email: "again@example.com",
      clientIp: "203.0.113.1",
    });
    const firstConsentAt = await t.run(async (ctx) => {
      const row = await ctx.db.query("waitlist").first();
      await ctx.db.patch(row!._id, { status: "unsubscribed" });
      return row!.consentAt!;
    });

    await new Promise((resolve) => setTimeout(resolve, 5));
    await t.mutation(api.waitlist.addToWaitlist, {
      email: "again@example.com",
      clientIp: "203.0.113.2",
      consentSourcePage: "/feed",
    });

    const row = await t.run(async (ctx) => ctx.db.query("waitlist").first());
    expect(row?.status).toBe("pending");
    expect(row?.consentAt).toBeGreaterThan(firstConsentAt);
    expect(row?.consentIp).toBe("203.0.113.2");
    expect(row?.consentSourcePage).toBe("/feed");
  });

  test("the send gate allows pending entries and exposes the token", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(api.waitlist.addToWaitlist, {
      email: "sendable@example.com",
    });
    const row = await t.run(async (ctx) => ctx.db.query("waitlist").first());
    const sendable = await t.query(
      internal.waitlist.getSendableWaitlistEntry,
      { waitlistId: row!._id },
    );
    expect(sendable?.email).toBe("sendable@example.com");
    expect(sendable?.unsubscribeToken).toBe(row!.unsubscribeToken);
  });
});
