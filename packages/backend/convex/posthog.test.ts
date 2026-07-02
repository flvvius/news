import { convexTest } from "convex-test";
import { describe, expect, test, vi } from "vitest";

import {
  capturePostHogEventRequest,
  deletePostHogPersonRequest,
} from "./posthog";
import schema from "./schema";
import { internal } from "./_generated/api";

const modules = (
  import.meta as unknown as {
    glob: (pattern: string) => Record<string, () => Promise<unknown>>;
  }
).glob("./**/!(*.*.*)*.*s");

type FetchCall = { url: string; init?: RequestInit };

/** Minimal fetch mock: queue responses, record the calls made. */
function mockFetch(responses: Array<{ ok: boolean; body?: unknown }>) {
  const calls: FetchCall[] = [];
  let i = 0;
  const fn = (async (url: string | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    const res = responses[i++] ?? { ok: false };
    return {
      ok: res.ok,
      json: async () => res.body ?? {},
    } as Response;
  }) as unknown as typeof fetch;
  return { fn, calls };
}

const BASE = {
  apiKey: "phx_test",
  projectId: "42",
  host: "https://eu.posthog.com",
  distinctId: "user_abc",
};

describe("deletePostHogPersonRequest (Ticket 5b: GDPR erasure)", () => {
  test("finds the person by distinct_id then deletes person + events", async () => {
    const { fn, calls } = mockFetch([
      { ok: true, body: { results: [{ id: 99 }] } },
      { ok: true },
    ]);

    const result = await deletePostHogPersonRequest({ ...BASE, fetchFn: fn });

    expect(result).toEqual({ deleted: true, reason: "ok" });
    expect(calls).toHaveLength(2);
    expect(calls[0].url).toBe(
      "https://eu.posthog.com/api/projects/42/persons/?distinct_id=user_abc",
    );
    expect(calls[1].url).toBe(
      "https://eu.posthog.com/api/projects/42/persons/99/?delete_events=true",
    );
    expect(calls[1].init?.method).toBe("DELETE");
  });

  test("no matching person → not_found, no delete call", async () => {
    const { fn, calls } = mockFetch([{ ok: true, body: { results: [] } }]);

    const result = await deletePostHogPersonRequest({ ...BASE, fetchFn: fn });

    expect(result).toEqual({ deleted: false, reason: "not_found" });
    expect(calls).toHaveLength(1);
  });

  test("search failure surfaces as search_failed", async () => {
    const { fn } = mockFetch([{ ok: false }]);
    expect(await deletePostHogPersonRequest({ ...BASE, fetchFn: fn })).toEqual({
      deleted: false,
      reason: "search_failed",
    });
  });

  test("delete failure surfaces as delete_failed", async () => {
    const { fn } = mockFetch([
      { ok: true, body: { results: [{ id: 7 }] } },
      { ok: false },
    ]);
    expect(await deletePostHogPersonRequest({ ...BASE, fetchFn: fn })).toEqual({
      deleted: false,
      reason: "delete_failed",
    });
  });

  test("a thrown fetch never escapes (returns error)", async () => {
    const fn = (async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch;
    expect(await deletePostHogPersonRequest({ ...BASE, fetchFn: fn })).toEqual({
      deleted: false,
      reason: "error",
    });
  });
});

describe("capturePostHogEventRequest (Ticket 14: account_created)", () => {
  test("posts the event to the capture endpoint with the project key", async () => {
    const { fn, calls } = mockFetch([{ ok: true }]);
    const ok = await capturePostHogEventRequest({
      apiKey: "phc_proj",
      ingestHost: "https://eu.i.posthog.com",
      distinctId: "user_abc",
      event: "account_created",
      fetchFn: fn,
    });
    expect(ok).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://eu.i.posthog.com/capture/");
    const body = JSON.parse(String(calls[0].init?.body));
    expect(body.api_key).toBe("phc_proj");
    expect(body.event).toBe("account_created");
    expect(body.distinct_id).toBe("user_abc");
  });

  test("a thrown fetch returns false (never escapes)", async () => {
    const fn = (async () => {
      throw new Error("down");
    }) as unknown as typeof fetch;
    expect(
      await capturePostHogEventRequest({
        apiKey: "k",
        ingestHost: "https://eu.i.posthog.com",
        distinctId: "u",
        event: "account_created",
        fetchFn: fn,
      }),
    ).toBe(false);
  });
});

describe("deletePostHogPerson action (no-op safety)", () => {
  test("no-ops cleanly when deletion creds are unconfigured", async () => {
    // POSTHOG_PERSONAL_API_KEY / POSTHOG_PROJECT_ID are unset in tests, so the
    // action must short-circuit without attempting any network call.
    vi.stubGlobal(
      "fetch",
      vi.fn(() => {
        throw new Error("fetch must not be called when unconfigured");
      }),
    );
    const t = convexTest(schema, modules);
    const result = await t.action(internal.posthog.deletePostHogPerson, {
      distinctId: "user_abc",
    });
    expect(result).toEqual({ deleted: false, reason: "not_configured" });
    vi.unstubAllGlobals();
  });
});
