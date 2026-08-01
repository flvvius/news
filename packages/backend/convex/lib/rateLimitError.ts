/**
 * Provider rate-limit detection, kept deliberately dependency-free.
 *
 * This lives apart from `lib/aiCall.ts` because that module is `"use node"`
 * (it pulls in the OpenAI/PostHog SDKs, which import node built-ins). Convex
 * bundles every module WITHOUT a `"use node"` directive for the V8 runtime, so
 * a plain query/mutation module that imports from aiCall fails the bundle with
 * "Could not resolve node:async_hooks" — at `convex codegen` time, which type
 * checking alone does not catch.
 *
 * Both runtimes need the same answer to "was this a rate limit?", so the
 * predicate lives here with no imports at all and is safe from either side.
 */

export function errorStatus(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const candidate = error as { status?: unknown; code?: unknown };
  if (typeof candidate.status === "number") return candidate.status;
  if (typeof candidate.code === "number") return candidate.code;
  return undefined;
}

/**
 * True for provider 429s / quota exhaustion.
 *
 * Matches both a live SDK error object and the flattened message string that
 * `callLLM` hands back to its callers — by the time `processSummaryJob` sees a
 * failure, the error object is gone and only text like
 * `"429 status code (no body)"` survives. Stored `lastError` strings on
 * `eventSummaryJobs` are the same shape, which is why the requeue migration can
 * reuse this.
 */
export function isRateLimitError(error: unknown): boolean {
  if (errorStatus(error) === 429) return true;
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "";
  return (
    message.length > 0 &&
    /\b429\b|RESOURCE_EXHAUSTED|rate[ _-]?limit|quota/i.test(message)
  );
}
