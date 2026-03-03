"use node";

/**
 * PostHog-instrumented OpenAI client.
 *
 * Usage in actions:
 *   import { getOpenAI, shutdownPostHog } from "./lib/openai";
 *   const openai = getOpenAI();
 *   const response = await openai.embeddings.create({ ... });
 *   // PostHog automatically records token usage, cost, model, latency
 *   await shutdownPostHog(); // flush before action ends
 *
 * Environment variables:
 *   OPENAI_API_KEY     — Required
 *   POSTHOG_API_KEY    — Required (project API key from posthog.com)
 *   POSTHOG_HOST       — Optional (defaults to "https://us.i.posthog.com")
 *
 * When POSTHOG_API_KEY is not set, falls back to a plain OpenAI client
 * so the pipeline doesn't break in dev environments.
 */

import { PostHog } from "posthog-node";

// Lazy-init singletons (Convex actions may cold-start)
let _phClient: PostHog | null = null;
let _openai: InstanceType<typeof import("openai").default> | null = null;

function getPostHogClient(): PostHog | null {
  if (_phClient) return _phClient;

  const apiKey = process.env.POSTHOG_API_KEY;
  if (!apiKey) return null;

  _phClient = new PostHog(apiKey, {
    host: process.env.POSTHOG_HOST ?? "https://us.i.posthog.com",
    // Flush quickly — Convex actions are short-lived
    flushAt: 5,
    flushInterval: 2000,
  });

  return _phClient;
}

/**
 * Returns a PostHog-wrapped OpenAI client that auto-tracks:
 *  - Token usage (input/output)
 *  - Cost (auto-calculated from model pricing data)
 *  - Latency per call
 *  - Model name, operation type
 *
 * Falls back to plain OpenAI if POSTHOG_API_KEY is missing.
 */
export async function getOpenAI(): Promise<
  InstanceType<typeof import("openai").default>
> {
  if (_openai) return _openai;

  const openaiKey = process.env.OPENAI_API_KEY;
  if (!openaiKey) {
    throw new Error("OPENAI_API_KEY environment variable is required");
  }

  const ph = getPostHogClient();

  if (ph) {
    // Use PostHog wrapper — auto-instruments all OpenAI calls
    const { PostHogOpenAI } = await import("@posthog/ai/openai");
    _openai = new PostHogOpenAI({
      apiKey: openaiKey,
      posthog: ph,
    });
  } else {
    // Fallback: plain OpenAI client (no analytics in dev)
    const OpenAI = (await import("openai")).default;
    _openai = new OpenAI({ apiKey: openaiKey });
  }

  return _openai;
}

/**
 * Flush PostHog events before the action exits.
 * Call this at the end of any action that makes OpenAI calls.
 * Safe to call even if PostHog is not configured.
 */
export async function shutdownPostHog(): Promise<void> {
  if (_phClient) {
    await _phClient.flush();
  }
}
