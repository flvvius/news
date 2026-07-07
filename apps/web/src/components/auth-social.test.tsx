// BIV-808 regression: the Google sign-in button used to swallow failed
// requests entirely — authClient.signIn.social resolves with { error } instead
// of throwing, so the old catch-only handler made the button "do nothing".
import { beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const { signInSocial, toastError } = vi.hoisted(() => ({
  signInSocial: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("@/lib/auth-client", () => ({
  authClient: {
    signIn: {
      social: signInSocial,
    },
  },
}));

vi.mock("sonner", () => ({
  toast: {
    error: toastError,
    success: vi.fn(),
  },
}));

import { GoogleSignInButton } from "./auth-social";
import { LocaleProvider } from "@/lib/i18n/LocaleContext";

function renderButton() {
  return render(
    <LocaleProvider locale="ro">
      <GoogleSignInButton callbackURL="/activitate" />
    </LocaleProvider>,
  );
}

beforeEach(() => {
  cleanup();
  signInSocial.mockReset();
  toastError.mockReset();
});

describe("GoogleSignInButton (BIV-808)", () => {
  test("invokes the social sign-in handler with the Google provider", async () => {
    signInSocial.mockResolvedValue({ data: null, error: null });
    renderButton();

    fireEvent.click(screen.getByRole("button"));

    await waitFor(() => expect(signInSocial).toHaveBeenCalledTimes(1));
    expect(signInSocial).toHaveBeenCalledWith({
      provider: "google",
      callbackURL: "/activitate",
    });
    expect(toastError).not.toHaveBeenCalled();
  });

  test("surfaces a { error } result as a toast instead of doing nothing", async () => {
    signInSocial.mockResolvedValue({
      data: null,
      error: { status: 403, message: "Invalid origin", code: "INVALID_ORIGIN" },
    });
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    renderButton();

    fireEvent.click(screen.getByRole("button"));

    await waitFor(() => expect(toastError).toHaveBeenCalledTimes(1));
    consoleError.mockRestore();
  });

  test("surfaces a thrown error (network failure) as a toast", async () => {
    signInSocial.mockRejectedValue(new Error("network down"));
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    renderButton();

    fireEvent.click(screen.getByRole("button"));

    await waitFor(() => expect(toastError).toHaveBeenCalledTimes(1));
    consoleError.mockRestore();
  });
});
