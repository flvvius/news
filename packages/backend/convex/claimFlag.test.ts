import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";

import schema from "./schema";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

const modules = (
  import.meta as unknown as {
    glob: (pattern: string) => Record<string, () => Promise<unknown>>;
  }
).glob("./**/!(*.*.*)*.*s");

async function seedPublishedEventWithClaim(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) => {
    const sourceId = await ctx.db.insert("sources", {
      domain: "digi24.ro",
      name: "Digi24",
      baseBias: -1,
      reliabilityScore: 8,
    });
    const eventId = await ctx.db.insert("events", {
      title: "Test event",
      slug: "test-event",
      status: "published",
      firstPublishedAt: Date.now(),
    });
    const articleId = await ctx.db.insert("articles", {
      sourceId,
      eventId,
      title: "Article",
      url: "https://digi24.ro/a",
      canonicalUrl: "https://digi24.ro/a",
      status: "clustered",
      publishedAt: Date.now(),
    });
    await ctx.db.insert("eventClaims", {
      eventId,
      canonicalStatement: "Guvernul a adoptat bugetul.",
      claimType: "event",
      status: "agreement",
      variants: [
        {
          articleId,
          sourceId,
          sourceLean: "center",
          statement: "Guvernul a adoptat bugetul.",
        },
      ],
      importance: 4,
      confidence: 0.9,
      generatedAt: Date.now(),
    });
    return eventId;
  });
}

async function setClaimFlag(
  t: ReturnType<typeof convexTest>,
  enabled: boolean,
) {
  await t.run(async (ctx) => {
    await ctx.db.insert("config", {
      key: "claim_analysis_enabled",
      value: JSON.stringify(enabled),
      description: "test",
      updatedAt: Date.now(),
    });
  });
}

describe("claim analysis feature flag (BIV-602)", () => {
  test("getEventClaims returns null when the flag is off (default)", async () => {
    const t = convexTest(schema, modules);
    const eventId: Id<"events"> = await seedPublishedEventWithClaim(t);

    const claims = await t.query(api.claimDivergence.getEventClaims, {
      eventId,
    });
    expect(claims).toBeNull();
  });

  test("getEventClaims returns rows when the flag is on", async () => {
    const t = convexTest(schema, modules);
    const eventId: Id<"events"> = await seedPublishedEventWithClaim(t);
    await setClaimFlag(t, true);

    const claims = await t.query(api.claimDivergence.getEventClaims, {
      eventId,
    });
    expect(claims).not.toBeNull();
    expect(claims).toHaveLength(1);
    expect(claims![0]!.canonicalStatement).toBe("Guvernul a adoptat bugetul.");
  });
});
