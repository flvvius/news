import { v } from "convex/values";
import { internalAction } from "./_generated/server";

/**
 * PostHog person erasure (Ticket 5b — GDPR right-to-erasure).
 *
 * When an account is deleted we must also remove its PostHog person + events.
 * This is a server-to-server call that needs a PostHog *personal* API key and
 * the project id, which are ops secrets. Until those are set the deletion path
 * no-ops cleanly — account deletion must never fail just because the analytics
 * erasure credentials aren't configured yet.
 *
 * The person's distinct_id is the Better Auth user id (what the client passes
 * to `identify` at login), so deleting by that id covers the merged pre/post
 * signup person.
 */

export type PostHogDeletionResult = {
  deleted: boolean;
  reason:
    | "ok"
    | "not_configured"
    | "not_found"
    | "search_failed"
    | "delete_failed"
    | "error";
};

/**
 * Pure HTTP flow, split out so it can be unit-tested with a mock `fetch`:
 * look up the person by distinct_id, then delete the person and their events.
 */
export async function deletePostHogPersonRequest(params: {
  apiKey: string;
  projectId: string;
  host: string;
  distinctId: string;
  fetchFn?: typeof fetch;
}): Promise<PostHogDeletionResult> {
  const doFetch = params.fetchFn ?? fetch;
  const base = params.host.replace(/\/+$/, "");
  const authHeader = { Authorization: `Bearer ${params.apiKey}` };

  try {
    const searchUrl =
      `${base}/api/projects/${params.projectId}/persons/` +
      `?distinct_id=${encodeURIComponent(params.distinctId)}`;
    const searchRes = await doFetch(searchUrl, { headers: authHeader });
    if (!searchRes.ok) return { deleted: false, reason: "search_failed" };

    const data = (await searchRes.json()) as {
      results?: Array<{ id: number | string }>;
    };
    const person = data.results?.[0];
    if (!person) return { deleted: false, reason: "not_found" };

    // `delete_events=true` removes the person's events too (full erasure).
    const deleteUrl =
      `${base}/api/projects/${params.projectId}/persons/${person.id}/` +
      `?delete_events=true`;
    const deleteRes = await doFetch(deleteUrl, {
      method: "DELETE",
      headers: authHeader,
    });
    return deleteRes.ok
      ? { deleted: true, reason: "ok" }
      : { deleted: false, reason: "delete_failed" };
  } catch {
    return { deleted: false, reason: "error" };
  }
}

/**
 * Server-side PostHog capture (Ticket 14). Posts one event to the EU ingest
 * endpoint using the project API key. Split out for unit testing with a mock
 * `fetch`. Returns whether the event was accepted.
 */
export async function capturePostHogEventRequest(params: {
  apiKey: string;
  ingestHost: string;
  distinctId: string;
  event: string;
  properties?: Record<string, unknown>;
  fetchFn?: typeof fetch;
}): Promise<boolean> {
  const doFetch = params.fetchFn ?? fetch;
  const base = params.ingestHost.replace(/\/+$/, "");
  try {
    const res = await doFetch(`${base}/capture/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: params.apiKey,
        event: params.event,
        distinct_id: params.distinctId,
        properties: { ...params.properties, $lib: "convex-server" },
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Emit `account_created` for every new account (Ticket 14), so total signups
 * are measurable independent of the gate funnel's `signup_completed`. distinct_id
 * is the Better Auth user id, matching the client's identify. No-ops if the
 * project key isn't configured.
 */
export const captureAccountCreated = internalAction({
  args: { distinctId: v.string() },
  handler: async (_ctx, args): Promise<{ captured: boolean }> => {
    const apiKey = process.env.POSTHOG_KEY?.trim();
    const ingestHost =
      process.env.POSTHOG_INGEST_HOST?.trim() || "https://eu.i.posthog.com";
    if (!apiKey) {
      console.warn("[posthog] account_created skipped: POSTHOG_KEY not set.");
      return { captured: false };
    }
    const ok = await capturePostHogEventRequest({
      apiKey,
      ingestHost,
      distinctId: args.distinctId,
      event: "account_created",
    });
    return { captured: ok };
  },
});

export const deletePostHogPerson = internalAction({
  args: { distinctId: v.string() },
  handler: async (_ctx, args): Promise<PostHogDeletionResult> => {
    const apiKey = process.env.POSTHOG_PERSONAL_API_KEY?.trim();
    const projectId = process.env.POSTHOG_PROJECT_ID?.trim();
    // App/API host (EU by default), distinct from the EU ingest endpoint.
    const host = process.env.POSTHOG_API_HOST?.trim() || "https://eu.posthog.com";

    if (!apiKey || !projectId) {
      console.warn(
        "[posthog] person deletion skipped: POSTHOG_PERSONAL_API_KEY / POSTHOG_PROJECT_ID not configured.",
      );
      return { deleted: false, reason: "not_configured" };
    }

    const result = await deletePostHogPersonRequest({
      apiKey,
      projectId,
      host,
      distinctId: args.distinctId,
    });
    if (!result.deleted && result.reason !== "not_found") {
      console.error(`[posthog] person deletion failed: ${result.reason}`);
    }
    return result;
  },
});
