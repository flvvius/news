"use node";

import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import { calculateCost } from "../aiBudget";
import { getOpenAI } from "./openai";

export type AICallType =
  | "fact_extraction"
  | "bias_scoring"
  | "event_summary"
  | "claim_divergence"
  | "topic_inference"
  | "embedding";

type AICallContext = {
  callType: AICallType;
  eventId?: Id<"events">;
  articleId?: Id<"articles">;
};

type AICallUsage = {
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  latencyMs: number;
};

type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

type ChatArgs<T> = {
  kind: "chat";
  model: string;
  messages: ChatMessage[];
  responseFormat?: unknown;
  maxTokens?: number;
  temperature?: number;
  parseJson?: boolean;
  context: AICallContext;
  runtime: ActionCtx;
  maxRetries?: number;
};

type EmbeddingArgs<T> = {
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
  return status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
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

async function logUsage(
  runtime: ActionCtx,
  context: AICallContext,
  model: string,
  usage: AICallUsage,
): Promise<void> {
  const result = await runtime.runMutation(internal.aiBudget.recordUsage, {
    callType: context.callType,
    model,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    costUsd: usage.costUsd,
    latencyMs: usage.latencyMs,
    eventId: context.eventId,
    articleId: context.articleId,
  });

  if (!result.allowed) {
    console.warn(
      `[aiCall] Usage log rejected for ${context.callType}; budget would be exceeded ($${result.spentUsd}/$${result.dailyLimitUsd})`,
    );
  }
}

async function checkBudget(
  runtime: ActionCtx,
  context: AICallContext,
): Promise<AICallResult<never> | null> {
  const budget = await runtime.runQuery(internal.aiBudget.checkDailyBudget, {});
  if (budget.withinBudget) return null;

  console.warn(
    `[aiCall] Daily AI budget exhausted before ${context.callType} ($${budget.spentUsd}/$${budget.dailyLimitUsd})`,
  );
  return {
    result: null,
    usage: zeroUsage(),
    error: "budget_exhausted",
  };
}

export async function callOpenAI<T>(
  args: ChatArgs<T> | EmbeddingArgs<T>,
): Promise<AICallResult<T>> {
  const budgetResult = await checkBudget(args.runtime, args.context);
  if (budgetResult) return budgetResult;

  let lastError: unknown;
  const maxRetries = Math.max(1, Math.floor(args.maxRetries ?? 3));

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const openai = await getOpenAI();
      const startedAt = Date.now();

      if (args.kind === "embedding") {
        const response = await openai.embeddings.create({
          model: args.model,
          input: args.input,
          ...(args.dimensions ? { dimensions: args.dimensions } : {}),
        });
        const inputTokens = response.usage.total_tokens ?? 0;
        const usage = {
          inputTokens,
          outputTokens: 0,
          costUsd: calculateCost(args.model, inputTokens, 0),
          latencyMs: Date.now() - startedAt,
        };
        await logUsage(args.runtime, args.context, args.model, usage);
        return { result: response.data as T, usage };
      }

      const response = await openai.chat.completions.create({
        model: args.model,
        temperature: args.temperature ?? 0.1,
        ...(args.maxTokens ? { max_tokens: args.maxTokens } : {}),
        ...(args.responseFormat
          ? { response_format: args.responseFormat as never }
          : {}),
        messages: args.messages,
      });

      const inputTokens = response.usage?.prompt_tokens ?? 0;
      const outputTokens = response.usage?.completion_tokens ?? 0;
      const usage = {
        inputTokens,
        outputTokens,
        costUsd: calculateCost(args.model, inputTokens, outputTokens),
        latencyMs: Date.now() - startedAt,
      };
      await logUsage(args.runtime, args.context, args.model, usage);

      const content = response.choices[0]?.message?.content;
      if (!content) throw new Error("OpenAI returned empty response content");

      const shouldParseJson =
        args.parseJson ?? Boolean(args.responseFormat);
      const result = shouldParseJson ? JSON.parse(content) : content;
      return { result: result as T, usage };
    } catch (error) {
      lastError = error;
      if (isFatalError(error) || !isRetryableError(error) || attempt === maxRetries - 1) {
        break;
      }
      await sleep(retryDelayMs(attempt));
    }
  }

  const message =
    lastError instanceof Error ? lastError.message : "Unknown OpenAI error";
  console.error(`[aiCall] ${args.context.callType} failed: ${message}`);
  return {
    result: null,
    usage: zeroUsage(),
    error: message,
  };
}
