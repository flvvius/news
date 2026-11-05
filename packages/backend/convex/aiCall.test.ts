import { APICallError } from "ai";
import { MockEmbeddingModelV4, MockLanguageModelV4 } from "ai/test";
import { beforeEach, describe, expect, test, vi } from "vitest";

import type { ActionCtx } from "./_generated/server";

// callLLM resolves models through lib/llmProviders; swap in AI SDK mocks so no
// request leaves the test.
const models = vi.hoisted(() => ({
  chat: null as unknown,
  embedding: null as unknown,
}));
vi.mock("./lib/llmProviders", () => ({
  languageModelFor: () => models.chat,
  embeddingModelFor: () => models.embedding,
}));

const { callLLM } = await import("./lib/aiCall");
const { isProviderOverloadError, isRateLimitError } = await import(
  "./lib/rateLimitError"
);

type MutationCall = { args: Record<string, unknown> };

function fakeRuntime() {
  const calls: MutationCall[] = [];
  const runtime = {
    runMutation: vi.fn(async (_ref: unknown, args: Record<string, unknown>) => {
      calls.push({ args });
      return {
        allowed: true,
        reservationId: "reservation_1",
        spentUsd: 0,
        dailyLimitUsd: 1,
      };
    }),
  } as unknown as ActionCtx;
  return { runtime, calls };
}

function usage(input: number, output: number, cacheRead = 0) {
  return {
    inputTokens: {
      total: input,
      noCache: input - cacheRead,
      cacheRead,
      cacheWrite: undefined,
    },
    outputTokens: { total: output, text: output, reasoning: undefined },
  };
}

function textResult(
  text: string,
  finish: "stop" | "length" = "stop",
  tokens = usage(100, 20),
) {
  return {
    content: [{ type: "text" as const, text }],
    finishReason: { unified: finish, raw: finish },
    usage: tokens,
    warnings: [],
  };
}

const SCHEMA = {
  type: "json_schema" as const,
  json_schema: {
    name: "Thing",
    strict: true,
    schema: {
      type: "object",
      additionalProperties: false,
      properties: { answer: { type: "string" } },
      required: ["answer"],
    },
  },
};

const MESSAGES = [
  { role: "system" as const, content: "You are terse." },
  { role: "user" as const, content: "Answer." },
];

beforeEach(() => {
  models.chat = null;
  models.embedding = null;
});

describe("callLLM on the AI SDK", () => {
  test("structured output is parsed, sent as a JSON schema, and usage logged", async () => {
    const model = new MockLanguageModelV4({
      doGenerate: textResult('{"answer":"da"}', "stop", usage(100, 20, 40)),
    });
    models.chat = model;
    const { runtime, calls } = fakeRuntime();

    const response = await callLLM<{ answer: string }>({
      kind: "chat",
      model: "gemini-3.1-flash-lite",
      messages: MESSAGES,
      responseFormat: SCHEMA,
      maxTokens: 500,
      context: { callType: "event_summary" },
      runtime,
    });

    expect(response.error).toBeUndefined();
    expect(response.result).toEqual({ answer: "da" });
    expect(response.usage).toMatchObject({
      inputTokens: 100,
      outputTokens: 20,
      cachedInputTokens: 40,
    });

    const sent = model.doGenerateCalls[0]!;
    expect(sent.responseFormat).toMatchObject({ type: "json", name: "Thing" });
    expect(sent.maxOutputTokens).toBe(500);
    expect(sent.prompt[0]).toMatchObject({ role: "system" });

    // reserveBudget, then recordUsage with the real token counts.
    const recorded = calls.find((call) => "inputTokens" in call.args);
    expect(recorded?.args).toMatchObject({
      inputTokens: 100,
      outputTokens: 20,
      cachedInputTokens: 40,
      reservationId: "reservation_1",
    });
  });

  test("plain text calls return the text", async () => {
    models.chat = new MockLanguageModelV4({ doGenerate: textResult("salut") });
    const { runtime } = fakeRuntime();

    const response = await callLLM<string>({
      kind: "chat",
      model: "gpt-4o-mini",
      messages: MESSAGES,
      context: { callType: "topic_inference" },
      runtime,
    });

    expect(response.result).toBe("salut");
  });

  test("a truncated response retries with a doubled token cap", async () => {
    const model = new MockLanguageModelV4({
      doGenerate: [
        textResult('{"answer":"cut mid', "length"),
        textResult('{"answer":"whole"}'),
      ],
    });
    models.chat = model;
    const { runtime } = fakeRuntime();

    const response = await callLLM<{ answer: string }>({
      kind: "chat",
      model: "gemini-3.5-flash",
      messages: MESSAGES,
      responseFormat: SCHEMA,
      maxTokens: 1200,
      context: { callType: "event_summary" },
      runtime,
    });

    expect(response.result).toEqual({ answer: "whole" });
    expect(model.doGenerateCalls.map((call) => call.maxOutputTokens)).toEqual([
      1200, 2400,
    ]);
  });

  test("unparseable JSON fails without a retry", async () => {
    const model = new MockLanguageModelV4({
      doGenerate: [textResult("not json"), textResult('{"answer":"x"}')],
    });
    models.chat = model;
    const { runtime } = fakeRuntime();

    const response = await callLLM({
      kind: "chat",
      model: "gemini-3.1-flash-lite",
      messages: MESSAGES,
      responseFormat: SCHEMA,
      context: { callType: "bias_scoring" },
      runtime,
    });

    expect(response.result).toBeNull();
    expect(response.error).toMatch(/could not parse/);
    expect(model.doGenerateCalls).toHaveLength(1);
  });

  test("a 429 comes back as a rate-limit error and releases the reservation", async () => {
    models.chat = new MockLanguageModelV4({
      doGenerate: async () => {
        throw new APICallError({
          message: "Resource has been exhausted (e.g. check quota).",
          url: "https://generativelanguage.googleapis.com",
          requestBodyValues: {},
          statusCode: 429,
        });
      },
    });
    const { runtime, calls } = fakeRuntime();

    const response = await callLLM({
      kind: "chat",
      model: "gemini-3.5-flash",
      messages: MESSAGES,
      responseFormat: SCHEMA,
      context: { callType: "event_summary" },
      runtime,
      maxRetries: 1,
    });

    expect(response.result).toBeNull();
    expect(response.error).toMatch(/^429 /);
    expect(isRateLimitError(response.error)).toBe(true);
    // reserveBudget, then releaseReservation (no usage to record).
    expect(calls[calls.length - 1]?.args).toEqual({ reservationId: "reservation_1" });
  });

  test("a 503 overload comes back in a shape the summary fallback recognizes", async () => {
    models.chat = new MockLanguageModelV4({
      doGenerate: async () => {
        throw new APICallError({
          message:
            "This model is currently experiencing high demand. Spikes in demand are usually temporary. Please try again later.",
          url: "https://generativelanguage.googleapis.com",
          requestBodyValues: {},
          statusCode: 503,
        });
      },
    });
    const { runtime } = fakeRuntime();

    const response = await callLLM({
      kind: "chat",
      model: "gemini-3.5-flash-lite",
      messages: MESSAGES,
      responseFormat: SCHEMA,
      context: { callType: "event_summary" },
      runtime,
      maxRetries: 1,
    });

    expect(response.result).toBeNull();
    expect(response.error).toMatch(/^503 /);
    expect(isProviderOverloadError(response.error)).toBe(true);
    expect(isRateLimitError(response.error)).toBe(false);
  });

  test("Gemini thinking level reaches the provider options", async () => {
    const model = new MockLanguageModelV4({
      doGenerate: textResult('{"answer":"da"}'),
    });
    models.chat = model;
    const { runtime } = fakeRuntime();

    await callLLM({
      kind: "chat",
      model: "gemini-3.5-flash",
      messages: MESSAGES,
      responseFormat: SCHEMA,
      thinkingLevel: "low",
      context: { callType: "event_summary" },
      runtime,
    });

    expect(model.doGenerateCalls[0]!.providerOptions).toEqual({
      google: { thinkingConfig: { thinkingLevel: "low" } },
    });
  });

  test("embeddings come back as vectors in input order", async () => {
    models.embedding = new MockEmbeddingModelV4({
      maxEmbeddingsPerCall: 100,
      doEmbed: async ({ values }) => ({
        embeddings: values.map((_, index) => [index, index + 0.5]),
        usage: { tokens: 12 },
        warnings: [],
      }),
    });
    const { runtime } = fakeRuntime();

    const response = await callLLM<number[][]>({
      kind: "embedding",
      model: "text-embedding-3-small",
      input: ["a", "b", "c"],
      dimensions: 512,
      context: { callType: "embedding" },
      runtime,
    });

    expect(response.result).toEqual([
      [0, 0.5],
      [1, 1.5],
      [2, 2.5],
    ]);
    expect(response.usage.inputTokens).toBe(12);
  });
});
