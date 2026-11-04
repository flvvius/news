"use node";

/**
 * PostHog LLM analytics for pipeline model calls.
 *
 * callLLM (lib/aiCall.ts) sends one `$ai_generation` / `$ai_embedding` event
 * per provider attempt, with the same token, cost and latency numbers it logs
 * to aiUsage. This replaced the @posthog/ai OpenAI wrapper: its AI SDK wrapper
 * only supports AI SDK v5/v6 models, and the v7 route needs a full
 * OpenTelemetry exporter.
 *
 * Prompt and output text are NOT sent. The prompts carry article text, and we
 * do not hand article content to third parties we don't need to (see the
 * no-article-body-storage rule). The old wrapper sent both by default.
 *
 * Environment variables:
 *   POSTHOG_API_KEY — optional; when unset, every function here is a no-op.
 *   POSTHOG_HOST    — optional (defaults to "https://eu.i.posthog.com").
 *
 * Call shutdownPostHog() at the end of any action that makes LLM calls, so
 * queued events flush before the action exits.
 */

import { randomUUID } from "node:crypto";
import { PostHog } from "posthog-node";

import type { LLMProvider } from "./modelRouting";

let _phClient: PostHog | null = null;

function getPostHogClient(): PostHog | null {
  if (_phClient) return _phClient;

  const apiKey = process.env.POSTHOG_API_KEY;
  if (!apiKey) return null;

  _phClient = new PostHog(apiKey, {
    host: process.env.POSTHOG_HOST ?? "https://eu.i.posthog.com",
    // Flush quickly — Convex actions are short-lived.
    flushAt: 5,
    flushInterval: 2000,
  });
  return _phClient;
}

export type LLMEvent = {
  kind: "generation" | "embedding";
  callType: string;
  model: string;
  provider: LLMProvider;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  reasoningTokens?: number;
  costUsd: number;
  latencyMs: number;
  httpStatus: number;
  error?: string;
  eventId?: string;
  articleId?: string;
};

export function captureLLMEvent(event: LLMEvent): void {
  const ph = getPostHogClient();
  if (!ph) return;
  try {
    const traceId = randomUUID();
    ph.capture({
      // Pipeline calls have no user; a per-call id keeps them off person
      // profiles (same as the old wrapper with no distinct id).
      distinctId: traceId,
      event: event.kind === "embedding" ? "$ai_embedding" : "$ai_generation",
      properties: {
        $ai_lib: "biviant-ai-sdk",
        $ai_trace_id: traceId,
        $ai_provider: event.provider,
        $ai_model: event.model,
        $ai_http_status: event.httpStatus,
        $ai_input_tokens: event.inputTokens,
        $ai_output_tokens: event.outputTokens,
        ...(event.cachedInputTokens
          ? { $ai_cache_read_input_tokens: event.cachedInputTokens }
          : {}),
        ...(event.reasoningTokens
          ? { $ai_reasoning_tokens: event.reasoningTokens }
          : {}),
        $ai_total_cost_usd: event.costUsd,
        $ai_latency: event.latencyMs / 1000,
        ...(event.error ? { $ai_is_error: true, $ai_error: event.error } : {}),
        call_type: event.callType,
        llm_provider: event.provider,
        ...(event.eventId ? { event_id: event.eventId } : {}),
        ...(event.articleId ? { article_id: event.articleId } : {}),
        $process_person_profile: false,
      },
    });
  } catch (error) {
    console.warn(
      `[llmAnalytics] PostHog capture failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

/**
 * Flush PostHog events before the action exits.
 * Safe to call even if PostHog is not configured.
 */
export async function shutdownPostHog(): Promise<void> {
  try {
    if (_phClient) {
      await _phClient.shutdown();
    }
  } finally {
    _phClient = null;
  }
}
