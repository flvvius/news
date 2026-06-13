import * as SecureStore from "expo-secure-store";

import type { GateReason } from "@/lib/analytics";

/**
 * A sign-in gate the user triggered, persisted so the originating action
 * completes after auth — even across the email-verification round trip
 * (decision 5). One code path: whatever the gate, it's consumed on the next
 * `isAuthenticated` flip (see [[session-sync]]).
 */
export type PendingIntent = {
  gate: GateReason;
  /** Action to replay once authenticated. */
  action?: { type: "bookmark"; eventId: string };
};

const PENDING_INTENT_KEY = "biviant.pending-intent";

const GATE_REASONS: GateReason[] = [
  "bookmark",
  "streak_teaser",
  "activity",
  "saved",
];

function isPendingIntent(value: unknown): value is PendingIntent {
  if (typeof value !== "object" || value === null) return false;
  const intent = value as PendingIntent;
  if (!GATE_REASONS.includes(intent.gate)) return false;
  if (intent.action !== undefined) {
    if (
      intent.action.type !== "bookmark" ||
      typeof intent.action.eventId !== "string"
    ) {
      return false;
    }
  }
  return true;
}

export async function loadPendingIntent(): Promise<PendingIntent | null> {
  try {
    const raw = await SecureStore.getItemAsync(PENDING_INTENT_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return isPendingIntent(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export async function savePendingIntent(intent: PendingIntent): Promise<void> {
  try {
    await SecureStore.setItemAsync(
      PENDING_INTENT_KEY,
      JSON.stringify(intent),
    );
  } catch {
    // Best-effort; without it the gate just won't auto-complete the action.
  }
}

export async function clearPendingIntent(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(PENDING_INTENT_KEY);
  } catch {
    // Best-effort.
  }
}
