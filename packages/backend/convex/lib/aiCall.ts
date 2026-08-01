"use node";

import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import { calculateCost, calculateCostWithCachedInput } from "../aiBudget";
import { getLLMClient, isPostHogInstrumented } from "./openai";
import { buildChatTuningParams, providerForModel } from "./modelRouting";

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

type ChatArgs = {
  kind: "chat";
  model: string;
  messages: ChatMessage[];
  responseFormat?: unknown;
  maxTokens?: number;
  temperature?: number;
  parseJson?: boolean;
  promptCacheKey?: string;
  promptCacheRetention?: "24h";
  reasoningEffort?: "minimal" | "low" | "medium" | "high";
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

function errorStatus(error: unknown): number | undefined {
  const candidate = error as { status?: unknown; code?: unknown };
  if (typeof candidate.status === "number") return candidate.status;
  if (typeof candidate.code === "number") return candidate.code;
  return undefined;
}

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
export function isRateLimitError(error: unknown): boolean {
  if (errorStatus(error) === 429) return true;
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "";
  return (
    message.length > 0 &&
    /\b429\b|RESOURCE_EXHAUSTED|rate[ _-]?limit|quota/i.test(message)
  );
}

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

  try {
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const client = await getLLMClient(
          args.kind === "embedding" ? "openai" : providerForModel(args.model),
        );
        const startedAt = Date.now();

        if (args.kind === "embedding") {
          const response = await client.embeddings.create({
            model: args.model,
            input: args.input,
            ...(args.dimensions ? { dimensions: args.dimensions } : {}),
          });
          const inputTokens = response.usage.total_tokens ?? 0;
          const usage = {
            inputTokens,
            outputTokens: 0,
            cachedInputTokens: 0,
            costUsd: calculateCost(args.model, inputTokens, 0),
            latencyMs: Date.now() - startedAt,
          };
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
          return { result: response.data as T, usage };
        }

        // The PostHog wrapper defaults $ai_provider to "openai"; label routed
        // Gemini traffic so provider analytics stay accurate. Only the
        // wrapped client strips posthog* params before sending, so never
        // attach them to a plain client.
        const provider = providerForModel(args.model);
        const response = await client.chat.completions.create({
          model: args.model,
          ...(provider === "gemini" && isPostHogInstrumented()
            ? {
                posthogProperties: {
                  $ai_provider: "gemini",
                  llm_provider: "gemini",
                },
              }
            : {}),
          ...buildChatTuningParams(args.model, {
            maxTokens: args.maxTokens,
            temperature: args.temperature,
            reasoningEffort: args.reasoningEffort,
            promptCacheKey:
              args.promptCacheKey ?? `biviant:${args.context.callType}`,
            promptCacheRetention: args.promptCacheRetention,
          }),
          ...(args.responseFormat
            ? { response_format: args.responseFormat as never }
            : {}),
          messages: args.messages,
        } as never);

        const inputTokens = response.usage?.prompt_tokens ?? 0;
        const outputTokens = response.usage?.completion_tokens ?? 0;
        const cachedInputTokens =
          (
            response.usage as
              | { prompt_tokens_details?: { cached_tokens?: number } }
              | undefined
          )?.prompt_tokens_details?.cached_tokens ?? 0;
        const usage = {
          inputTokens,
          outputTokens,
          cachedInputTokens,
          costUsd: calculateCostWithCachedInput(
            args.model,
            inputTokens,
            cachedInputTokens,
            outputTokens,
          ),
          latencyMs: Date.now() - startedAt,
        };
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

        const content = response.choices[0]?.message?.content;
        if (!content) throw new Error("LLM returned empty response content");

        const shouldParseJson = args.parseJson ?? Boolean(args.responseFormat);
        const result = shouldParseJson ? JSON.parse(content) : content;
        return { result: result as T, usage };
      } catch (error) {
        lastError = error;
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

  const message =
    lastError instanceof Error ? lastError.message : "Unknown LLM error";
  console.error(`[aiCall] ${args.context.callType} failed: ${message}`);
  return {
    result: null,
    usage: zeroUsage(),
    error: message,
  };
}
