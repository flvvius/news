import * as SecureStore from "expo-secure-store";

/**
 * Device-local trigger state for the guest streak teaser (Ticket 15). The old
 * hard 2–3 day window meant an engaged guest who ignored days 2–3 was never
 * re-asked. Instead we trigger at streak >= MIN_STREAK and bound nagging by
 * impression count: at most MAX_IMPRESSIONS shows, after which a COOLDOWN must
 * elapse before the counter resets and it can surface again. Never synced,
 * never shown post-signup.
 */
const STREAK_TEASER_STATE_KEY = "biviant.streak-teaser-state";

export const STREAK_TEASER_MIN_STREAK = 2;
export const STREAK_TEASER_MAX_IMPRESSIONS = 2;
export const STREAK_TEASER_COOLDOWN_MS = 30 * 24 * 60 * 60 * 1000;

export type StreakTeaserState = {
  impressions: number;
  lastImpressionAt: number | null;
};

const DEFAULT_STATE: StreakTeaserState = {
  impressions: 0,
  lastImpressionAt: null,
};

/**
 * Impressions that still "count" right now: once the cooldown has elapsed since
 * the last impression, the counter resets to 0 so an engaged guest is
 * re-surfaced.
 */
function effectiveImpressions(state: StreakTeaserState, now: number): number {
  if (
    state.lastImpressionAt !== null &&
    now - state.lastImpressionAt >= STREAK_TEASER_COOLDOWN_MS
  ) {
    return 0;
  }
  return state.impressions;
}

/** Whether the teaser may show for the given streak + state. */
export function shouldShowStreakTeaser(
  streak: number,
  state: StreakTeaserState,
  now: number,
): boolean {
  if (streak < STREAK_TEASER_MIN_STREAK) return false;
  return effectiveImpressions(state, now) < STREAK_TEASER_MAX_IMPRESSIONS;
}

/** Advance the state after the teaser has been shown once. */
export function registerImpression(
  state: StreakTeaserState,
  now: number,
): StreakTeaserState {
  return {
    impressions: effectiveImpressions(state, now) + 1,
    lastImpressionAt: now,
  };
}

export async function loadStreakTeaserState(): Promise<StreakTeaserState> {
  try {
    const raw = await SecureStore.getItemAsync(STREAK_TEASER_STATE_KEY);
    if (!raw) return { ...DEFAULT_STATE };
    const parsed = JSON.parse(raw) as Partial<StreakTeaserState>;
    return {
      impressions:
        typeof parsed.impressions === "number" ? parsed.impressions : 0,
      lastImpressionAt:
        typeof parsed.lastImpressionAt === "number"
          ? parsed.lastImpressionAt
          : null,
    };
  } catch {
    return { ...DEFAULT_STATE };
  }
}

export async function saveStreakTeaserState(
  state: StreakTeaserState,
): Promise<void> {
  try {
    await SecureStore.setItemAsync(
      STREAK_TEASER_STATE_KEY,
      JSON.stringify(state),
    );
  } catch {
    // Best-effort; without it the teaser may surface again next session.
  }
}
