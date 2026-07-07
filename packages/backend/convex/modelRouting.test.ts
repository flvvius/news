import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";

import schema from "./schema";
import { internal } from "./_generated/api";
import {
  DEFAULT_CHAT_MODEL,
  DEFAULT_EMBEDDING_MODEL,
  buildChatTuningParams,
  isGpt5FamilyModel,
  providerForModel,
} from "./lib/modelRouting";
import { calculateCost } from "./aiBudget";

describe("LLM provider routing (BIV-201)", () => {
  test("default chat model is Gemini Flash-Lite; embeddings stay on OpenAI", () => {
    expect(DEFAULT_CHAT_MODEL).toBe("gemini-3.1-flash-lite");
    expect(DEFAULT_EMBEDDING_MODEL).toBe("text-embedding-3-small");
    expect(providerForModel(DEFAULT_CHAT_MODEL)).toBe("gemini");
    expect(providerForModel(DEFAULT_EMBEDDING_MODEL)).toBe("openai");
  });

  test("routes by model prefix", () => {
    expect(providerForModel("gemini-3.5-flash")).toBe("gemini");
    expect(providerForModel("gpt-5-nano")).toBe("openai");
    expect(providerForModel("gpt-4o-mini")).toBe("openai");
  });

  test("gpt-5 family detection", () => {
    expect(isGpt5FamilyModel("gpt-5-nano")).toBe(true);
    expect(isGpt5FamilyModel("gpt-4o")).toBe(false);
    expect(isGpt5FamilyModel("gemini-3.1-flash-lite")).toBe(false);
  });
});

describe("chat tuning parameters per provider (BIV-201)", () => {
  test("gemini models get temperature/max_tokens and no OpenAI cache keys", () => {
    const params = buildChatTuningParams("gemini-3.1-flash-lite", {
      maxTokens: 900,
      promptCacheKey: "biviant:event_summary",
      promptCacheRetention: "24h",
    });
    expect(params).toEqual({ temperature: 0.1, max_tokens: 900 });
  });

  test("gpt-5 family gets reasoning_effort/max_completion_tokens", () => {
    const params = buildChatTuningParams("gpt-5-nano", {
      maxTokens: 900,
      reasoningEffort: "low",
      promptCacheKey: "biviant:event_summary",
    });
    expect(params).toEqual({
      reasoning_effort: "low",
      max_completion_tokens: 900,
      prompt_cache_key: "biviant:event_summary",
    });
  });

  test("other OpenAI models keep temperature + prompt cache keys", () => {
    const params = buildChatTuningParams("gpt-4o-mini", {
      maxTokens: 500,
      temperature: 0.2,
      promptCacheKey: "biviant:bias_scoring",
      promptCacheRetention: "24h",
    });
    expect(params).toEqual({
      temperature: 0.2,
      max_tokens: 500,
      prompt_cache_key: "biviant:bias_scoring",
      prompt_cache_retention: "24h",
    });
  });
});

const modules = (
  import.meta as unknown as {
    glob: (pattern: string) => Record<string, () => Promise<unknown>>;
  }
).glob("./**/!(*.*.*)*.*s");

describe("seedDefaults model migration (BIV-201)", () => {
  test("migrates stale gpt-5-nano defaults but keeps operator overrides", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      // Stale prior default — should migrate to the new Gemini default.
      await ctx.db.insert("config", {
        key: "event_summary_model",
        value: JSON.stringify("gpt-5-nano"),
        description: "old",
        updatedAt: Date.now(),
      });
      // Explicit operator override — must be preserved.
      await ctx.db.insert("config", {
        key: "article_bias_detection_model",
        value: JSON.stringify("gpt-5-mini"),
        description: "operator override",
        updatedAt: Date.now(),
      });
    });

    await t.mutation(internal.config.seedDefaults, {});

    await t.run(async (ctx) => {
      const summaryModel = await ctx.db
        .query("config")
        .withIndex("by_key", (q) => q.eq("key", "event_summary_model"))
        .unique();
      expect(JSON.parse(summaryModel!.value)).toBe("gemini-3.1-flash-lite");

      const biasModel = await ctx.db
        .query("config")
        .withIndex("by_key", (q) => q.eq("key", "article_bias_detection_model"))
        .unique();
      expect(JSON.parse(biasModel!.value)).toBe("gpt-5-mini");
    });
  });
});

describe("cost logging covers the new provider (BIV-201)", () => {
  test("gemini models have pricing entries (not the unknown-model fallback)", () => {
    const flashLiteCost = calculateCost("gemini-3.1-flash-lite", 1_000_000, 0);
    expect(flashLiteCost).toBeCloseTo(0.1, 5);
    const flashCost = calculateCost("gemini-3.5-flash", 0, 1_000_000);
    expect(flashCost).toBeCloseTo(2.5, 5);
  });
});
