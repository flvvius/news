/**
 * LLM model → provider routing (BIV-201).
 *
 * The pipeline's chat model is config-driven: each call type reads its model
 * id from the config table (event_summary_model, article_bias_detection_model,
 * article_fact_extraction_model, claim_analysis_model, quiz_generation_model)
 * and falls back to DEFAULT_CHAT_MODEL. Changing a config key (or this single
 * constant) is the whole switch — no per-call-site model ids.
 *
 * Model ids are routed to a provider by prefix. Gemini models are served
 * through Google's OpenAI-compatible endpoint, so the same OpenAI SDK client
 * shape (and the PostHog instrumentation + budget/usage logging around it)
 * works for both providers.
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

/** Base URL for Gemini's OpenAI-compatible API. */
export const GEMINI_OPENAI_BASE_URL =
  "https://generativelanguage.googleapis.com/v1beta/openai/";

export function providerForModel(model: string): LLMProvider {
  return model.startsWith("gemini") ? "gemini" : "openai";
}

/** GPT-5 family uses reasoning_effort/max_completion_tokens instead of temperature/max_tokens. */
export function isGpt5FamilyModel(model: string): boolean {
  return model.startsWith("gpt-5");
}

export type ChatTuning = {
  maxTokens?: number;
  temperature?: number;
  reasoningEffort?: "minimal" | "low" | "medium" | "high";
  promptCacheKey?: string;
  promptCacheRetention?: "24h";
};

/**
 * Provider/family-specific chat parameters:
 *  - GPT-5 family: reasoning_effort + max_completion_tokens (no temperature).
 *  - Gemini (OpenAI-compat endpoint): temperature + max_tokens; the
 *    prompt_cache_* keys are OpenAI-only and must be omitted.
 *  - Other OpenAI models: temperature + max_tokens + prompt cache keys.
 */
export function buildChatTuningParams(
  model: string,
  tuning: ChatTuning,
): Record<string, unknown> {
  const params: Record<string, unknown> = {};
  const gpt5 = isGpt5FamilyModel(model);
  const provider = providerForModel(model);

  if (gpt5) {
    params.reasoning_effort = tuning.reasoningEffort ?? "minimal";
  } else {
    params.temperature = tuning.temperature ?? 0.1;
  }

  if (tuning.maxTokens) {
    if (gpt5) {
      params.max_completion_tokens = tuning.maxTokens;
    } else {
      params.max_tokens = tuning.maxTokens;
    }
  }

  if (provider === "openai" && tuning.promptCacheKey) {
    params.prompt_cache_key = tuning.promptCacheKey;
    if (tuning.promptCacheRetention) {
      params.prompt_cache_retention = tuning.promptCacheRetention;
    }
  }

  return params;
}
