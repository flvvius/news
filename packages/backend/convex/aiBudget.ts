/**
 * AI Budget Enforcement & Usage Tracking
 *
 * Provides helpers to:
 *  1. Check if the daily AI budget has been exceeded before making API calls
 *  2. Log token usage and costs after each API call
 *
 * Budget limit is stored in the `config` table with key "ai_daily_budget_usd".
 * Usage is logged to the `aiUsage` table for historical tracking.
 *
 * Usage pattern:
 *   const budget = await ctx.runQuery(internal.aiBudget.checkBudget, {});
 *   if (!budget.allowed) return; // Skip, retry tomorrow
 *   // ... call OpenAI ...
 *   await ctx.runMutation(internal.aiBudget.logUsage, { ... });
 */

import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";

// ---------------------------------------------------------------------------
// Cost rates (USD per token) — update when pricing changes.
// Override at runtime via the "model_rates" key in the config table
// (JSON string of Record<string, { input: number; output: number }>).
// ---------------------------------------------------------------------------

/** Default model pricing as of 2025. Add new models as needed. */
const DEFAULT_MODEL_RATES: Record<string, { input: number; output: number }> = {
  "gpt-4o-mini": { input: 0.00000015, output: 0.0000006 },
  "gpt-4o": { input: 0.0000025, output: 0.00001 },
  "gpt-4.1-nano": { input: 0.0000001, output: 0.0000004 },
  "text-embedding-3-small": { input: 0.00000002, output: 0 },
  "text-embedding-3-large": { input: 0.00000013, output: 0 },
};

/**
 * Mutable rates map, initialised from DEFAULT_MODEL_RATES.
 * Call {@link setModelRates} to override (e.g. after reading from a config
 * table or env var at startup).
 */
let MODEL_RATES: Record<string, { input: number; output: number }> = {
  ...DEFAULT_MODEL_RATES,
};

/**
 * Replace the active rate card.
 * Pass `null` to reset to the built-in defaults.
 */
export function setModelRates(
  rates: Record<string, { input: number; output: number }> | null,
): void {
  MODEL_RATES = rates ? { ...rates } : { ...DEFAULT_MODEL_RATES };
}

/** Return the currently active rate card (read-only copy). */
export function getModelRates(): Record<
  string,
  { input: number; output: number }
> {
  return { ...MODEL_RATES };
}

/** Calculate cost in USD for a given model and token counts. */
export function calculateCost(
  model: string,
  inputTokens: number,
  outputTokens: number,
): number {
  const rates = MODEL_RATES[model];
  if (!rates) {
    // Unknown model — use gpt-4o-mini rates as conservative fallback
    const fallback = MODEL_RATES["gpt-4o-mini"]!;
    return inputTokens * fallback.input + outputTokens * fallback.output;
  }
  return inputTokens * rates.input + outputTokens * rates.output;
}

// ---------------------------------------------------------------------------
// Budget Check (call BEFORE any OpenAI API call)
// ---------------------------------------------------------------------------

/** Default daily budget in USD if not configured. */
const DEFAULT_DAILY_BUDGET_USD = 1.0;
const SOFT_THRESHOLD = 0.8;

function roundUsd(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function parseDailyLimitUsd(limitConfig: { value: string } | null): number {
  if (!limitConfig) return DEFAULT_DAILY_BUDGET_USD;

  const trimmed = limitConfig.value.trim();
  const parsed = trimmed.length > 0 ? Number(trimmed) : Number.NaN;
  if (Number.isFinite(parsed) && !Number.isNaN(parsed) && parsed >= 0) {
    return parsed;
  }

  console.warn(
    `[aiBudget] Invalid ai_daily_budget_usd value "${limitConfig.value}", falling back to ${DEFAULT_DAILY_BUDGET_USD}`,
  );
  return DEFAULT_DAILY_BUDGET_USD;
}

function startOfUtcDay(timestamp: number): number {
  const date = new Date(timestamp);
  return Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate(),
  );
}

async function getDailyLimitUsd(ctx: QueryCtx | MutationCtx): Promise<number> {
  const limitConfig = await ctx.db
    .query("config")
    .withIndex("by_key", (q) => q.eq("key", "ai_daily_budget_usd"))
    .unique();
  return parseDailyLimitUsd(limitConfig);
}

/**
 * Check if today's AI spend is under the daily budget limit.
 * Returns { allowed, spentUsd, remainingUsd, dailyLimitUsd }.
 */
export const checkBudget = internalQuery({
  args: {},
  handler: async (ctx) => {
    const budget = await getDailyBudgetState(ctx);

    return {
      allowed: budget.withinBudget,
      spentUsd: budget.spentUsd,
      remainingUsd: budget.remainingUsd,
      dailyLimitUsd: budget.dailyLimitUsd,
    };
  },
});

async function getDailyBudgetState(ctx: QueryCtx) {
  const now = Date.now();
  const since = startOfUtcDay(now);
  const dailyLimitUsd = await getDailyLimitUsd(ctx);
  const todaysUsage = await ctx.db
    .query("aiUsage")
    .withIndex("by_timestamp", (q) => q.gt("timestamp", since))
    .collect();
  const spentUsd = todaysUsage.reduce((sum, row) => sum + row.costUsd, 0);
  const roundedSpent = roundUsd(spentUsd);
  const remainingUsd = roundUsd(Math.max(0, dailyLimitUsd - spentUsd));

  return {
    spentUsd: roundedSpent,
    remainingUsd,
    dailyLimitUsd,
    capUsd: dailyLimitUsd,
    withinBudget: spentUsd < dailyLimitUsd,
    nearCap: spentUsd >= dailyLimitUsd * SOFT_THRESHOLD,
  };
}

export const checkDailyBudget = internalQuery({
  args: {},
  handler: async (ctx) => getDailyBudgetState(ctx),
});

// ---------------------------------------------------------------------------
// Usage Logging (call AFTER every OpenAI API call)
// ---------------------------------------------------------------------------

/**
 * Log an AI API call to the aiUsage table.
 * Call this after every successful OpenAI call for cost tracking.
 *
 * Convex mutations are transactions, so the budget read and usage insert happen
 * atomically here. If this call returns allowed=false, no aiUsage row was added.
 */
export const logUsage = internalMutation({
  args: {
    model: v.string(),
    operation: v.string(),
    callType: v.optional(v.string()),
    inputTokens: v.number(),
    outputTokens: v.number(),
    costUsd: v.number(),
    eventId: v.optional(v.id("events")),
    articleId: v.optional(v.id("articles")),
    latencyMs: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    return recordUsageInternal(ctx, {
      ...args,
      callType: args.callType ?? args.operation,
    });
  },
});

async function recordUsageInternal(
  ctx: MutationCtx,
  args: {
    model: string;
    operation: string;
    callType: string;
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
    eventId?: Id<"events">;
    articleId?: Id<"articles">;
    latencyMs?: number;
  },
) {
    if (!Number.isFinite(args.costUsd) || Number.isNaN(args.costUsd)) {
      throw new Error("costUsd must be a finite number");
    }
    if (args.costUsd < 0) {
      throw new Error("costUsd must be non-negative");
    }

    const today = new Date().toISOString().split("T")[0]!;
    const dailyLimitUsd = await getDailyLimitUsd(ctx);

    const todaysUsage = await ctx.db
      .query("aiUsage")
      .withIndex("by_timestamp", (q) => q.gt("timestamp", startOfUtcDay(Date.now())))
      .collect();
    const spentUsd = todaysUsage.reduce((sum, row) => sum + row.costUsd, 0);

    if (spentUsd + args.costUsd > dailyLimitUsd) {
      return {
        allowed: false,
        spentUsd: roundUsd(spentUsd),
        remainingUsd: Math.max(0, dailyLimitUsd - spentUsd),
        dailyLimitUsd,
      };
    }

    await ctx.db.insert("aiUsage", {
      date: today,
      model: args.model,
      operation: args.operation,
      callType: args.callType,
      inputTokens: args.inputTokens,
      outputTokens: args.outputTokens,
      costUsd: args.costUsd,
      eventId: args.eventId,
      articleId: args.articleId,
      latencyMs: args.latencyMs,
      timestamp: Date.now(),
    });

    const updatedSpentUsd = spentUsd + args.costUsd;
    return {
      allowed: true,
      spentUsd: roundUsd(updatedSpentUsd),
      remainingUsd: Math.max(0, dailyLimitUsd - updatedSpentUsd),
      dailyLimitUsd,
    };
}

export const recordUsage = internalMutation({
  args: {
    callType: v.string(),
    model: v.string(),
    inputTokens: v.number(),
    outputTokens: v.number(),
    costUsd: v.number(),
    eventId: v.optional(v.id("events")),
    articleId: v.optional(v.id("articles")),
    latencyMs: v.optional(v.number()),
  },
  handler: async (ctx, args) =>
    recordUsageInternal(ctx, {
      ...args,
      operation: args.callType,
    }),
});

// ---------------------------------------------------------------------------
// Admin Query — View today's AI spend (for dashboard)
// ---------------------------------------------------------------------------

/**
 * Get today's AI usage summary grouped by model.
 * Useful for admin dashboards. Public query (no auth required for now).
 */
export const getTodaysUsage = internalQuery({
  args: {},
  handler: async (ctx) => {
    const today = new Date().toISOString().split("T")[0]!;
    const since = startOfUtcDay(Date.now());
    const usage = await ctx.db
      .query("aiUsage")
      .withIndex("by_timestamp", (q) => q.gt("timestamp", since))
      .collect();

    type UsageGroup = {
      calls: number;
      inputTokens: number;
      outputTokens: number;
      costUsd: number;
      latencyMs: number;
    };
    const byModel: Record<string, UsageGroup> = {};
    const byCallType: Record<string, UsageGroup> = {};

    function addUsage(group: Record<string, UsageGroup>, key: string, row: typeof usage[number]) {
      const existing = group[key] ?? {
        calls: 0,
        inputTokens: 0,
        outputTokens: 0,
        costUsd: 0,
        latencyMs: 0,
      };
      existing.calls++;
      existing.inputTokens += row.inputTokens;
      existing.outputTokens += row.outputTokens;
      existing.costUsd += row.costUsd;
      existing.latencyMs += row.latencyMs ?? 0;
      group[key] = existing;
    }

    for (const row of usage) {
      addUsage(byModel, row.model, row);
      addUsage(byCallType, row.callType ?? row.operation, row);
    }

    const totalCostUsd = usage.reduce((sum, r) => sum + r.costUsd, 0);

    return {
      date: today,
      totalCalls: usage.length,
      totalCostUsd: Math.round(totalCostUsd * 1_000_000) / 1_000_000,
      byModel,
      byCallType,
    };
  },
});
