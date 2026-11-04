/**
 * AI SDK model instances for the pipeline's two providers.
 *
 *  - "gemini": Google's native Generative Language API (@ai-sdk/google), keyed
 *    by GEMINI_API_KEY. This replaced the OpenAI-compatible endpoint so we can
 *    set thinking config and read thinking/cached token counts.
 *  - "openai": api.openai.com Chat Completions (@ai-sdk/openai `.chat()`), keyed
 *    by OPENAI_API_KEY. Chat Completions, not Responses, so request semantics
 *    (and the `store` default) match what the pipeline sent before.
 *
 * No "use node" and no Convex imports: the eval harness (plain tsx) imports this
 * too. The AI SDK packages load Node built-ins lazily, so this module is also
 * safe to bundle for Convex's default runtime.
 */

import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import type { EmbeddingModel, LanguageModel } from "ai";

import { providerForModel, type LLMProvider } from "./modelRouting";

type ProviderKeys = { openai?: string; gemini?: string };

function apiKeyFor(provider: LLMProvider, keys?: ProviderKeys): string {
  if (provider === "gemini") {
    const apiKey = keys?.gemini ?? process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error(
        "GEMINI_API_KEY environment variable is required for gemini-* models",
      );
    }
    return apiKey;
  }
  const apiKey = keys?.openai ?? process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY environment variable is required");
  }
  return apiKey;
}

// Provider factories are cheap, but caching them keeps one fetch config per key.
const googleProviders = new Map<string, ReturnType<typeof createGoogleGenerativeAI>>();
const openaiProviders = new Map<string, ReturnType<typeof createOpenAI>>();

function googleProvider(apiKey: string) {
  let provider = googleProviders.get(apiKey);
  if (!provider) {
    provider = createGoogleGenerativeAI({ apiKey });
    googleProviders.set(apiKey, provider);
  }
  return provider;
}

function openaiProvider(apiKey: string) {
  let provider = openaiProviders.get(apiKey);
  if (!provider) {
    provider = createOpenAI({ apiKey });
    openaiProviders.set(apiKey, provider);
  }
  return provider;
}

/** Chat model for a configured model id, routed by prefix (see modelRouting). */
export function languageModelFor(
  model: string,
  keys?: ProviderKeys,
): LanguageModel {
  const provider = providerForModel(model);
  const apiKey = apiKeyFor(provider, keys);
  return provider === "gemini"
    ? googleProvider(apiKey)(model)
    : openaiProvider(apiKey).chat(model);
}

/** Embeddings stay on OpenAI (multilingual, handles Romanian — BIV-501). */
export function embeddingModelFor(
  model: string,
  keys?: ProviderKeys,
): EmbeddingModel {
  return openaiProvider(apiKeyFor("openai", keys)).embedding(model);
}

/**
 * The Gemini provider itself, for the Batch API (`experimental_startBatch` and
 * friends take a provider, not a model).
 */
export function geminiBatchProvider(keys?: ProviderKeys) {
  return googleProvider(apiKeyFor("gemini", keys));
}
