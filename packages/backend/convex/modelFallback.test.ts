// Which summary errors move a job to the fallback model (processSummaryJob).
import { APICallError } from "ai";
import { describe, expect, test } from "vitest";

import {
  isProviderOverloadError,
  isRateLimitError,
} from "./lib/rateLimitError";

function apiError(statusCode: number, message: string) {
  return new APICallError({
    message,
    url: "https://generativelanguage.googleapis.com",
    requestBodyValues: {},
    statusCode,
  });
}

// The exact text prod logged on 2026-11-05 for a Gemini overload.
const PROD_503 =
  "503 This model is currently experiencing high demand. Spikes in demand are usually temporary. Please try again later.";

describe("isProviderOverloadError", () => {
  test("matches a live 503 SDK error", () => {
    expect(isProviderOverloadError(apiError(503, "Service Unavailable"))).toBe(
      true,
    );
  });

  test("matches the flattened message callLLM returns", () => {
    expect(isProviderOverloadError(PROD_503)).toBe(true);
    expect(isProviderOverloadError(new Error(PROD_503))).toBe(true);
    expect(isProviderOverloadError("The model is overloaded.")).toBe(true);
  });

  test("ignores other failures", () => {
    expect(isProviderOverloadError(apiError(400, "Bad request"))).toBe(false);
    expect(isProviderOverloadError("500 Internal error")).toBe(false);
    expect(
      isProviderOverloadError("Model output truncated at max_tokens (3000)"),
    ).toBe(false);
    // A 503 inside some other number is not a status.
    expect(isProviderOverloadError("event 15030 failed grounding")).toBe(false);
    expect(isProviderOverloadError(undefined)).toBe(false);
  });

  test("stays separate from rate limits", () => {
    expect(isRateLimitError(PROD_503)).toBe(false);
    expect(isProviderOverloadError("429 status code (no body)")).toBe(false);
  });
});
