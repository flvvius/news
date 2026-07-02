import { describe, expect, test, vi } from "vitest";

import { rotateIdentity } from "./rotate-identity";

describe("rotateIdentity (Ticket 10: logout resets PostHog identity)", () => {
  test("mints a new id, resets analytics, then re-registers the new id", async () => {
    const calls: string[] = [];
    const rotateStoredDeviceId = vi.fn(async () => {
      calls.push("rotate");
      return "new-device-id";
    });
    const resetAnalytics = vi.fn(() => calls.push("reset"));
    const registerDeviceId = vi.fn((id: string) =>
      calls.push(`register:${id}`),
    );

    const id = await rotateIdentity({
      rotateStoredDeviceId,
      resetAnalytics,
      registerDeviceId,
    });

    expect(id).toBe("new-device-id");
    expect(resetAnalytics).toHaveBeenCalledTimes(1);
    expect(registerDeviceId).toHaveBeenCalledWith("new-device-id");
    // Reset must happen BEFORE re-registering the new device_uuid, or the new
    // super property would be wiped by the reset.
    expect(calls).toEqual(["rotate", "reset", "register:new-device-id"]);
  });

  test("does not reset analytics when stored id rotation fails", async () => {
    const error = new Error("secure store unavailable");
    const rotateStoredDeviceId = vi.fn(async () => {
      throw error;
    });
    const resetAnalytics = vi.fn();
    const registerDeviceId = vi.fn();

    await expect(
      rotateIdentity({
        rotateStoredDeviceId,
        resetAnalytics,
        registerDeviceId,
      }),
    ).rejects.toThrow(error);

    expect(resetAnalytics).not.toHaveBeenCalled();
    expect(registerDeviceId).not.toHaveBeenCalled();
  });

  test("propagates registration failures after analytics has reset", async () => {
    const calls: string[] = [];
    const error = new Error("analytics registration failed");
    const rotateStoredDeviceId = vi.fn(async () => {
      calls.push("rotate");
      return "new-device-id";
    });
    const resetAnalytics = vi.fn(() => calls.push("reset"));
    const registerDeviceId = vi.fn(() => {
      calls.push("register");
      throw error;
    });

    await expect(
      rotateIdentity({
        rotateStoredDeviceId,
        resetAnalytics,
        registerDeviceId,
      }),
    ).rejects.toThrow(error);

    expect(calls).toEqual(["rotate", "reset", "register"]);
  });
});
