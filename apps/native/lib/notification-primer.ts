import * as SecureStore from "expo-secure-store";

/**
 * Device-local state for the notification pre-permission primer. The primer is
 * the *custom* ask shown before the OS prompt; declining it must never fire the
 * OS prompt. Once the OS prompt has fired (the user accepted the primer), or
 * the OS can no longer be asked, the primer is "resolved" and never shown
 * again. Re-asks are bounded: at most {@link MAX_PRIMER_SHOWS} total, each at
 * least {@link PRIMER_REASK_COOLDOWN_MS} apart.
 */
export type PrimerState = {
  shownCount: number;
  lastShownAt: number | null;
  resolved: boolean;
};

const PRIMER_STATE_KEY = "biviant.notification-primer";

/** Initial ask + 2 re-asks. */
export const MAX_PRIMER_SHOWS = 3;
export const PRIMER_REASK_COOLDOWN_MS = 14 * 24 * 60 * 60 * 1000;

const DEFAULT_STATE: PrimerState = {
  shownCount: 0,
  lastShownAt: null,
  resolved: false,
};

export async function loadPrimerState(): Promise<PrimerState> {
  try {
    const raw = await SecureStore.getItemAsync(PRIMER_STATE_KEY);
    if (!raw) return { ...DEFAULT_STATE };
    const parsed = JSON.parse(raw) as Partial<PrimerState>;
    return {
      shownCount:
        typeof parsed.shownCount === "number" ? parsed.shownCount : 0,
      lastShownAt:
        typeof parsed.lastShownAt === "number" ? parsed.lastShownAt : null,
      resolved: parsed.resolved === true,
    };
  } catch {
    return { ...DEFAULT_STATE };
  }
}

export async function savePrimerState(state: PrimerState): Promise<void> {
  try {
    await SecureStore.setItemAsync(PRIMER_STATE_KEY, JSON.stringify(state));
  } catch {
    // Best-effort.
  }
}

/** Whether the cooldown / lifetime-cap allow showing the primer again. */
export function canShowPrimer(state: PrimerState, now: number): boolean {
  if (state.resolved) return false;
  if (state.shownCount >= MAX_PRIMER_SHOWS) return false;
  if (
    state.lastShownAt !== null &&
    now - state.lastShownAt < PRIMER_REASK_COOLDOWN_MS
  ) {
    return false;
  }
  return true;
}
