import * as SecureStore from "expo-secure-store";

/**
 * Device-local dismissal state for the guest streak teaser (decision 9 — never
 * synced, never shown post-signup). Dismissing it (or engaging the CTA)
 * suppresses the banner for 30 days.
 */
const STREAK_TEASER_DISMISSED_AT_KEY = "biviant.streak-teaser-dismissed-at";

export const STREAK_TEASER_SUPPRESS_MS = 30 * 24 * 60 * 60 * 1000;

export async function loadStreakTeaserDismissedAt(): Promise<number | null> {
  try {
    const raw = await SecureStore.getItemAsync(STREAK_TEASER_DISMISSED_AT_KEY);
    if (!raw) return null;
    const value = Number(raw);
    return Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

export async function setStreakTeaserDismissedAt(
  timestamp: number,
): Promise<void> {
  try {
    await SecureStore.setItemAsync(
      STREAK_TEASER_DISMISSED_AT_KEY,
      String(timestamp),
    );
  } catch {
    // Best-effort; without it the banner may reappear next session.
  }
}
