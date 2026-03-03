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

// ---------------------------------------------------------------------------
// Cost rates (USD per token) — update when pricing changes
// ---------------------------------------------------------------------------

/** Known model pricing as of 2025. Add new models as needed. */
const MODEL_RATES: Record<string, { input: number; output: number }> = {
  "gpt-4o-mini": { input: 0.00000015, output: 0.0000006 },
  "gpt-4o": { input: 0.0000025, output: 0.00001 },
  "text-embedding-3-small": { input: 0.00000002, output: 0 },
  "text-embedding-3-large": { input: 0.00000013, output: 0 },
};

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

/**
 * Check if today's AI spend is under the daily budget limit.
 * Returns { allowed, spentUsd, remainingUsd, dailyLimitUsd }.
 */
export const checkBudget = internalQuery({
  args: {},
  handler: async (ctx) => {
    const today = new Date().toISOString().split("T")[0]!;

    // Get daily limit from config table
    const limitConfig = await ctx.db
      .query("config")
      .withIndex("by_key", (q) => q.eq("key", "ai_daily_budget_usd"))
      .unique();

    const dailyLimitUsd = limitConfig
      ? Number.parseFloat(limitConfig.value)
      : DEFAULT_DAILY_BUDGET_USD;

    // Sum today's spend
    const todaysUsage = await ctx.db
      .query("aiUsage")
      .withIndex("by_date", (q) => q.eq("date", today))
      .collect();

    const spentUsd = todaysUsage.reduce((sum, row) => sum + row.costUsd, 0);

    return {
      allowed: spentUsd < dailyLimitUsd,
      spentUsd: Math.round(spentUsd * 1_000_000) / 1_000_000, // 6 decimal places
      remainingUsd: Math.max(0, dailyLimitUsd - spentUsd),
      dailyLimitUsd,
    };
  },
});

// ---------------------------------------------------------------------------
// Usage Logging (call AFTER every OpenAI API call)
// ---------------------------------------------------------------------------

/**
 * Log an AI API call to the aiUsage table.
 * Call this after every successful OpenAI call for cost tracking.
 */
export const logUsage = internalMutation({
  args: {
    model: v.string(),
    operation: v.string(),
    inputTokens: v.number(),
    outputTokens: v.number(),
    costUsd: v.number(),
    eventId: v.optional(v.id("events")),
    articleId: v.optional(v.id("articles")),
  },
  handler: async (ctx, args) => {
    const today = new Date().toISOString().split("T")[0]!;
    await ctx.db.insert("aiUsage", {
      date: today,
      model: args.model,
      operation: args.operation,
      inputTokens: args.inputTokens,
      outputTokens: args.outputTokens,
      costUsd: args.costUsd,
      eventId: args.eventId,
      articleId: args.articleId,
      timestamp: Date.now(),
    });
  },
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
    const usage = await ctx.db
      .query("aiUsage")
      .withIndex("by_date", (q) => q.eq("date", today))
      .collect();

    // Group by model
    const byModel: Record<
      string,
      {
        calls: number;
        inputTokens: number;
        outputTokens: number;
        costUsd: number;
      }
    > = {};

    for (const row of usage) {
      const existing = byModel[row.model] ?? {
        calls: 0,
        inputTokens: 0,
        outputTokens: 0,
        costUsd: 0,
      };
      existing.calls++;
      existing.inputTokens += row.inputTokens;
      existing.outputTokens += row.outputTokens;
      existing.costUsd += row.costUsd;
      byModel[row.model] = existing;
    }

    const totalCostUsd = usage.reduce((sum, r) => sum + r.costUsd, 0);

    return {
      date: today,
      totalCalls: usage.length,
      totalCostUsd: Math.round(totalCostUsd * 1_000_000) / 1_000_000,
      byModel,
    };
  },
});
