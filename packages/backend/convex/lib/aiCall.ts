"use node";

import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import {
  APICallError,
  embedMany,
  generateText,
  jsonSchema,
  NoObjectGeneratedError,
  Output,
  type LanguageModelUsage,
} from "ai";

import { calculateCost, calculateCostWithCachedInput } from "../aiBudget";
import { captureLLMEvent } from "./llmAnalytics";
import { embeddingModelFor, languageModelFor } from "./llmProviders";
import {
  buildCallSettings,
  providerForModel,
  type GeminiThinkingLevel,
  type ReasoningEffort,
} from "./modelRouting";
// Rate-limit detection lives in a dependency-free module so non-"use node"
// modules (e.g. migrations.ts) can share it without dragging the Node-only
// SDK imports above into the V8 bundle.
import { errorStatus, isRateLimitError } from "./rateLimitError";

export { isRateLimitError };

export type AICallType =
  | "fact_extraction"
  | "bias_scoring"
  | "event_summary"
  | "claim_divergence"
  | "topic_inference"
  | "quiz_generation"
  | "embedding";

type AICallContext = {
  callType: AICallType;
  eventId?: Id<"events">;
  articleId?: Id<"articles">;
};

type BudgetReservation = {
  reservationId: Id<"aiBudgetReservations">;
};

type AICallUsage = {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  costUsd: number;
  latencyMs: number;
};

type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

/**
 * OpenAI-style structured output spec. The pipeline's schemas are written in
 * this shape; callLLM hands `json_schema.schema` to the AI SDK, which sends it
 * as a strict json_schema (OpenAI) or responseJsonSchema (Gemini).
 */
type JsonSchemaResponseFormat = {
  type: "json_schema";
  json_schema: { name: string; strict?: boolean; schema: Record<string, unknown> };
};

type ChatArgs = {
  kind: "chat";
  model: string;
  messages: ChatMessage[];
  /** When set, the result is the parsed JSON object; otherwise the raw text. */
  responseFormat?: JsonSchemaResponseFormat;
  maxTokens?: number;
  temperature?: number;
  promptCacheKey?: string;
  promptCacheRetention?: "24h";
  reasoningEffort?: ReasoningEffort;
  /** Gemini only. "default"/unset leaves thinking at the model's default. */
  thinkingLevel?: GeminiThinkingLevel;
  context: AICallContext;
  runtime: ActionCtx;
  maxRetries?: number;
};

type EmbeddingArgs = {
  kind: "embedding";
  model: string;
  input: string[];
  dimensions?: number;
  context: AICallContext;
  runtime: ActionCtx;
  maxRetries?: number;
};

export type AICallResult<T> = {
  result: T | null;
  usage: AICallUsage;
  error?: string;
};

function zeroUsage(): AICallUsage {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cachedInputTokens: 0,
    costUsd: 0,
    latencyMs: 0,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}


/**
 * The provider stopped generating because the response hit `max_tokens`
 * (`finish_reason: "length"`), so the body is a valid response cut mid-stream.
 *
 * This used to surface as a bare `SyntaxError` from `JSON.parse` — "Unterminated
 * string in JSON at position 373" — which carries no HTTP status, so
 * `isRetryableError` rejected it and the call failed outright, burning the
 * request and its budget with no retry. Naming the condition lets the loop
 * retry with more headroom instead, and makes the logs say what happened.
 */
class TruncatedOutputError extends Error {
  constructor(limit: number | undefined) {
    super(
      `Model output truncated at max_tokens${limit ? ` (${limit})` : ""} — response was cut mid-JSON`,
    );
    this.name = "TruncatedOutputError";
  }
}

function isTruncationError(error: unknown): boolean {
  return error instanceof TruncatedOutputError;
}

/** Hard ceiling for the escalation below, so a pathological run cannot spiral. */
const MAX_OUTPUT_TOKEN_CEILING = 8000;

function isRetryableError(error: unknown): boolean {
  const status = errorStatus(error);
  return (
    status === 429 ||
    status === 500 ||
    status === 502 ||
    status === 503 ||
    status === 504
  );
}

/**
 * Provider rate/quota rejection (HTTP 429 / RESOURCE_EXHAUSTED). Matches both
 * a live SDK error object (which carries `status`) and the flattened message
 * string `callLLM` returns to its callers (e.g. "429 status code (no body)"),
 * because by the time an action's catch block sees it the status field is gone.
 *
 * Callers should treat this as *backpressure* — defer the work — rather than a
 * failure that burns a retry attempt: the request never reached the model, so
 * nothing about the input is wrong.
 *
 * Additive helper: `isRetryableError` and `callLLM` behaviour are unchanged.
 */

function isFatalError(error: unknown): boolean {
  const status = errorStatus(error);
  return status === 401 || status === 403 || status === 404;
}

function retryDelayMs(attempt: number): number {
  const baseDelay = 500 * 3 ** attempt;
  const jitter = 0.75 + Math.random() * 0.5;
  return Math.round(baseDelay * jitter);
}

function estimateTokensFromText(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

function estimateChatInputTokens(messages: ChatMessage[]): number {
  let tokens = 0;
  for (const message of messages) {
    tokens += estimateTokensFromText(message.content) + 4;
  }
  return tokens + 2;
}

function estimateEmbeddingInputTokens(input: string[]): number {
  return input.reduce((sum, text) => sum + estimateTokensFromText(text), 0);
}

function estimateCallCostUsd(
  args: ChatArgs | EmbeddingArgs,
): {
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
} {
  if (args.kind === "embedding") {
    const inputTokens = estimateEmbeddingInputTokens(args.input);
    return {
      inputTokens,
      outputTokens: 0,
      costUsd: calculateCost(args.model, inputTokens, 0) * 1.1,
    };
  }

  const inputTokens = estimateChatInputTokens(args.messages);
  const outputTokens = Math.max(0, Math.floor(args.maxTokens ?? 0));
  return {
    inputTokens,
    outputTokens,
    costUsd: calculateCost(args.model, inputTokens, outputTokens) * 1.1,
  };
}

async function logUsage(
  runtime: ActionCtx,
  context: AICallContext,
  model: string,
  usage: AICallUsage,
  reservationId?: Id<"aiBudgetReservations">,
): Promise<boolean> {
  try {
    const result = await runtime.runMutation(internal.aiBudget.recordUsage, {
      callType: context.callType,
      model,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      cachedInputTokens: usage.cachedInputTokens,
      costUsd: usage.costUsd,
      latencyMs: usage.latencyMs,
      eventId: context.eventId,
      articleId: context.articleId,
      reservationId,
    });

    if (!result.allowed) {
      console.warn(
        `[aiCall] Usage log exceeded budget for ${context.callType} ($${result.spentUsd}/$${result.dailyLimitUsd})`,
      );
    }
    return true;
  } catch (error) {
    console.error(
      `[aiCall] Usage log failed for ${context.callType} (event ${context.eventId ?? "n/a"}): ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return false;
  }
}

async function reserveBudget(
  runtime: ActionCtx,
  context: AICallContext,
  model: string,
  estimatedCostUsd: number,
): Promise<BudgetReservation | null> {
  const reservation = await runtime.runMutation(
    internal.aiBudget.reserveBudget,
    {
      model,
      callType: context.callType,
      costUsd: estimatedCostUsd,
      eventId: context.eventId,
      articleId: context.articleId,
    },
  );

  if (!reservation.allowed || !reservation.reservationId) {
    console.warn(
      `[aiCall] Daily AI budget exhausted before ${context.callType} ($${reservation.spentUsd}/$${reservation.dailyLimitUsd})`,
    );
    return null;
  }

  return { reservationId: reservation.reservationId };
}

type ChatOutcome = {
  value: unknown;
  usage: LanguageModelUsage | undefined;
  finishReason: string | undefined;
  /** Output the provider returned (and billed) but we could not use. */
  error?: Error;
};

/**
 * One chat call through the AI SDK. Parse failures come back as an outcome,
 * not a throw, because the provider already billed the tokens and callLLM must
 * log them. Provider/HTTP errors still throw.
 */
async function generateChat(
  args: ChatArgs,
  maxTokens: number | undefined,
): Promise<ChatOutcome> {
  const settings = buildCallSettings(args.model, {
    maxTokens,
    temperature: args.temperature,
    reasoningEffort: args.reasoningEffort,
    thinkingLevel: args.thinkingLevel,
    promptCacheKey: args.promptCacheKey ?? `biviant:${args.context.callType}`,
    promptCacheRetention: args.promptCacheRetention,
  });
  const common = {
    model: languageModelFor(args.model),
    messages: args.messages,
    // Call sites put the system prompt first in `messages`.
    allowSystemInMessages: true,
    // Retries stay in callLLM, next to the budget bookkeeping. The SDK's own
    // retry would sleep in-process, which Convex bills as action time.
    maxRetries: 0,
    ...settings,
  };

  try {
    if (!args.responseFormat) {
      const result = await generateText(common);
      return {
        value: result.text,
        usage: result.usage,
        finishReason: result.finishReason,
      };
    }

    const spec = args.responseFormat.json_schema;
    const result = await generateText({
      ...common,
      output: Output.object({
        schema: jsonSchema<unknown>(spec.schema as Parameters<typeof jsonSchema>[0]),
        name: spec.name,
      }),
    });
    // A truncated response with no text has no output to read (the getter
    // throws), so report the finish reason first.
    if (result.finishReason === "length") {
      return {
        value: undefined,
        usage: result.usage,
        finishReason: result.finishReason,
      };
    }
    return {
      value: result.output,
      usage: result.usage,
      finishReason: result.finishReason,
    };
  } catch (error) {
    if (NoObjectGeneratedError.isInstance(error)) {
      return {
        value: undefined,
        usage: error.usage,
        finishReason: error.finishReason,
        error,
      };
    }
    throw error;
  }
}

function chatUsage(
  model: string,
  usage: LanguageModelUsage | undefined,
  startedAt: number,
): AICallUsage {
  const inputTokens = usage?.inputTokens ?? 0;
  // Gemini's count includes thinking tokens, which Google bills as output.
  const outputTokens = usage?.outputTokens ?? 0;
  const cachedInputTokens = usage?.inputTokenDetails?.cacheReadTokens ?? 0;
  return {
    inputTokens,
    outputTokens,
    cachedInputTokens,
    costUsd: calculateCostWithCachedInput(
      model,
      inputTokens,
      cachedInputTokens,
      outputTokens,
    ),
    latencyMs: Date.now() - startedAt,
  };
}

/**
 * Error text handed back to callers and stored as job `lastError`. Provider
 * errors lead with the HTTP status ("429 ...") because isRateLimitError and
 * the requeue migration match on that text after the error object is gone.
 */
function describeError(error: unknown): string {
  if (APICallError.isInstance(error) && error.statusCode != null) {
    return `${error.statusCode} ${error.message}`;
  }
  return error instanceof Error ? error.message : String(error);
}

export async function callLLM<T>(
  args: ChatArgs | EmbeddingArgs,
): Promise<AICallResult<T>> {
  const estimate = estimateCallCostUsd(args);
  const reservation = await reserveBudget(
    args.runtime,
    args.context,
    args.model,
    estimate.costUsd,
  );
  if (!reservation) {
    return {
      result: null,
      usage: zeroUsage(),
      error: "budget_exhausted",
    };
  }
  let reservationId: Id<"aiBudgetReservations"> | null =
    reservation.reservationId;
  let usageLogged = false;

  let lastError: unknown;
  const maxRetries = Math.max(1, Math.floor(args.maxRetries ?? 3));
  // Raised (not reset) when the provider reports a truncated response, so a
  // retry gets room to finish its JSON. max_tokens is a ceiling, not a
  // reservation — billing follows tokens actually generated — so a larger cap
  // costs nothing on calls that never reach it.
  let effectiveMaxTokens =
    args.kind === "chat" ? args.maxTokens : undefined;

  try {
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const startedAt = Date.now();

        if (args.kind === "embedding") {
          // maxRetries: 0 — retries stay in this loop, next to the budget
          // bookkeeping. The SDK's own retry sleeps in-process (billed time).
          const response = await embedMany({
            model: embeddingModelFor(args.model),
            values: args.input,
            ...(args.dimensions ? { dimensions: args.dimensions } : {}),
            maxRetries: 0,
          });
          const inputTokens = response.usage.tokens ?? 0;
          const usage = {
            inputTokens,
            outputTokens: 0,
            cachedInputTokens: 0,
            costUsd: calculateCost(args.model, inputTokens, 0),
            latencyMs: Date.now() - startedAt,
          };
          captureLLMEvent({
            kind: "embedding",
            callType: args.context.callType,
            model: args.model,
            provider: "openai",
            ...usage,
            httpStatus: 200,
            eventId: args.context.eventId,
            articleId: args.context.articleId,
          });
          const logged = await logUsage(
            args.runtime,
            args.context,
            args.model,
            usage,
            reservationId ?? undefined,
          );
          if (logged) {
            usageLogged = true;
            reservationId = null;
          }
          // Embeddings come back in input order.
          return { result: response.embeddings as T, usage };
        }

        const provider = providerForModel(args.model);
        const outcome = await generateChat(args, effectiveMaxTokens);
        const usage = chatUsage(args.model, outcome.usage, startedAt);
        captureLLMEvent({
          kind: "generation",
          callType: args.context.callType,
          model: args.model,
          provider,
          ...usage,
          reasoningTokens: outcome.usage?.outputTokenDetails.reasoningTokens,
          httpStatus: 200,
          error: outcome.error ? describeError(outcome.error) : undefined,
          eventId: args.context.eventId,
          articleId: args.context.articleId,
        });
        if (outcome.usage) {
          const logged = await logUsage(
            args.runtime,
            args.context,
            args.model,
            usage,
            reservationId ?? undefined,
          );
          if (logged) {
            usageLogged = true;
            reservationId = null;
          }
        }

        // Check before anything else: a truncated body is not malformed JSON
        // from a confused model, it is a complete answer we cut off.
        if (outcome.finishReason === "length") {
          throw new TruncatedOutputError(effectiveMaxTokens);
        }
        if (outcome.error) throw outcome.error;

        if (outcome.value === undefined || outcome.value === "") {
          throw new Error("LLM returned empty response content");
        }
        return { result: outcome.value as T, usage };
      } catch (error) {
        lastError = error;
        if (APICallError.isInstance(error)) {
          captureLLMEvent({
            kind: args.kind === "embedding" ? "embedding" : "generation",
            callType: args.context.callType,
            model: args.model,
            provider:
              args.kind === "embedding" ? "openai" : providerForModel(args.model),
            inputTokens: 0,
            outputTokens: 0,
            cachedInputTokens: 0,
            costUsd: 0,
            latencyMs: 0,
            httpStatus: error.statusCode ?? 0,
            error: describeError(error),
            eventId: args.context.eventId,
            articleId: args.context.articleId,
          });
        }
        if (isTruncationError(error) && attempt < maxRetries - 1) {
          const raised = Math.min(
            (effectiveMaxTokens ?? 1200) * 2,
            MAX_OUTPUT_TOKEN_CEILING,
          );
          if (raised > (effectiveMaxTokens ?? 0)) {
            console.warn(
              `[aiCall] ${args.context.callType} truncated at ${effectiveMaxTokens} tokens; retrying at ${raised}`,
            );
            effectiveMaxTokens = raised;
            continue;
          }
        }
        if (
          isFatalError(error) ||
          !isRetryableError(error) ||
          attempt === maxRetries - 1
        ) {
          break;
        }
        await sleep(retryDelayMs(attempt));
      }
    }
  } finally {
    if (reservationId && !usageLogged) {
      try {
        await args.runtime.runMutation(internal.aiBudget.releaseReservation, {
          reservationId,
        });
      } catch (error) {
        console.error(
          `[aiCall] Failed to release AI budget reservation ${reservationId}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
  }

  const message = lastError ? describeError(lastError) : "Unknown LLM error";
  console.error(`[aiCall] ${args.context.callType} failed: ${message}`);
  return {
    result: null,
    usage: zeroUsage(),
    error: message,
  };
}
