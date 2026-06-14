import { describe, expect, test, vi } from "vitest";

const spies = vi.hoisted(() => ({
  clearGuestReads: vi.fn(async () => {}),
  clearLocalFollowedTopics: vi.fn(async () => {}),
  clearPushToken: vi.fn(async () => {}),
  clearPendingIntent: vi.fn(async () => {}),
}));

vi.mock("./guest-activity-queue", () => ({
  clearGuestReads: spies.clearGuestReads,
}));
vi.mock("./followed-topics", () => ({
  clearLocalFollowedTopics: spies.clearLocalFollowedTopics,
}));
vi.mock("./push-token", () => ({ clearPushToken: spies.clearPushToken }));
vi.mock("./pending-intent", () => ({
  clearPendingIntent: spies.clearPendingIntent,
}));

import { clearLocalGuestData } from "./clear-guest-data";

describe("clearLocalGuestData (Ticket 5c: guest clear-my-data)", () => {
  test("clears every device-local guest store", async () => {
    await clearLocalGuestData();

    expect(spies.clearGuestReads).toHaveBeenCalledTimes(1);
    expect(spies.clearLocalFollowedTopics).toHaveBeenCalledTimes(1);
    expect(spies.clearPushToken).toHaveBeenCalledTimes(1);
    expect(spies.clearPendingIntent).toHaveBeenCalledTimes(1);
  });

  test("one failing store does not block the others (never throws)", async () => {
    spies.clearGuestReads.mockRejectedValueOnce(new Error("disk error"));

    // allSettled: resolves despite the failure, every clear still dispatched.
    await expect(clearLocalGuestData()).resolves.toBeUndefined();
    expect(spies.clearLocalFollowedTopics).toHaveBeenCalled();
    expect(spies.clearPushToken).toHaveBeenCalled();
    expect(spies.clearPendingIntent).toHaveBeenCalled();
  });
});
