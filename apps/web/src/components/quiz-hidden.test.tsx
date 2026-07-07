// BIV-802: while the quiz feature flag is off, no quiz entry point may be
// visible or reachable anywhere in the web app.
import { describe, expect, test } from "vitest";
import { isRedirect } from "@tanstack/react-router";
import { render } from "@testing-library/react";

import { FEATURE_FLAGS, guardQuizRoute } from "@/lib/feature-flags";
import { QuizCta } from "@/components/quiz-cta";
import { links as headerLinks } from "@/components/header";
import { tabDefinitions } from "@/components/layout/MobileTabBar";
import { LocaleProvider } from "@/lib/i18n/LocaleContext";

describe("quiz feature flag (BIV-802)", () => {
  test("flag defaults to off for launch", () => {
    expect(FEATURE_FLAGS.quiz).toBe(false);
  });

  test("quiz CTA renders nothing on the feed surface", () => {
    const { container } = render(
      <LocaleProvider locale="ro">
        <QuizCta variant="feed" />
      </LocaleProvider>,
    );
    expect(container.innerHTML).toBe("");
  });

  test("quiz CTA renders nothing on the activity surface", () => {
    const { container } = render(
      <LocaleProvider locale="ro">
        <QuizCta variant="activity" />
      </LocaleProvider>,
    );
    expect(container.innerHTML).toBe("");
  });

  test("desktop/mobile header nav has no quiz link and no empty slot", () => {
    expect(headerLinks.some((link) => link.to === "/quiz")).toBe(false);
    expect(headerLinks.length).toBe(4);
  });

  test("mobile tab bar has no quiz tab and keeps a full grid", () => {
    expect(tabDefinitions.some((tab) => tab.to === "/quiz")).toBe(false);
    expect(tabDefinitions.length).toBe(4);
  });

  test("navigating to /quiz redirects to the feed", () => {
    try {
      guardQuizRoute();
      expect.unreachable("guardQuizRoute must throw while the flag is off");
    } catch (thrown) {
      expect(isRedirect(thrown)).toBe(true);
      const redirectTo =
        (thrown as { options?: { to?: string }; to?: string }).options?.to ??
        (thrown as { to?: string }).to;
      expect(redirectTo).toBe("/feed");
    }
  });
});
