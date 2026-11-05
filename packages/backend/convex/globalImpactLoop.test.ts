// A fully stripped globalImpact must not leave a blank field (re-queue loop).
import { convexTest } from "convex-test";
import { describe, expect, test, vi } from "vitest";

import schema from "./schema";
import { internal } from "./_generated/api";
import { GLOBAL_IMPACT_FALLBACK } from "./lib/summaryText";
import { shouldResummarize } from "./summarization";
import { SUMMARY_PROMPT_VERSION } from "./prompts";

vi.mock("./lib/llmProviders", () => ({
  languageModelFor: () => {
    throw new Error("no live calls in this test");
  },
  embeddingModelFor: () => {
    throw new Error("no live calls in this test");
  },
  geminiBatchProvider: () => {
    throw new Error("no live calls in this test");
  },
}));

const { stripUnsupportedSentences } = await import("./summarizationNode");

const modules = (
  import.meta as unknown as {
    glob: (pattern: string) => Record<string, () => Promise<unknown>>;
  }
).glob("./**/!(*.*.*)*.*s");

const FIELDS = {
  neutral: "Guvernul a aprobat bugetul. Votul a avut loc luni.",
  reformist: "",
  suveranist: "",
  globalImpact: "Traficul va scădea. Prețurile vor crește.",
};

describe("stripUnsupportedSentences", () => {
  test("a fully unsupported globalImpact becomes the fallback, not blank", () => {
    const stripped = stripUnsupportedSentences(FIELDS, [
      { field: "neutral", sentence: "Guvernul a aprobat bugetul.", supported: true },
      { field: "neutral", sentence: "Votul a avut loc luni.", supported: false },
      { field: "globalImpact", sentence: "Traficul va scădea.", supported: false },
      { field: "globalImpact", sentence: "Prețurile vor crește.", supported: false },
    ]);
    expect(stripped.neutral).toBe("Guvernul a aprobat bugetul.");
    expect(stripped.globalImpact).toBe(GLOBAL_IMPACT_FALLBACK);
  });

  test("supported impact sentences are kept as they are", () => {
    const stripped = stripUnsupportedSentences(FIELDS, [
      { field: "globalImpact", sentence: "Traficul va scădea.", supported: true },
      { field: "globalImpact", sentence: "Prețurile vor crește.", supported: false },
    ]);
    expect(stripped.globalImpact).toBe("Traficul va scădea.");
  });
});

describe("fillBlankGlobalImpact migration", () => {
  test("fills blank impacts on summarized events so they stop re-queuing", async () => {
    const t = convexTest(schema, modules);
    const now = Date.now();
    const base = {
      status: "published" as const,
      firstPublishedAt: now - 10_000,
      lastUpdatedAt: now - 10_000,
      lastArticleAt: now - 10_000,
      articleCount: 3,
      sourceCount: 2,
      sourceIds: [],
      lastSummarizedAt: now,
      lastSummaryPromptVersion: SUMMARY_PROMPT_VERSION,
      perspectiveSummaries: { neutral: "Guvernul a aprobat bugetul." },
    };
    const [blank, done, unsummarized] = await t.run(async (ctx) => [
      await ctx.db.insert("events", { ...base, title: "A", slug: "a", globalImpact: "" }),
      await ctx.db.insert("events", { ...base, title: "B", slug: "b", globalImpact: "Ceva concret." }),
      await ctx.db.insert("events", {
        ...base,
        title: "C",
        slug: "c",
        globalImpact: "",
        lastSummarizedAt: undefined,
      }),
    ]);

    const before = await t.run((ctx) => ctx.db.get(blank));
    expect(shouldResummarize(before!)).toBe(true);

    const dry = await t.mutation(internal.migrations.fillBlankGlobalImpact, {});
    expect(dry).toMatchObject({ dryRun: true, filled: 1, isDone: true });

    await t.mutation(internal.migrations.fillBlankGlobalImpact, { dryRun: false });
    const after = await t.run((ctx) => ctx.db.get(blank));
    expect(after!.globalImpact).toBe(GLOBAL_IMPACT_FALLBACK);
    expect(shouldResummarize(after!)).toBe(false);
    expect((await t.run((ctx) => ctx.db.get(done)))!.globalImpact).toBe("Ceva concret.");
    expect((await t.run((ctx) => ctx.db.get(unsummarized)))!.globalImpact).toBe("");
  });
});
