/**
 * LLM model → provider routing (BIV-201).
 *
 * The pipeline's chat model is config-driven: each call type reads its model
 * id from the config table (event_summary_model, article_bias_detection_model,
 * article_fact_extraction_model, claim_analysis_model, quiz_generation_model)
 * and falls back to DEFAULT_CHAT_MODEL. Changing a config key (or this single
 * constant) is the whole switch — no per-call-site model ids.
 *
 * Model ids are routed to a provider by prefix. Both providers go through the
 * AI SDK (lib/llmProviders.ts), so the budget/usage logging and PostHog events
 * in lib/aiCall.ts work the same for either.
 *
 * This module stays dependency-free so V8-runtime modules (config.ts) can
 * import the model constants.
 */

/**
 * Launch default: Gemini Flash-Lite is purpose-built for summarization and
 * structured output at low cost, and the Gemini lineage has a structural
 * Romanian-language advantage over the small OpenAI models (BIV-201).
 */
export const DEFAULT_CHAT_MODEL = "gemini-3.1-flash-lite";

/** Embeddings stay on OpenAI (multilingual, handles Romanian — BIV-501). */
export const DEFAULT_EMBEDDING_MODEL = "text-embedding-3-small";

export type LLMProvider = "openai" | "gemini";

export function providerForModel(model: string): LLMProvider {
  return model.startsWith("gemini") ? "gemini" : "openai";
}

/** GPT-5 family uses reasoning_effort/max_completion_tokens instead of temperature/max_tokens. */
export function isGpt5FamilyModel(model: string): boolean {
  return model.startsWith("gpt-5");
}

export type ReasoningEffort = "minimal" | "low" | "medium" | "high";

/**
 * Gemini thinking level. "default" sends no thinking config, so the model uses
 * its own default (what the pipeline has always done).
 */
export type GeminiThinkingLevel = "default" | ReasoningEffort;

export const GEMINI_THINKING_LEVELS: readonly GeminiThinkingLevel[] = [
  "default",
  "minimal",
  "low",
  "medium",
  "high",
];

export function parseGeminiThinkingLevel(value: unknown): GeminiThinkingLevel {
  return typeof value === "string" &&
    (GEMINI_THINKING_LEVELS as readonly string[]).includes(value)
    ? (value as GeminiThinkingLevel)
    : "default";
}

export type ChatTuning = {
  maxTokens?: number;
  temperature?: number;
  reasoningEffort?: ReasoningEffort;
  thinkingLevel?: GeminiThinkingLevel;
  promptCacheKey?: string;
  promptCacheRetention?: "24h";
};

/** AI SDK call settings (the subset of generateText options we tune). */
export type ChatCallSettings = {
  maxOutputTokens?: number;
  temperature?: number;
  providerOptions?: {
    openai?: {
      reasoningEffort?: ReasoningEffort;
      promptCacheKey?: string;
      promptCacheRetention?: "24h";
    };
    google?: { thinkingConfig: { thinkingLevel: ReasoningEffort } };
  };
};

/**
 * Provider/family-specific call settings for the AI SDK:
 *  - GPT-5 family: reasoning effort, no temperature. The OpenAI provider sends
 *    maxOutputTokens as max_completion_tokens for reasoning models.
 *  - Gemini: temperature + maxOutputTokens, plus a thinking level when one is
 *    set. The prompt_cache_* keys are OpenAI-only and are omitted.
 *  - Other OpenAI models: temperature + maxOutputTokens + prompt cache keys.
 */
export function buildCallSettings(
  model: string,
  tuning: ChatTuning,
): ChatCallSettings {
  const settings: ChatCallSettings = {};
  const gpt5 = isGpt5FamilyModel(model);
  const provider = providerForModel(model);

  if (!gpt5) settings.temperature = tuning.temperature ?? 0.1;
  if (tuning.maxTokens) settings.maxOutputTokens = tuning.maxTokens;

  if (provider === "gemini") {
    if (tuning.thinkingLevel && tuning.thinkingLevel !== "default") {
      settings.providerOptions = {
        google: { thinkingConfig: { thinkingLevel: tuning.thinkingLevel } },
      };
    }
    return settings;
  }

  const openai: NonNullable<ChatCallSettings["providerOptions"]>["openai"] = {};
  if (gpt5) openai.reasoningEffort = tuning.reasoningEffort ?? "minimal";
  if (tuning.promptCacheKey) {
    openai.promptCacheKey = tuning.promptCacheKey;
    if (tuning.promptCacheRetention) {
      openai.promptCacheRetention = tuning.promptCacheRetention;
    }
  }
  if (Object.keys(openai).length > 0) settings.providerOptions = { openai };
  return settings;
}
