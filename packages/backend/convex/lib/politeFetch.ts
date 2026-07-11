/**
 * L6 — per-domain polite fetching: token-bucket spacing (default ≥1.5s with
 * jitter, Crawl-delay honored as a minimum), max 2 concurrent connections
 * per domain, and exponential backoff on 429/5xx honoring Retry-After.
 *
 * The limiter is in-process: each pipeline action fans out its own batch of
 * fetches (enrichment extraction, summarizer body fetches), which is exactly
 * where request bursts against a single publisher originate.
 */

import { botFetchHeaders } from "./botIdentity";

const DEFAULT_MIN_INTERVAL_MS = 1500;
const DEFAULT_JITTER_MS = 400;
const DEFAULT_MAX_CONCURRENT = 2;
const DEFAULT_MAX_ATTEMPTS = 3;
const BACKOFF_BASE_MS = 1000;
const MAX_RETRY_AFTER_MS = 60_000;

type DomainState = {
  nextSlotAt: number;
  active: number;
  waiters: Array<() => void>;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class DomainRateLimiter {
  private readonly minIntervalMs: number;
  private readonly jitterMs: number;
  private readonly maxConcurrent: number;
  private readonly domains = new Map<string, DomainState>();

  constructor(options?: {
    minIntervalMs?: number;
    jitterMs?: number;
    maxConcurrent?: number;
  }) {
    this.minIntervalMs = options?.minIntervalMs ?? DEFAULT_MIN_INTERVAL_MS;
    this.jitterMs = options?.jitterMs ?? DEFAULT_JITTER_MS;
    this.maxConcurrent = options?.maxConcurrent ?? DEFAULT_MAX_CONCURRENT;
  }

  private stateFor(domain: string): DomainState {
    let state = this.domains.get(domain);
    if (!state) {
      state = { nextSlotAt: 0, active: 0, waiters: [] };
      this.domains.set(domain, state);
    }
    return state;
  }

  /**
   * Wait for a send slot on the domain, run the task, release. Crawl-delay
   * (seconds) is honored as a minimum spacing when larger than the default.
   */
  async run<T>(
    domain: string,
    task: () => Promise<T>,
    options?: { crawlDelaySeconds?: number },
  ): Promise<T> {
    const state = this.stateFor(domain);

    // Concurrency gate.
    while (state.active >= this.maxConcurrent) {
      await new Promise<void>((resolve) => state.waiters.push(resolve));
    }
    state.active++;

    try {
      // Spacing gate: claim the next slot, then sleep until it arrives.
      const interval = Math.max(
        this.minIntervalMs,
        (options?.crawlDelaySeconds ?? 0) * 1000,
      );
      const jitter = Math.floor(Math.random() * this.jitterMs);
      const now = Date.now();
      const slot = Math.max(now, state.nextSlotAt);
      state.nextSlotAt = slot + interval + jitter;
      if (slot > now) {
        await sleep(slot - now);
      }
      return await task();
    } finally {
      state.active--;
      state.waiters.shift()?.();
    }
  }
}

/** Shared limiter for the whole action process. */
export const sharedRateLimiter = new DomainRateLimiter();

function retryAfterMs(response: Response, attempt: number): number {
  const header = response.headers.get("retry-after");
  if (header) {
    const seconds = Number(header);
    if (Number.isFinite(seconds) && seconds >= 0) {
      return Math.min(seconds * 1000, MAX_RETRY_AFTER_MS);
    }
    const date = Date.parse(header);
    if (!Number.isNaN(date)) {
      return Math.min(Math.max(0, date - Date.now()), MAX_RETRY_AFTER_MS);
    }
  }
  return Math.min(BACKOFF_BASE_MS * 2 ** attempt, MAX_RETRY_AFTER_MS);
}

/**
 * fetch() with crawler identity headers, per-domain rate limiting and
 * exponential backoff on 429/5xx (honoring Retry-After). Throws only on
 * network errors from the final attempt; HTTP errors return the Response.
 */
export async function politeFetch(
  url: string,
  init?: RequestInit & { timeoutMs?: number },
  options?: {
    limiter?: DomainRateLimiter;
    crawlDelaySeconds?: number;
    maxAttempts?: number;
  },
): Promise<Response> {
  const limiter = options?.limiter ?? sharedRateLimiter;
  const maxAttempts = options?.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const domain = new URL(url).hostname.replace(/^www\./, "");
  const { timeoutMs, headers, ...rest } = init ?? {};

  let lastResponse: Response | null = null;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const response = await limiter.run(
      domain,
      async () =>
        fetch(url, {
          ...rest,
          headers: {
            ...botFetchHeaders(),
            ...(headers as Record<string, string> | undefined),
          },
          signal: rest.signal ?? AbortSignal.timeout(timeoutMs ?? 15_000),
        }),
      { crawlDelaySeconds: options?.crawlDelaySeconds },
    );

    if (response.status !== 429 && response.status < 500) {
      return response;
    }
    lastResponse = response;
    if (attempt < maxAttempts - 1) {
      await sleep(retryAfterMs(response, attempt));
    }
  }
  return lastResponse!;
}
