"use node";

/**
 * PostHog-instrumented LLM clients (BIV-201: multi-provider).
 *
 * One OpenAI-SDK-shaped client per provider:
 *  - "openai": api.openai.com (chat + embeddings) — OPENAI_API_KEY
 *  - "gemini": Google's OpenAI-compatible endpoint (chat) — GEMINI_API_KEY
 *
 * Usage in actions:
 *   import { getLLMClient, shutdownPostHog } from "./lib/openai";
 *   const client = await getLLMClient(providerForModel(model));
 *   const response = await client.chat.completions.create({ ... });
 *   // PostHog automatically records token usage, cost, model, latency
 *   await shutdownPostHog(); // flush before action ends
 *
 * Environment variables:
 *   OPENAI_API_KEY     — Required for OpenAI models (incl. embeddings)
 *   GEMINI_API_KEY     — Required for gemini-* models
 *   POSTHOG_API_KEY    — Optional (project API key from posthog.com).
 *                        When unset, falls back to plain clients so the
 *                        pipeline continues to work in dev environments.
 *   POSTHOG_HOST       — Optional (defaults to "https://eu.i.posthog.com")
 */

import { PostHog } from "posthog-node";

import { GEMINI_OPENAI_BASE_URL, type LLMProvider } from "./modelRouting";

type OpenAIClient = InstanceType<typeof import("openai").default>;

// Lazy-init singletons (Convex actions may cold-start)
let _phClient: PostHog | null = null;
const _clients = new Map<LLMProvider, OpenAIClient>();
const _clientInits = new Map<LLMProvider, Promise<OpenAIClient>>();

/** Whether LLM clients are PostHog-wrapped (accept posthog* request params). */
export function isPostHogInstrumented(): boolean {
  return Boolean(process.env.POSTHOG_API_KEY);
}

function getPostHogClient(): PostHog | null {
  if (_phClient) return _phClient;

  const apiKey = process.env.POSTHOG_API_KEY;
  if (!apiKey) return null;

  _phClient = new PostHog(apiKey, {
    host: process.env.POSTHOG_HOST ?? "https://eu.i.posthog.com",
    // Flush quickly — Convex actions are short-lived
    flushAt: 5,
    flushInterval: 2000,
  });

  return _phClient;
}

function providerConfig(provider: LLMProvider): {
  apiKey: string;
  baseURL?: string;
} {
  if (provider === "gemini") {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error(
        "GEMINI_API_KEY environment variable is required for gemini-* models",
      );
    }
    return { apiKey, baseURL: GEMINI_OPENAI_BASE_URL };
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY environment variable is required");
  }
  return { apiKey };
}

/**
 * Returns a PostHog-wrapped, OpenAI-SDK-shaped client for the provider.
 * Auto-tracks token usage, cost, latency, and model per call.
 * Falls back to a plain client if POSTHOG_API_KEY is missing.
 */
export async function getLLMClient(
  provider: LLMProvider,
): Promise<OpenAIClient> {
  const cached = _clients.get(provider);
  if (cached) return cached;
  const pending = _clientInits.get(provider);
  if (pending) return pending;

  const init = (async () => {
    const { apiKey, baseURL } = providerConfig(provider);
    const ph = getPostHogClient();

    let client: OpenAIClient;
    if (ph) {
      // Use PostHog wrapper — auto-instruments all chat/embedding calls
      const { PostHogOpenAI } = await import("@posthog/ai/openai");
      client = new PostHogOpenAI({
        apiKey,
        ...(baseURL ? { baseURL } : {}),
        posthog: ph,
        maxRetries: 0,
      });
    } else {
      // Fallback: plain client (no analytics in dev)
      const OpenAI = (await import("openai")).default;
      client = new OpenAI({
        apiKey,
        ...(baseURL ? { baseURL } : {}),
        maxRetries: 0,
      });
    }

    _clients.set(provider, client);
    return client;
  })();

  _clientInits.set(provider, init);
  try {
    return await init;
  } finally {
    _clientInits.delete(provider);
  }
}

/**
 * Back-compat helper: the OpenAI-provider client (embeddings still live on
 * OpenAI). Prefer getLLMClient(providerForModel(model)) for chat calls.
 */
export async function getOpenAI(): Promise<OpenAIClient> {
  return getLLMClient("openai");
}

/**
 * Flush PostHog events before the action exits.
 * Call this at the end of any action that makes LLM calls.
 * Safe to call even if PostHog is not configured.
 */
export async function shutdownPostHog(): Promise<void> {
  try {
    if (_phClient) {
      await _phClient.shutdown();
    }
  } finally {
    _phClient = null;
    _clients.clear();
    _clientInits.clear();
  }
}
