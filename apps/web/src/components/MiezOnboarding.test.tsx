// MIEZ-8: the first-run screen shows exactly once per device, is dismissible,
// and never prompts for an account.
import { beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

const navigate = vi.fn();
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => navigate,
}));
vi.mock("@/lib/posthog", () => ({ captureEvent: vi.fn() }));

import { MiezOnboarding } from "./MiezOnboarding";
import { LocaleProvider } from "@/lib/i18n/LocaleContext";
import { getString } from "@/lib/i18n/strings";

const KEY = "miez-onboarding-v1";

function renderOnboarding() {
  return render(
    <LocaleProvider locale="ro">
      <MiezOnboarding />
    </LocaleProvider>,
  );
}

describe("MiezOnboarding (MIEZ-8)", () => {
  beforeEach(() => {
    cleanup();
    navigate.mockClear();
    window.localStorage.clear();
  });

  test("shows the three-beat pitch on a fresh device", () => {
    renderOnboarding();
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(
      screen.getByText(getString("ro", "onboarding.miez.beat1")),
    ).toBeTruthy();
    expect(
      screen.getByText(getString("ro", "onboarding.miez.beat2")),
    ).toBeTruthy();
    expect(
      screen.getByText(getString("ro", "onboarding.miez.beat3")),
    ).toBeTruthy();
  });

  test("never prompts for an account", () => {
    renderOnboarding();
    const dialog = screen.getByRole("dialog");
    expect(dialog.textContent?.toLowerCase()).not.toContain("cont ");
    expect(dialog.textContent?.toLowerCase()).not.toContain("log in");
    // Word-bounded so it flags "sign in" / "sign up" but not "design" / "signal".
    expect(dialog.textContent ?? "").not.toMatch(/\bsign\b/i);
  });

  test("skipping dismisses it and records the device as onboarded", () => {
    renderOnboarding();
    fireEvent.click(screen.getByText(getString("ro", "onboarding.miez.skip")));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(window.localStorage.getItem(KEY)).toBe("1");
  });

  test("the CTA dismisses and navigates into the feed", () => {
    renderOnboarding();
    fireEvent.click(screen.getByText(getString("ro", "onboarding.miez.cta")));
    expect(navigate).toHaveBeenCalledWith({ to: "/feed" });
    expect(window.localStorage.getItem(KEY)).toBe("1");
  });

  test("does not show again once the device has seen it", () => {
    window.localStorage.setItem(KEY, "1");
    renderOnboarding();
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
