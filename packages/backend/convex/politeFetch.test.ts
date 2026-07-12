// L6: crawler identity + per-domain rate limiting. Outbound requests carry
// the MiezBot UA header; the limiter proves per-domain spacing and
// concurrency; backoff honors Retry-After on 429.
import { afterEach, describe, expect, test, vi } from "vitest";

import { BOT_USER_AGENT, botFetchHeaders } from "./lib/botIdentity";
import { DomainRateLimiter, politeFetch } from "./lib/politeFetch";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("bot identity (L6)", () => {
  test("UA is the MiezBot product token with bot page link", () => {
    expect(BOT_USER_AGENT).toMatch(/^MiezBot\/1\.0 \(\+https:\/\/www\.miez\.news\/bot\)$/);
  });

  test("every outbound request carries the crawler User-Agent", () => {
    const headers = botFetchHeaders({ Accept: "text/html" });
    expect(headers["User-Agent"]).toBe(BOT_USER_AGENT);
    expect(headers.From).toBeUndefined();
    expect(headers.Accept).toBe("text/html");
  });
});

describe("DomainRateLimiter (L6)", () => {
  test("spaces requests to the same domain by the minimum interval", async () => {
    const limiter = new DomainRateLimiter({
      minIntervalMs: 60,
      jitterMs: 0,
      maxConcurrent: 2,
    });
    const timestamps: number[] = [];
    await Promise.all(
      [0, 1, 2].map(() =>
        limiter.run("example.ro", async () => {
          timestamps.push(Date.now());
        }),
      ),
    );
    timestamps.sort((a, b) => a - b);
    expect(timestamps[1]! - timestamps[0]!).toBeGreaterThanOrEqual(50);
    expect(timestamps[2]! - timestamps[1]!).toBeGreaterThanOrEqual(50);
  });

  test("different domains are not delayed by each other", async () => {
    const limiter = new DomainRateLimiter({
      minIntervalMs: 200,
      jitterMs: 0,
    });
    const started = Date.now();
    await Promise.all([
      limiter.run("a.ro", async () => {}),
      limiter.run("b.ro", async () => {}),
      limiter.run("c.ro", async () => {}),
    ]);
    expect(Date.now() - started).toBeLessThan(150);
  });

  test("honors Crawl-delay as a larger minimum", async () => {
    const limiter = new DomainRateLimiter({ minIntervalMs: 10, jitterMs: 0 });
    const timestamps: number[] = [];
    await Promise.all(
      [0, 1].map(() =>
        limiter.run(
          "slow.ro",
          async () => {
            timestamps.push(Date.now());
          },
          { crawlDelaySeconds: 0.12 },
        ),
      ),
    );
    timestamps.sort((a, b) => a - b);
    expect(timestamps[1]! - timestamps[0]!).toBeGreaterThanOrEqual(100);
  });

  test("caps concurrent requests per domain", async () => {
    const limiter = new DomainRateLimiter({
      minIntervalMs: 1,
      jitterMs: 0,
      maxConcurrent: 2,
    });
    let active = 0;
    let peak = 0;
    await Promise.all(
      Array.from({ length: 6 }, () =>
        limiter.run("busy.ro", async () => {
          active++;
          peak = Math.max(peak, active);
          await new Promise((resolve) => setTimeout(resolve, 20));
          active--;
        }),
      ),
    );
    expect(peak).toBeLessThanOrEqual(2);
  });
});

describe("politeFetch (L6)", () => {
  test("sends identity headers and returns the response", async () => {
    const seenHeaders: Array<Record<string, string>> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        seenHeaders.push(init?.headers as Record<string, string>);
        return new Response("ok", { status: 200 });
      }),
    );

    const limiter = new DomainRateLimiter({ minIntervalMs: 1, jitterMs: 0 });
    const response = await politeFetch(
      "https://example.ro/feed.xml",
      {},
      { limiter },
    );
    expect(response.status).toBe(200);
    expect(seenHeaders[0]!["User-Agent"]).toBe(BOT_USER_AGENT);
    expect(seenHeaders[0]!.From).toBeUndefined();
  });

  test("backs off on 429 honoring Retry-After and retries", async () => {
    let calls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        calls++;
        if (calls === 1) {
          return new Response("slow down", {
            status: 429,
            headers: { "Retry-After": "0" },
          });
        }
        return new Response("ok", { status: 200 });
      }),
    );

    const limiter = new DomainRateLimiter({ minIntervalMs: 1, jitterMs: 0 });
    const response = await politeFetch(
      "https://example.ro/a",
      {},
      { limiter, maxAttempts: 3 },
    );
    expect(calls).toBe(2);
    expect(response.status).toBe(200);
  });

  test("gives up after maxAttempts and returns the last error response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response("nope", {
            status: 503,
            headers: { "Retry-After": "0" },
          }),
      ),
    );
    const limiter = new DomainRateLimiter({ minIntervalMs: 1, jitterMs: 0 });
    const response = await politeFetch(
      "https://example.ro/a",
      {},
      { limiter, maxAttempts: 2 },
    );
    expect(response.status).toBe(503);
    expect((fetch as unknown as { mock: { calls: unknown[] } }).mock.calls).toHaveLength(2);
  });
});
