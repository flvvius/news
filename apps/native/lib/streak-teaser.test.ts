import { describe, expect, test, vi } from "vitest";

// streak-teaser.ts imports expo-secure-store at module load; mock it so the
// pure trigger functions can be tested without the native module.
vi.mock("expo-secure-store", () => ({
  getItemAsync: async () => null,
  setItemAsync: async () => {},
  deleteItemAsync: async () => {},
}));

import {
  registerImpression,
  shouldShowStreakTeaser,
  STREAK_TEASER_COOLDOWN_MS,
  STREAK_TEASER_MAX_IMPRESSIONS,
  STREAK_TEASER_MIN_STREAK,
  type StreakTeaserState,
} from "./streak-teaser";

const fresh: StreakTeaserState = { impressions: 0, lastImpressionAt: null };
const NOW = 1_000_000_000;

describe("streak teaser trigger (Ticket 15: widen + impression cap)", () => {
  test("shows at streak >= MIN, not just a 2-3 window", () => {
    expect(shouldShowStreakTeaser(STREAK_TEASER_MIN_STREAK, fresh, NOW)).toBe(
      true,
    );
    expect(shouldShowStreakTeaser(5, fresh, NOW)).toBe(true); // day 5 still eligible
    expect(shouldShowStreakTeaser(1, fresh, NOW)).toBe(false); // below min
  });

  test("stops after MAX impressions until cooldown elapses", () => {
    let state = fresh;
    for (let i = 0; i < STREAK_TEASER_MAX_IMPRESSIONS; i++) {
      expect(shouldShowStreakTeaser(2, state, NOW)).toBe(true);
      state = registerImpression(state, NOW);
    }
    // Cap reached.
    expect(shouldShowStreakTeaser(2, state, NOW)).toBe(false);

    // Still suppressed just before cooldown ends.
    const justBefore = NOW + STREAK_TEASER_COOLDOWN_MS - 1;
    expect(shouldShowStreakTeaser(2, state, justBefore)).toBe(false);

    // Re-surfaces once the cooldown elapses (counter effectively resets).
    const after = NOW + STREAK_TEASER_COOLDOWN_MS;
    expect(shouldShowStreakTeaser(2, state, after)).toBe(true);
  });

  test("registerImpression resets the count after cooldown", () => {
    const capped: StreakTeaserState = {
      impressions: STREAK_TEASER_MAX_IMPRESSIONS,
      lastImpressionAt: NOW,
    };
    const afterCooldown = registerImpression(
      capped,
      NOW + STREAK_TEASER_COOLDOWN_MS,
    );
    expect(afterCooldown.impressions).toBe(1); // reset to 0 then +1
  });
});
